"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Loader2, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import type { WalletAccountV6 } from "starknet";
import { Button } from "@/components/ui/Button";
import { TextShimmer } from "@/components/ui/TextShimmer";
import { userFacingError } from "@/lib/errors";
import {
  createPrivacyClient,
  deployPrivacyIdentity,
  isIdentityRegistered,
} from "@/lib/wotta/privacy-account";
import { directPrivacyConfig } from "@/lib/wotta/privacy-config";
import { registerIdentity } from "@/lib/wotta/privacy-flow";
import { unlockPrivacyVault, type PrivacyVault } from "@/lib/wotta/privacy-state";
import { createBrowserProductSession } from "@/lib/wotta/product-session";
import { connectReady } from "@/lib/wotta/ready";

type ModalStep = "choose" | "link" | "done";
type LinkPhase =
  | "idle"
  | "connecting"
  | "unlocking"
  | "binding"
  | "deploying"
  | "proving"
  | "submitting";

type LinkedMe = Awaited<ReturnType<ReturnType<typeof createBrowserProductSession>["me"]>>;

type Props = {
  open: boolean;
  onClose: () => void;
  onLinked: (me: LinkedMe) => void | Promise<void>;
};

const STEP_BAR: { key: ModalStep; label: string }[] = [
  { key: "choose", label: "Wallet" },
  { key: "link", label: "Private identity" },
];

const phaseLabel: Record<LinkPhase, string> = {
  idle: "",
  connecting: "Connecting Ready…",
  unlocking: "Unlocking local privacy state…",
  binding: "Confirm wallet binding…",
  deploying: "Deploying private identity…",
  proving: "Generating privacy proof…",
  submitting: "Submitting proof on Sepolia…",
};

export function WalletConnectModal({ open, onClose, onLinked }: Props) {
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<ModalStep>("choose");
  const [phase, setPhase] = useState<LinkPhase>("idle");
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<WalletAccountV6 | null>(null);
  const [vault, setVault] = useState<PrivacyVault | null>(null);
  const [linkedAddress, setLinkedAddress] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("choose");
    setPhase("idle");
    setBusy(false);
    setAccount(null);
    setVault(null);
    setLinkedAddress(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [busy, onClose, open]);

  async function chooseReady() {
    setBusy(true);
    setPhase("connecting");
    try {
      const connected = await connectReady();
      setPhase("unlocking");
      const privacyVault = await unlockPrivacyVault(connected.account, directPrivacyConfig());
      setAccount(connected.account);
      setVault(privacyVault);
      setLinkedAddress(connected.address);
      setStep("link");
    } catch (error) {
      toast.error(userFacingError(error, "Couldn’t connect Ready"));
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  }

  async function bindAndRegister() {
    if (!account || !vault) return;
    setBusy(true);
    try {
      const config = directPrivacyConfig();
      const session = createBrowserProductSession();
      setPhase("binding");
      await session.bindReadyAndIdentity(account, vault);

      let identityAddress = vault.state.identityAddress;
      let minimumStateBlock: number | undefined;
      if (!identityAddress) {
        setPhase("deploying");
        const deployed = await deployPrivacyIdentity(account, config);
        identityAddress = deployed.address;
        minimumStateBlock = deployed.blockNumber;
        await vault.setIdentityAddress(identityAddress);
      }

      const transfers = createPrivacyClient(identityAddress, BigInt(vault.state.viewingKey), config);
      if (!(await isIdentityRegistered(account, config, identityAddress))) {
        await registerIdentity(
          account,
          transfers,
          (proofPhase) => {
            setPhase(proofPhase === "submitting" ? "submitting" : "proving");
          },
          minimumStateBlock,
        );
      }
      setPhase("binding");
      await session.publishPrivateIdentity(identityAddress);
      await session.syncSession();
      const linkedMe = await session.me();
      setStep("done");
      toast.success("Ready wallet and private identity linked");
      await onLinked(linkedMe);
    } catch (error) {
      toast.error(userFacingError(error, "Couldn’t complete private registration"));
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  }

  const stepIndex = STEP_BAR.findIndex((item) => item.key === step);
  const title =
    step === "choose" ? "Connect Ready wallet" :
    step === "link" ? "Activate private identity" :
    "Wallet linked";
  const subtitle =
    step === "choose"
      ? "Ready signs on Starknet Sepolia. Wotta never holds your wallet or viewing key."
      : step === "link"
        ? "Bind this wallet, deploy its private identity, and prove registration."
        : "Cross-chain claims can now settle into your private USDC balance.";

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[100] flex min-h-dvh w-full items-center justify-center overflow-y-auto px-4 py-8">
          <motion.button
            type="button"
            aria-label="Close wallet modal"
            className="absolute inset-0 min-h-full w-full bg-ink/40 backdrop-blur-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.15 }}
            onClick={() => { if (!busy) onClose(); }}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-connect-title"
            tabIndex={-1}
            className="radius-surface relative z-10 my-auto max-h-[min(90dvh,40rem)] w-full max-w-md overflow-y-auto border border-border/80 bg-card p-2 shadow-card outline-none"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: 8 }}
            transition={{ duration: reduce ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="radius-surface-inner border border-brand/15 bg-brand-mist p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 id="wallet-connect-title" className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
                <button
                  type="button"
                  onClick={() => { if (!busy) onClose(); }}
                  aria-label="Close"
                  disabled={busy}
                  className="radius-control inline-flex size-11 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <X className="size-5" aria-hidden />
                </button>
              </div>
              <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>

              {step !== "done" ? (
                <div className="mt-5 flex items-center gap-2">
                  {STEP_BAR.map((item, index) => (
                    <div key={item.key} className="h-1 flex-1 overflow-hidden rounded-full bg-muted" title={item.label}>
                      <motion.div
                        className="h-full rounded-full bg-brand"
                        initial={false}
                        animate={{ width: index < stepIndex ? "100%" : index === stepIndex ? "55%" : "0%" }}
                        transition={{ duration: reduce ? 0 : 0.35, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="mt-6 space-y-4">
                {linkedAddress ? (
                  <div className="rounded-xl border border-border/70 bg-card/70 px-4 py-3 font-mono text-xs break-all text-foreground">
                    {linkedAddress}
                  </div>
                ) : null}
                {step === "choose" ? (
                  <Button variant="outline" className="w-full justify-start" shape="rounded" disabled={busy} onClick={() => void chooseReady()}>
                    {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Wallet className="size-5" aria-hidden />}
                    <span className="flex-1 text-left">Ready</span>
                    <span className="text-xs text-muted-foreground">Starknet Sepolia</span>
                  </Button>
                ) : null}
                {step === "link" ? (
                  <Button className="w-full" disabled={busy || !account || !vault} onClick={() => void bindAndRegister()}>
                    {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Wallet className="size-4" aria-hidden />}
                    {busy ? <TextShimmer>{phaseLabel[phase]}</TextShimmer> : "Bind wallet & prove identity"}
                  </Button>
                ) : null}
                {step === "done" ? (
                  <div className="space-y-4 text-center">
                    <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
                      <Check className="size-6" aria-hidden />
                    </span>
                    <Button className="w-full" onClick={onClose}>Done</Button>
                  </div>
                ) : null}
                {busy && phase !== "idle" ? (
                  <p className="text-center text-xs text-muted-foreground" role="status" aria-live="polite">
                    {phaseLabel[phase]}
                  </p>
                ) : null}
              </div>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
