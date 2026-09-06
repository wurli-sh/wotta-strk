"use client";

import { useEffect, useRef, useState } from "react";
import {
  Eye,
  ExternalLink,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import type { MeResponse } from "@/lib/api/client";
import { useNetworkMode } from "@/components/NetworkModeProvider";
import { DenomChips } from "@/components/DenomChips";
import { Button } from "@/components/ui/Button";
import { MotionPillButton } from "@/components/ui/MotionLink";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { TextShimmer } from "@/components/ui/TextShimmer";
import { ApyMovement, formatApySignificant } from "./ApyMovement";
import { PrivateTokenIcon } from "./PrivateTokenIcon";
import { MAINNET_DENS, denominationBaseUnits, type Dens } from "@/lib/denoms";
import { beginNetworkOperation } from "@/lib/network-operations";
import { userFacingError } from "@/lib/errors";
import { formatUsdc } from "@/lib/format/amount";
import { cn } from "@/lib/cn";
import { buttonTap } from "@/lib/motion";
import { connectReady } from "@/lib/wotta/ready";
import {
  readMainnetPrivateBalance,
  readMainnetPrivateTokenBalance,
  submitMainnetStrk20Actions,
} from "@/lib/wotta/mainnet-privacy";
import {
  buildVesuDepositActions,
  buildVesuRedeemActions,
} from "@/lib/vesu/actions";
import {
  canDeposit,
  canWithdraw,
  earnUnavailableReason,
  loadVesuEarn,
  sameFelt,
} from "@/lib/vesu/config";
import { fetchVesuMarket, type VesuMarketStats } from "@/lib/vesu/market";
import { rememberApySnapshot } from "@/lib/vesu/market-snapshot";
import { readVesuPosition } from "@/lib/vesu/position";
import { recordDeposit, recordRedeem } from "@/lib/vesu/ledger";
import { claimEarnTxHandled, getEarnWriteGate } from "@/lib/vesu/earn-write-gate";
import { assertVesuRuntime } from "@/lib/vesu/runtime";
import { verifyVesuEarnTransaction } from "@/lib/vesu/verify-receipt";

type EarnTab = "deposit" | "redeem";
type RedeemPercent = 25 | 50 | 100;

type EarnPhase =
  | "idle"
  | "revealing"
  | "checking"
  | "authorizing"
  | "supplying"
  | "redeeming";

const EARN_TABS = [
  { value: "deposit" as const, label: "Deposit" },
  { value: "redeem" as const, label: "Redeem" },
];

const REDEEM_PERCENTS: Array<{ value: RedeemPercent; label: string }> = [
  { value: 25, label: "25%" },
  { value: 50, label: "50%" },
  { value: 100, label: "Max" },
];

function formatShares(value: bigint): string {
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n)
    .toString()
    .padStart(18, "0")
    .slice(0, 6)
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function depositPhaseLabel(
  phase: EarnPhase,
  denom: (typeof MAINNET_DENS)[number],
): string {
  switch (phase) {
    case "revealing":
      return "Unlocking private balance…";
    case "checking":
      return "Checking Vesu route…";
    case "authorizing":
      return "Authorize in Ready…";
    case "supplying":
      return `Yielding ${denom} shielded USDC…`;
    default:
      return `Yield ${denom} shielded USDC`;
  }
}

function redeemPhaseLabel(phase: EarnPhase, percent: RedeemPercent): string {
  const share = percent === 100 ? "Max" : `${percent}%`;
  switch (phase) {
    case "revealing":
      return "Unlocking private balance…";
    case "checking":
      return "Checking Vesu route…";
    case "authorizing":
      return "Authorize in Ready…";
    case "redeeming":
      return `Redeeming ${share} shielded vUSDC…`;
    default:
      return `Redeem ${share} shielded vUSDC`;
  }
}

export function EarnPanel({ me }: { me: MeResponse | null }) {
  const { mode } = useNetworkMode();
  const config = loadVesuEarn();
  const linkedAddress = me?.wallet?.address ?? null;
  const pendingSmoke =
    process.env.NODE_ENV !== "production" &&
    config.status === "pending" &&
    sameFelt(process.env.NEXT_PUBLIC_VESU_EARN_SMOKE_WALLET, linkedAddress);
  const writePolicy = { allowPendingSmoke: pendingSmoke };
  const [tab, setTab] = useState<EarnTab>("deposit");
  const [readyAddress, setReadyAddress] = useState<string | null>(null);
  const [usdc, setUsdc] = useState<bigint | null>(null);
  const [shares, setShares] = useState<bigint | null>(null);
  const [assets, setAssets] = useState<bigint | null>(null);
  const [denom, setDenom] = useState<(typeof MAINNET_DENS)[number]>("0.1");
  const [redeemPercent, setRedeemPercent] = useState<RedeemPercent>(100);
  const [market, setMarket] = useState<VesuMarketStats | null>(null);
  const [previousApy, setPreviousApy] = useState<number | null>(null);
  const [marketError, setMarketError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<EarnPhase>("idle");
  const writeGate = useRef(getEarnWriteGate()).current;
  const amount = denominationBaseUnits(denom);
  const reduceMotion = useReducedMotion();
  const revealed = readyAddress !== null && usdc !== null;

  useEffect(() => {
    let active = true;
    if (mode !== "mainnet") return;
    void fetchVesuMarket()
      .then((value) => {
        if (active) {
          setPreviousApy(
            rememberApySnapshot(
              config.poolAddress,
              config.underlyingAddress,
              value,
            ),
          );
          setMarket(value);
          setMarketError(false);
        }
      })
      .catch(() => {
        if (active) setMarketError(true);
      });
    return () => {
      active = false;
    };
  }, [config.poolAddress, config.underlyingAddress, mode]);

  async function loadPrivatePosition(): Promise<void> {
    const connected = await connectReady("mainnet");
    if (!sameFelt(connected.address, linkedAddress)) {
      throw new Error("Connect the Ready account linked to this Wotta profile");
    }
    const [privateUsdc, position] = await Promise.all([
      readMainnetPrivateBalance(connected.account),
      readVesuPosition(connected.account),
    ]);
    setReadyAddress(connected.address);
    setUsdc(privateUsdc);
    setShares(position.shares);
    setAssets(position.assets);
  }

  async function refresh() {
    if (mode !== "mainnet" || !linkedAddress) return;
    if (!writeGate.tryBegin()) return;
    void fetchVesuMarket({ force: true })
      .then((value) => {
        setPreviousApy(
          rememberApySnapshot(
            config.poolAddress,
            config.underlyingAddress,
            value,
          ),
        );
        setMarket(value);
        setMarketError(false);
      })
      .catch(() => setMarketError(true));
    const operation = beginNetworkOperation(mode, {
      blocksNetworkSwitch: true,
    });
    setBusy(true);
    setPhase("revealing");
    try {
      operation.assertActive();
      await loadPrivatePosition();
      operation.assertActive();
    } catch (error) {
      toast.error(
        userFacingError(error, "Could not load your private Vesu position"),
      );
    } finally {
      operation.finish();
      writeGate.end();
      setBusy(false);
      setPhase("idle");
    }
  }

  async function deposit() {
    if (
      !readyAddress ||
      usdc === null ||
      amount > usdc ||
      !canDeposit(
        { mode, readyAddress, linkedAddress, amount },
        config,
        writePolicy,
      )
    )
      return;
    if (!writeGate.tryBegin()) return;
    const operation = beginNetworkOperation(mode, {
      blocksNetworkSwitch: true,
    });
    setBusy(true);
    setPhase("checking");
    try {
      const connected = await connectReady("mainnet");
      if (!sameFelt(connected.address, linkedAddress))
        throw new Error(
          "Connect the Ready account linked to this Wotta profile",
        );
      await assertVesuRuntime(connected.account, writePolicy);
      setPhase("authorizing");
      const actions = buildVesuDepositActions(connected.address, amount);
      setPhase("supplying");
      const hash = await submitMainnetStrk20Actions(
        connected.account,
        actions,
        operation.signal,
      );
      const verification = await verifyVesuEarnTransaction(
        connected.account.provider,
        hash,
        { operation: "deposit", expectedInAmount: amount, config },
      );
      if (!verification.ok) {
        throw new Error(
          `vesu_receipt_verification_failed:${verification.problems.join("|")}`,
        );
      }
      if (claimEarnTxHandled(hash)) {
        recordDeposit(connected.address, config.vTokenAddress, amount);
        toast.success("Private USDC supplied to Vesu", {
          action: {
            label: "Explorer",
            onClick: () =>
              window.open(
                `https://starkscan.co/tx/${hash}?network=mainnet`,
                "_blank",
              ),
          },
        });
        window.dispatchEvent(new CustomEvent("wotta:private-balance-invalidate"));
      }
      // Free the CTA before balance reload so a lingering Ready dialog cannot
      // freeze the button on "Unlocking private balance…".
      setBusy(false);
      setPhase("idle");
      try {
        await loadPrivatePosition();
      } catch (error) {
        toast.error(
          userFacingError(error, "Could not refresh your private Vesu position"),
        );
      }
    } catch (error) {
      toast.error(userFacingError(error, "Could not start earning"));
    } finally {
      operation.finish();
      writeGate.end();
      setBusy(false);
      setPhase("idle");
    }
  }

  async function withdraw() {
    if (
      !readyAddress ||
      shares === null ||
      !canWithdraw(
        { mode, readyAddress, linkedAddress, privateShares: shares },
        config,
        writePolicy,
      )
    )
      return;
    if (!writeGate.tryBegin()) return;
    const operation = beginNetworkOperation(mode, {
      blocksNetworkSwitch: true,
    });
    setBusy(true);
    setPhase("checking");
    try {
      const connected = await connectReady("mainnet");
      if (!sameFelt(connected.address, linkedAddress))
        throw new Error(
          "Connect the Ready account linked to this Wotta profile",
        );
      await assertVesuRuntime(connected.account, writePolicy);
      setPhase("authorizing");
      const freshShares = await readMainnetPrivateTokenBalance(
        connected.account,
        config.vTokenAddress,
      );
      const redeemShares =
        redeemPercent === 100
          ? freshShares
          : (freshShares * BigInt(redeemPercent)) / 100n;
      if (redeemShares <= 0n)
        throw new Error("No private vUSDC is available to withdraw");
      setPhase("redeeming");
      const hash = await submitMainnetStrk20Actions(
        connected.account,
        buildVesuRedeemActions(connected.address, redeemShares, freshShares),
        operation.signal,
      );
      const verification = await verifyVesuEarnTransaction(
        connected.account.provider,
        hash,
        { operation: "redeem", expectedInAmount: redeemShares, config },
      );
      if (!verification.ok) {
        throw new Error(
          `vesu_receipt_verification_failed:${verification.problems.join("|")}`,
        );
      }
      if (claimEarnTxHandled(hash)) {
        recordRedeem(
          connected.address,
          config.vTokenAddress,
          freshShares,
          freshShares - redeemShares,
        );
        toast.success("Private vUSDC redeemed to private USDC", {
          action: {
            label: "Explorer",
            onClick: () =>
              window.open(
                `https://starkscan.co/tx/${hash}?network=mainnet`,
                "_blank",
              ),
          },
        });
        window.dispatchEvent(new CustomEvent("wotta:private-balance-invalidate"));
      }
      setBusy(false);
      setPhase("idle");
      try {
        await loadPrivatePosition();
      } catch (error) {
        toast.error(
          userFacingError(error, "Could not refresh your private Vesu position"),
        );
      }
    } catch (error) {
      toast.error(userFacingError(error, "Could not withdraw from Vesu"));
    } finally {
      operation.finish();
      writeGate.end();
      setBusy(false);
      setPhase("idle");
    }
  }

  if (mode !== "mainnet")
    return (
      <Unavailable
        icon={<ShieldAlert className="size-5" />}
        text={earnUnavailableReason(mode, config)}
      />
    );
  if (!linkedAddress)
    return (
      <Unavailable
        icon={<LockKeyhole className="size-5" />}
        text="Link a Ready Mainnet wallet from the Wallet tab before using Earn."
      />
    );

  const balanceShort = usdc !== null && amount > usdc;
  const depositAllowed =
    canDeposit(
      { mode, readyAddress, linkedAddress, amount },
      config,
      writePolicy,
    ) &&
    usdc !== null &&
    !balanceShort;
  const canDepositSubmit = Boolean(readyAddress) && depositAllowed && !busy;
  const hasPosition = shares !== null && shares > 0n;
  const withdrawAllowed = canWithdraw(
    {
      mode,
      readyAddress,
      linkedAddress,
      privateShares: shares ?? 0n,
    },
    config,
    writePolicy,
  );
  const canRedeemSubmit =
    Boolean(readyAddress) && hasPosition && withdrawAllowed && !busy;

  return (
    <section className="radius-surface border border-border/80 bg-card p-4 shadow-card sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <SegmentedTabs
          layoutId="earn-actions"
          ariaLabel="Earn action"
          value={tab}
          onValueChange={setTab}
          items={EARN_TABS}
          className="border-border bg-card shadow-soft"
          itemClassName="min-h-9 px-3.5 py-2 text-xs capitalize"
          indicatorClassName="border-brand-muted bg-brand-muted shadow-none"
          activeClassName="font-semibold text-brand-ink"
          inactiveClassName="font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        />
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            aria-label="Refresh private balance"
            className="inline-flex size-9 items-center justify-center rounded-full border border-border/70 bg-card text-muted-foreground outline-none transition-[background-color,color,opacity] duration-100 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <RefreshCw
              className={cn(
                "size-3.5",
                busy && phase === "revealing" && "animate-spin",
              )}
              aria-hidden
            />
          </button>
          {!revealed ? (
            <Button
              size="sm"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void refresh()}
              className="min-h-9"
            >
              {busy && phase === "revealing" ? (
                <RefreshCw className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Eye className="size-3.5" aria-hidden />
              )}
              {busy && phase === "revealing" ? "Revealing…" : "Reveal"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-border/60 bg-muted/40 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {tab === "deposit" ? "Shielded USDC" : "Shielded vUSDC"}
            </p>
            <div className="mt-1.5 flex items-center gap-2.5">
              <PrivateTokenIcon
                className="size-7"
                badge={tab === "deposit" ? "lock" : "v"}
              />
              <p className="font-mono text-xl font-semibold tabular-nums tracking-tight text-foreground">
                {tab === "deposit"
                  ? usdc === null
                    ? "••••"
                    : formatUsdc(usdc)
                  : assets === null
                    ? "••••"
                    : formatUsdc(assets)}
              </p>
            </div>
            {tab === "redeem" && shares !== null ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {shares === 0n
                  ? "No active position"
                  : `${formatShares(shares)} private shares`}
              </p>
            ) : null}
          </div>
          <div className="max-w-[55%] shrink-0 text-right">
            <p className="text-xs text-muted-foreground">Supply APY</p>
            <p className="mt-1 font-mono text-xl font-semibold tabular-nums tracking-tight text-foreground">
              {market?.supplyApy == null
                ? "—"
                : `${formatApySignificant(market.supplyApy)}%`}
            </p>
            <div className="mt-1 [&>div]:mt-0 [&>div]:justify-end [&>p]:text-right">
              <ApyMovement
                apy={market?.supplyApy ?? null}
                previousApy={previousApy}
                utilization={market?.utilization ?? null}
              />
            </div>
            {marketError ? (
              <p className="mt-1 text-xs text-warning-foreground">
                Live rate unavailable. Refresh to try again.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {tab === "deposit" ? (
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canDepositSubmit) void deposit();
          }}
        >
          <div className="radius-surface-inner border border-brand/15 bg-brand-mist px-4 py-4 sm:px-5">
            <DenomChips
              value={denom}
              onChange={(next: Dens) => {
                if (next === "0.1" || next === 1n) setDenom(next);
              }}
              disabled={busy}
              denominations={MAINNET_DENS}
            />
          </div>

          {balanceShort ? (
            <p className="text-xs text-destructive" role="alert">
              Higher than your private balance.
            </p>
          ) : null}

          <MotionPillButton
            type="submit"
            className="w-full min-h-12 text-base"
            disabled={!canDepositSubmit}
            aria-busy={busy}
          >
            {busy && tab === "deposit" ? (
              <TextShimmer className="text-base font-semibold">
                {depositPhaseLabel(phase, denom)}
              </TextShimmer>
            ) : (
              <>
                <Sparkles className="size-4" aria-hidden />
                {depositPhaseLabel("idle", denom)}
              </>
            )}
          </MotionPillButton>
        </form>
      ) : (
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canRedeemSubmit) void withdraw();
          }}
        >
          <div className="radius-surface-inner border border-brand/15 bg-brand-mist px-4 py-4 sm:px-5">
            <div className="text-center">
              <p className="text-sm font-semibold text-muted-foreground">
                Amount
              </p>
              <div
                role="group"
                aria-label="Redeem amount"
                className="mt-3 grid w-full grid-cols-3 gap-2"
              >
                {REDEEM_PERCENTS.map((item) => {
                  const selected = redeemPercent === item.value;
                  const chipDisabled = busy || !hasPosition;
                  return (
                    <motion.button
                      key={item.value}
                      data-motion-button
                      type="button"
                      disabled={chipDisabled}
                      aria-pressed={selected}
                      whileTap={chipDisabled || reduceMotion ? undefined : buttonTap}
                      onClick={() => setRedeemPercent(item.value)}
                      className={cn(
                        "radius-control inline-flex min-h-10 cursor-pointer items-center justify-center border px-2 py-1.5 text-base font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-lg",
                        selected
                          ? "border-brand-muted/70 bg-brand/10 text-brand-ink shadow-soft"
                          : "border-border/60 bg-card/85 text-foreground/60 backdrop-blur-sm hover:bg-muted hover:text-foreground",
                        chipDisabled &&
                          "cursor-not-allowed opacity-50 hover:bg-card/85 hover:text-foreground/60",
                      )}
                    >
                      {item.label}
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </div>

          {!hasPosition && revealed ? (
            <p className="text-xs text-muted-foreground" role="status">
              No private vUSDC to redeem yet — deposit first.
            </p>
          ) : null}
          {!withdrawAllowed && hasPosition ? (
            <p className="text-xs text-warning-foreground" role="status">
              {earnUnavailableReason(mode, config)}
            </p>
          ) : null}

          <MotionPillButton
            type="submit"
            className="w-full min-h-12 text-base"
            disabled={!canRedeemSubmit}
            aria-busy={busy}
          >
            {busy && tab === "redeem" ? (
              <TextShimmer className="text-base font-semibold">
                {redeemPhaseLabel(phase, redeemPercent)}
              </TextShimmer>
            ) : (
              <>
                <Sparkles className="size-4" aria-hidden />
                {redeemPhaseLabel("idle", redeemPercent)}
              </>
            )}
          </MotionPillButton>
        </form>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 text-xs">
        <p className="min-w-0 leading-5 text-muted-foreground">
          Private vUSDC stays shielded. Market, amount, and timing stay public
          onchain.
        </p>
        <a
          href={config.marketPageUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 min-h-10 items-center gap-1.5 font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Market <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
    </section>
  );
}

function Unavailable({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <section className="radius-surface border border-border/80 bg-card p-6 text-center shadow-card">
      <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {icon}
      </span>
      <h2 className="mt-4 font-semibold text-foreground">
        Vesu Earn unavailable
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        {text}
      </p>
    </section>
  );
}
