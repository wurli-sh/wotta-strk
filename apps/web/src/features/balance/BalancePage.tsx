"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageShell } from "@/components/PageShell";
import { PrivateBalancePanel } from "@/features/account/PrivateBalancePanel";
import { apiFetch, type MeResponse } from "@/lib/api/client";
import { userFacingError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";

export function BalancePage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void (async () => {
      try {
        const { data } = await createClient().auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        setMe(await apiFetch<MeResponse>("/v1/me", { token }));
      } catch (error) {
        toast.error(userFacingError(error, "Failed to load private balance"));
      } finally {
        setLoading(false);
      }
    })();
  }, []);
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
