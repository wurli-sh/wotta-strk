"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageShell } from "@/components/PageShell";
import { PrivateBalancePanel } from "@/features/account/PrivateBalancePanel";
import { apiFetch, type MeResponse } from "@/lib/api/client";
import { userFacingError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { useNetworkMode } from "@/components/NetworkModeProvider";
import { MainnetBalanceInbox } from "@/features/inbox/MainnetBalanceInbox";
import { beginNetworkOperation } from "@/lib/network-operations";

export function BalancePage() {
  const { mode } = useNetworkMode();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (mode === "mainnet") {
      setLoading(false);
      setMe(null);
      return;
    }
    const operation = beginNetworkOperation("testnet");
    void (async () => {
      try {
        const { data } = await createClient().auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        setMe(await apiFetch<MeResponse>("/v1/me", { token, network: "testnet", signal: operation.signal }));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          toast.error(userFacingError(error, "Failed to load private balance"));
        }
      } finally {
        operation.finish();
        setLoading(false);
      }
    })();
    return () => operation.cancel();
  }, [mode]);
  if (mode === "mainnet") {
    return (
      <PageShell title="Private balance" subtitle="Live-pool mainnet balance and public withdrawal." maxWidth="md">
        <MainnetBalanceInbox />
      </PageShell>
    );
  }
  return (
    <PageShell
      title="Private balance"
      subtitle="Private USDC notes on Starknet Sepolia"
      maxWidth="md"
    >
      <PrivateBalancePanel wallet={me?.wallet ?? null} loading={loading} />
    </PageShell>
  );
}
