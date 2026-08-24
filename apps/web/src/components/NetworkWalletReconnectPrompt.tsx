"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ShieldCheck, X } from "lucide-react";
import { WalletConnectModal } from "@/components/WalletConnectModal";
import { useNetworkMode } from "@/components/NetworkModeProvider";
import { Button } from "@/components/ui/Button";
import { fetchMe, getAccessToken, notifySessionChanged } from "@/lib/auth";
import {
  networkReconnectBody,
  networkReconnectTitle,
  WALLET_RECONNECT_REQUEST_EVENT,
  type WalletReconnectRequest,
} from "@/lib/network-reconnect";
import { NETWORK_MODE_EVENT, readNetworkMode, type NetworkMode } from "@/lib/network-mode";

export function NetworkWalletReconnectPrompt() {
  const reduce = useReducedMotion();
  const [introOpen, setIntroOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [linkedWalletAddress, setLinkedWalletAddress] = useState<string | null>(null);
  const [promptMode, setPromptMode] = useState<NetworkMode>("testnet");

  const openReconnect = useCallback((detail: WalletReconnectRequest, nextMode: NetworkMode = readNetworkMode()) => {
    setPromptMode(nextMode);
    if (detail.linkedWalletAddress) {
      setLinkedWalletAddress(detail.linkedWalletAddress);
    }
    if (detail.immediate) {
      setIntroOpen(false);
      setConnectOpen(true);
      return;
    }
    setIntroOpen(true);
  }, []);

  useEffect(() => {
    async function onNetworkChanged(event: Event) {
      const nextMode = (event as CustomEvent<NetworkMode>).detail;
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetchMe(token);
      if (!res.ok || !res.data.wallet?.address) return;
      setLinkedWalletAddress(res.data.wallet.address);
      openReconnect({ linkedWalletAddress: res.data.wallet.address }, nextMode);
    }

    function onReconnectRequest(event: Event) {
      const detail = (event as CustomEvent<WalletReconnectRequest>).detail ?? {};
      openReconnect(detail, readNetworkMode());
    }

    window.addEventListener(NETWORK_MODE_EVENT, onNetworkChanged);
    window.addEventListener(WALLET_RECONNECT_REQUEST_EVENT, onReconnectRequest);
    return () => {
      window.removeEventListener(NETWORK_MODE_EVENT, onNetworkChanged);
      window.removeEventListener(WALLET_RECONNECT_REQUEST_EVENT, onReconnectRequest);
    };
  }, [openReconnect]);

  function beginConnect() {
    setIntroOpen(false);
    setConnectOpen(true);
  }

  return (
    <>
      <AnimatePresence>
        {introOpen ? (
          <div className="fixed inset-0 z-[95] flex min-h-dvh items-center justify-center px-4 py-8">
            <motion.button
              type="button"
              aria-label="Dismiss reconnect prompt"
              className="absolute inset-0 min-h-full w-full bg-ink/40 backdrop-blur-[2px]"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              onClick={() => setIntroOpen(false)}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="network-reconnect-title"
              className="radius-surface relative z-10 w-full max-w-md border border-border/80 bg-card p-2 shadow-card"
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: 8 }}
            >
              <div
                className={
                  promptMode === "mainnet"
                    ? "radius-surface-inner border border-mainnet-border/60 bg-mainnet-soft/40 p-5 sm:p-6"
                    : "radius-surface-inner border border-brand-muted/70 bg-brand-mist p-5 sm:p-6"
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span
                      className={
                        promptMode === "mainnet"
                          ? "flex size-10 shrink-0 items-center justify-center rounded-xl border border-mainnet-border bg-mainnet-soft text-mainnet-strong"
                          : "flex size-10 shrink-0 items-center justify-center rounded-xl border border-brand-muted bg-brand-soft text-brand-ink"
                      }
                    >
                      <ShieldCheck className="size-4" aria-hidden />
                    </span>
                    <div>
                      <h2 id="network-reconnect-title" className="text-lg font-semibold tracking-tight text-foreground">
                        {networkReconnectTitle(promptMode)}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {networkReconnectBody(promptMode)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={() => setIntroOpen(false)}
                    className="radius-control inline-flex size-10 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  >
                    <X className="size-5" aria-hidden />
                  </button>
                </div>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <Button className="flex-1" onClick={beginConnect}>
                    Reconnect Ready
                  </Button>
                  <Button className="flex-1" variant="outline" onClick={() => setIntroOpen(false)}>
                    Not now
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      <WalletConnectModal
        open={connectOpen}
        reconnect
        linkedWalletAddress={linkedWalletAddress}
        onClose={() => setConnectOpen(false)}
        onLinked={async () => {
          setConnectOpen(false);
          notifySessionChanged();
        }}
      />
    </>
  );
}
