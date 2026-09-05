"use client";

import { useEffect, useState } from "react";
import {
  Eye,
  ExternalLink,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import type { MeResponse } from "@/lib/api/client";
import { useNetworkMode } from "@/components/NetworkModeProvider";
import { DenomChips } from "@/components/DenomChips";
import { Button } from "@/components/ui/Button";
import { MotionPillButton } from "@/components/ui/MotionLink";
import { TextShimmer } from "@/components/ui/TextShimmer";
import { EarnPositionHero } from "./EarnPositionHero";
import { EarnYieldChart } from "./EarnYieldChart";
import { PrivateTokenIcon } from "./PrivateTokenIcon";
import { UsdcIcon } from "@/components/UsdcIcon";
import { MAINNET_DENS, denominationBaseUnits, type Dens } from "@/lib/denoms";
import { beginNetworkOperation } from "@/lib/network-operations";
import { userFacingError } from "@/lib/errors";
import { formatUsdc } from "@/lib/format/amount";
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
import { readLedger, recordDeposit, recordRedeem } from "@/lib/vesu/ledger";
import { assertVesuRuntime } from "@/lib/vesu/runtime";

type EarnPhase =
  | "idle"
  | "revealing"
  | "checking"
  | "authorizing"
  | "supplying";

function phaseLabel(
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
    case "idle":
    default:
      return `Yield ${denom} shielded USDC`;
  }
}

export function EarnPanel({ me }: { me: MeResponse | null }) {
  const { mode } = useNetworkMode();
  const config = loadVesuEarn();
  const linkedAddress = me?.wallet?.address ?? null;
  const [readyAddress, setReadyAddress] = useState<string | null>(null);
  const [usdc, setUsdc] = useState<bigint | null>(null);
  const [shares, setShares] = useState<bigint | null>(null);
  const [assets, setAssets] = useState<bigint | null>(null);
  const [denom, setDenom] = useState<(typeof MAINNET_DENS)[number]>("0.1");
  const [market, setMarket] = useState<VesuMarketStats | null>(null);
  const [previousApy, setPreviousApy] = useState<number | null>(null);
  const [marketError, setMarketError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<EarnPhase>("idle");
  const [ledgerRevision, setLedgerRevision] = useState(0);
  const amount = denominationBaseUnits(denom);

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

  async function refresh() {
    if (mode !== "mainnet" || !linkedAddress) return;
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
      const connected = await connectReady("mainnet");
      operation.assertActive();
      if (!sameFelt(connected.address, linkedAddress))
        throw new Error(
          "Connect the Ready account linked to this Wotta profile",
        );
      const [privateUsdc, position] = await Promise.all([
        readMainnetPrivateBalance(connected.account),
        readVesuPosition(connected.account),
      ]);
      operation.assertActive();
      setReadyAddress(connected.address);
      setUsdc(privateUsdc);
      setShares(position.shares);
      setAssets(position.assets);
    } catch (error) {
      toast.error(
        userFacingError(error, "Could not load your private Vesu position"),
      );
    } finally {
      operation.finish();
      setBusy(false);
      setPhase("idle");
    }
  }

  async function deposit() {
    if (
      !readyAddress ||
      usdc === null ||
      amount > usdc ||
      !canDeposit({ mode, readyAddress, linkedAddress, amount }, config)
    )
      return;
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
      await assertVesuRuntime(connected.account);
      setPhase("authorizing");
      const actions = buildVesuDepositActions(connected.address, amount);
      setPhase("supplying");
      const hash = await submitMainnetStrk20Actions(
        connected.account,
        actions,
        operation.signal,
      );
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
      setLedgerRevision((value) => value + 1);
      await refresh();
    } catch (error) {
      toast.error(userFacingError(error, "Could not start earning"));
    } finally {
      operation.finish();
      setBusy(false);
      setPhase("idle");
    }
  }

  async function withdraw(percent: 25 | 50 | 100) {
    if (
      !readyAddress ||
      shares === null ||
      !canWithdraw(
        { mode, readyAddress, linkedAddress, privateShares: shares },
        config,
      )
    )
      return;
    const operation = beginNetworkOperation(mode, {
      blocksNetworkSwitch: true,
    });
    setBusy(true);
    try {
      const connected = await connectReady("mainnet");
      if (!sameFelt(connected.address, linkedAddress))
        throw new Error(
          "Connect the Ready account linked to this Wotta profile",
        );
      await assertVesuRuntime(connected.account);
      const freshShares = await readMainnetPrivateTokenBalance(
        connected.account,
        config.vTokenAddress,
      );
      const redeemShares =
        percent === 100 ? freshShares : (freshShares * BigInt(percent)) / 100n;
      if (redeemShares <= 0n)
        throw new Error("No private vUSDC is available to withdraw");
      const hash = await submitMainnetStrk20Actions(
        connected.account,
        buildVesuRedeemActions(connected.address, redeemShares, freshShares),
        operation.signal,
      );
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
      setLedgerRevision((value) => value + 1);
      await refresh();
    } catch (error) {
      toast.error(userFacingError(error, "Could not withdraw from Vesu"));
    } finally {
      operation.finish();
      setBusy(false);
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

  const ledger = readyAddress
    ? readLedger(readyAddress, config.vTokenAddress)
    : null;
  void ledgerRevision;
  if (shares !== null && assets !== null && shares > 0n) {
    const withdrawAllowed = canWithdraw(
      { mode, readyAddress, linkedAddress, privateShares: shares },
      config,
    );
    return (
      <EarnPositionHero
        assets={assets}
        shares={shares}
        costBasisAssets={ledger ? BigInt(ledger.costBasisAssets) : null}
        firstDepositAt={ledger?.firstDepositAt ?? null}
        apy={market?.supplyApy ?? null}
        previousApy={previousApy}
        utilization={market?.utilization ?? null}
        marketPageUrl={config.marketPageUrl}
        onWithdraw={(percent) => void withdraw(percent)}
        withdrawDisabled={busy || !withdrawAllowed}
        disabledReason={
          !withdrawAllowed ? earnUnavailableReason(mode, config) : undefined
        }
      />
    );
  }

  const balanceShort = usdc !== null && amount > usdc;
  const admitted =
    canDeposit({ mode, readyAddress, linkedAddress, amount }, config) &&
    usdc !== null &&
    !balanceShort;
  const canSubmit = Boolean(readyAddress) && admitted && !busy;

  return (
    <section className="radius-surface border border-border/80 bg-card p-4 shadow-card sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <PrivateTokenIcon />
          <div className="min-w-0">
            <h2 className="font-semibold text-foreground">Private earn</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Vesu Prime · variable rate
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy}
            aria-label="Refresh private balance"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border/70 bg-card px-2.5 text-xs font-semibold text-muted-foreground outline-none transition-[background-color,color,opacity] duration-100 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            Refresh
          </button>
          <span className="rounded-full bg-mainnet-soft px-2.5 py-1 text-xs font-semibold text-mainnet-ink">
            Mainnet
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2.5 rounded-2xl border border-border/60 bg-muted/40 px-3 py-2.5">
        <UsdcIcon className="size-6 shrink-0" />
        <p className="font-mono text-xl font-semibold tabular-nums tracking-tight text-foreground">
          {usdc === null ? "••••" : formatUsdc(usdc)}
        </p>
        <LockKeyhole className="size-4 shrink-0 text-muted-foreground" aria-label="Private balance" />
        <span className="min-w-0 flex-1" aria-hidden />
        {usdc === null ? (
          <Button
            size="sm"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void refresh()}
            className="shrink-0"
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

      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) void deposit();
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

        <EarnYieldChart
          principal={amount}
          apy={market?.supplyApy ?? null}
          previousApy={previousApy}
          utilization={market?.utilization ?? null}
          compact
        />
        {marketError ? (
          <p className="text-xs text-warning-foreground">
            Live rate unavailable. Refresh to try again.
          </p>
        ) : null}

        <MotionPillButton
          type="submit"
          className="w-full min-h-12 text-base"
          disabled={!canSubmit}
          aria-busy={busy}
        >
          {busy ? (
            <TextShimmer className="text-base font-semibold">
              {phaseLabel(phase, denom)}
            </TextShimmer>
          ) : (
            <>
              <Sparkles className="size-4" aria-hidden />
              {phaseLabel("idle", denom)}
            </>
          )}
        </MotionPillButton>
      </form>

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
