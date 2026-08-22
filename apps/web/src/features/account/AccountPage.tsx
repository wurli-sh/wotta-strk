"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { Session } from "@supabase/supabase-js";
import { PageShell } from "@/components/PageShell";
import { TabContentShimmer } from "@/components/PageShimmer";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { HandlesPanel } from "@/components/account/HandlesPanel";
import { WalletPanel } from "@/components/account/WalletPanel";
import { PrivateBalancePanel } from "@/features/account/PrivateBalancePanel";
import type { MeResponse } from "@/lib/api/client";
import { fetchMe, mergeMeResponse, notifySessionChanged, refreshSupabaseSession, syncWottaSession } from "@/lib/auth";
import { userFacingError } from "@/lib/errors";
import { withMinSkeleton } from "@/lib/skeleton-hold";
import { createClient } from "@/lib/supabase/client";
import {
  AccountSkeleton,
  HandlesPanelSkeleton,
  WalletPanelSkeleton,
} from "@/components/ui/Skeleton";

type AccountTab = "handles" | "wallet";

const tabs = [
  { value: "handles", label: "Handles" },
  { value: "wallet", label: "Wallet" },
] as const;

function parseTab(value: string | null): AccountTab {
  if (value === "wallet") return "wallet";
  return "handles";
}

function AccountContent() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = parseTab(params.get("tab"));
  const setupWallet = params.get("setup") === "wallet";
  const [me, setMe] = useState<MeResponse | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoOpenWallet, setAutoOpenWallet] = useState(false);

  const refreshAccount = useCallback(async (opts?: { hold?: boolean; preserveWallet?: boolean }) => {
    try {
      const work = async () => {
        await refreshSupabaseSession();
        const { data } = await createClient().auth.getSession();
        setSession(data.session);
        if (!data.session?.access_token) {
          setMe(null);
          return;
        }
        await syncWottaSession({ notify: false });
        const res = await fetchMe(data.session.access_token);
        if (res.ok) {
          setMe((prev) => {
            const merged = mergeMeResponse(prev, res.data);
            if (opts?.preserveWallet && prev?.wallet && !res.data.wallet) {
              return { ...merged, wallet: prev.wallet };
            }
            return merged;
          });
          notifySessionChanged();
        } else {
          toast.error(userFacingError(res.error, "Couldn't refresh account"));
        }
      };
      if (opts?.hold) await withMinSkeleton(work);
      else await work();
    } catch (error) {
      toast.error(userFacingError(error, "Couldn't refresh account"));
    }
  }, []);

  const loadAccount = useCallback(async (opts?: { hold?: boolean }) => {
    setLoading(true);
    try {
      const work = async () => {
        await refreshSupabaseSession();
        const { data } = await createClient().auth.getSession();
        setSession(data.session);
        if (data.session?.access_token) {
          await syncWottaSession({ notify: false });
          const res = await fetchMe(data.session.access_token);
          if (res.ok) setMe((prev) => mergeMeResponse(prev, res.data));
          else setMe(null);
        } else {
          setMe(null);
        }
      };
      if (opts?.hold) await withMinSkeleton(work);
      else await work();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  useEffect(() => {
    if (!setupWallet) return;
    setAutoOpenWallet(true);
    const query = new URLSearchParams(params.toString());
    query.delete("setup");
    query.set("tab", "wallet");
    router.replace(`${pathname}?${query}`, { scroll: false });
  }, [setupWallet, params, pathname, router]);

  useEffect(() => {
    const authError = params.get("authError");
    if (!authError) return;
    toast.error(userFacingError(authError, "Sign-in did not complete — try again"), {
      id: "auth-callback-error",
    });
    const query = new URLSearchParams(params.toString());
    query.delete("authError");
    router.replace(query.size ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [params, pathname, router]);

  useEffect(() => {
    const raw = params.get("tab");
    if (raw !== "balance" && raw !== "identity") return;
    const query = new URLSearchParams(params.toString());
    query.delete("tab");
    router.replace(query.size ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [params, pathname, router]);

  function changeTab(next: AccountTab) {
    const query = new URLSearchParams(params.toString());
    if (next === "handles") query.delete("tab");
    else query.set("tab", next);
    query.delete("setup");
    router.replace(query.size ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  return (
    <PageShell
      title="Account"
      subtitle={
        session
          ? "Your handles, Ready wallet, and private identity."
          : "Sign in from the navigation to manage your handles and wallet."
      }
      maxWidth="md"
    >
      {loading ? (
        <>
          <div className="mb-6 flex justify-center">
            <SegmentedTabs
              layoutId="account-sections"
              ariaLabel="Account sections"
              value={tab}
              onValueChange={changeTab}
              items={tabs}
            />
          </div>
          {tab === "wallet" ? <WalletPanelSkeleton /> : <HandlesPanelSkeleton />}
        </>
      ) : null}

      {!loading && session ? (
        <>
          <div className="mb-6 flex justify-center">
            <SegmentedTabs
              layoutId="account-sections"
              ariaLabel="Account sections"
              value={tab}
              onValueChange={changeTab}
              items={tabs}
            />
          </div>
          <TabContentShimmer
            holdKey={tab}
            skeleton={
              tab === "wallet" ? <WalletPanelSkeleton /> : <HandlesPanelSkeleton />
            }
          >
            {tab === "handles" ? (
              <HandlesPanel
                me={me}
                session={session}
                onLinked={() => {
                  void refreshAccount({ hold: true });
                }}
              />
            ) : null}
            {tab === "wallet" ? (
              <div className="space-y-4">
                <WalletPanel
                  me={me}
                  autoOpenConnect={autoOpenWallet}
                  onLinked={async (linkedMe) => {
                    const nextMe: MeResponse = {
                      profile: linkedMe.profile ?? me?.profile ?? null,
                      identities: linkedMe.identities.length ? linkedMe.identities : me?.identities ?? [],
                      wallet: linkedMe.wallet
                        ? {
                            address: linkedMe.wallet.address,
                            inbox_pubkey: linkedMe.wallet.inbox_pubkey,
                            chain_id: me?.wallet?.chain_id ?? "SN_SEPOLIA",
                            key_version: me?.wallet?.key_version ?? 1,
                            private_identity_address:
                              linkedMe.wallet.private_identity_address ?? me?.wallet?.private_identity_address,
                            privacy_pool_address:
                              linkedMe.wallet.privacy_pool_address ?? me?.wallet?.privacy_pool_address,
                            private_identity_verified_at:
                              me?.wallet?.private_identity_verified_at ?? new Date().toISOString(),
                          }
                        : null,
                    };
                    if (linkedMe.wallet) {
                      setMe((prev) => mergeMeResponse(prev, nextMe));
                      notifySessionChanged();
                      return;
                    }
                    setMe((prev) => (prev ? { ...prev, wallet: null } : nextMe));
                    void refreshAccount({ hold: true });
                  }}
                />
                <PrivateBalancePanel wallet={me?.wallet ?? null} />
              </div>
            ) : null}
          </TabContentShimmer>
        </>
      ) : null}
    </PageShell>
  );
}

export function AccountPage() {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <AccountContent />
    </Suspense>
  );
}
