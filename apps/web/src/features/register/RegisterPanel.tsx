"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/Button";
import { SignInAuthPanel } from "@/components/SignInAuthPanel";
import { WalletConnectModal } from "@/components/WalletConnectModal";
import { apiFetch, type MeResponse } from "@/lib/api/client";
import { userFacingError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";

type Step = "oauth" | "wallet" | "identity" | "done";

export function RegisterPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const [step, setStep] = useState<Step>("oauth");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const { data } = await createClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setMe(null);
        setStep("oauth");
        return;
      }
      await apiFetch("/v1/session/sync", { token, method: "POST", body: {} });
      const profile = await apiFetch<MeResponse>("/v1/me", { token });
      setMe(profile);
      if (profile.wallet?.private_identity_verified_at) setStep("done");
      else if (profile.wallet) setStep("identity");
      else setStep("wallet");
    } catch (error) {
      toast.error(userFacingError(error, "Couldn’t load registration"));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function logout() {
    await createClient().auth.signOut();
    setMe(null);
    setStep("oauth");
  }

  const content = (
    <>
      <ol className="space-y-3 text-sm text-muted-foreground">
        {([
          ["oauth", "Sign in with Google or X"],
          ["wallet", "Connect and bind Ready"],
          ["identity", "Deploy and prove private identity"],
          ["done", "Ready for private cross-chain claims"],
        ] as const).map(([id, label]) => (
          <li key={id} className={step === id ? "font-semibold text-primary" : ""}>{label}</li>
        ))}
      </ol>
      <div className="mt-6 flex flex-wrap gap-3">
        {step === "oauth" ? (
          <SignInAuthPanel
            redirectNext="/account?tab=wallet&setup=wallet"
            onAuthenticated={() => void refresh()}
          />
        ) : null}
        {step === "wallet" || step === "identity" ? (
          <Button disabled={busy} onClick={() => setWalletOpen(true)}>
            {step === "wallet" ? "Connect Ready" : "Complete private identity"}
          </Button>
        ) : null}
        {step === "done" ? <Button href="/send">Start sending</Button> : null}
        {step !== "oauth" ? <Button variant="outline" onClick={() => void logout()}>Sign out</Button> : null}
      </div>
      {me ? (
        <div className="mt-8 rounded-[var(--radius-surface)] border border-border bg-card p-4 text-sm">
          <p className="break-all"><span className="text-muted-foreground">Ready wallet</span> {me.wallet?.address ?? "—"}</p>
          <p className="break-all"><span className="text-muted-foreground">Private identity</span> {me.wallet?.private_identity_address ?? "—"}</p>
          <p className="mt-2 text-warning">Sepolia only · viewing key stays encrypted in this browser</p>
        </div>
      ) : null}
      <WalletConnectModal
        open={walletOpen}
        onClose={() => setWalletOpen(false)}
        onLinked={async () => {
          await refresh();
          setWalletOpen(false);
        }}
      />
    </>
  );

  return embedded ? content : (
    <PageShell
      title="Connect wallet"
      subtitle="Google or X → Ready on Starknet Sepolia → private identity proof."
    >
      {content}
    </PageShell>
  );
}
