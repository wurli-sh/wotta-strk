"use client";

import { useEffect, useState } from "react";
import { AtSign, Mail, Unlink } from "lucide-react";
import { toast } from "sonner";
import type { Session, UserIdentity } from "@supabase/supabase-js";
import { GoogleIcon, XBrandIcon } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { HandlesPanelSkeleton } from "@/components/ui/Skeleton";
import type { MeResponse } from "@/lib/api/client";
import { TOAST } from "@/lib/brand-copy";
import { toastInfo, userFacingError } from "@/lib/errors";
import { syncWottaSession } from "@/lib/auth";
import type { WottaOAuthProvider } from "@/lib/supabase/providers";
import { createBrowserProductSession } from "@/lib/wotta/product-session";

type Props = {
  me: MeResponse | null;
  session: Session | null;
  loading?: boolean;
  onLinked: () => void | Promise<void>;
};

type HandleRow = {
  key: string;
  provider: "x" | "google" | "email";
  identifier: string;
  /** product @handle row (always X) */
  isWottaHandle?: boolean;
  subtitle: string;
  /** Supabase identity to unlink, if any */
  identity?: UserIdentity;
};

function ProviderIcon({ provider }: { provider: HandleRow["provider"] }) {
  const className = "h-4 w-4 shrink-0 text-brand-ink";
  if (provider === "google") return <GoogleIcon className={className} />;
  if (provider === "x") return <XBrandIcon className={className} />;
  return <Mail className={className} aria-hidden />;
}

function providerLabel(provider: HandleRow["provider"]): string {
  if (provider === "x") return "X";
  if (provider === "google") return "Google";
  return "Email";
}

function isXIdentityProvider(p?: string | null): boolean {
  const s = String(p ?? "").toLowerCase();
  return s === "x" || s === "twitter";
}

function identityEmail(id: UserIdentity | undefined): string {
  if (!id) return "";
  const data = (id.identity_data ?? {}) as Record<string, unknown>;
  return String(data.email ?? data.user_email ?? "").trim().toLowerCase();
}

export function HandlesPanel({ me, session, loading, onLinked }: Props) {
  const [busy, setBusy] = useState(false);

  const identities = session?.user.identities ?? [];

  const xIdentity = identities.find((i) => isXIdentityProvider(i.provider));
  const googleIdentity = identities.find(
    (i) => String(i.provider ?? "").toLowerCase() === "google",
  );
  const emailIdentity = identities.find(
    (i) => String(i.provider ?? "").toLowerCase() === "email",
  );

  const meta = session?.user.user_metadata ?? {};
  const xUsername = String(
    meta.user_name ??
      meta.preferred_username ??
      xIdentity?.identity_data?.user_name ??
      xIdentity?.identity_data?.preferred_username ??
      xIdentity?.identity_data?.screen_name ??
      "",
  ).replace(/^@/, "");

  /** Product handle only from X. */
  const wottaHandle =
    me?.identities.find((identity) => identity.provider === "x")?.normalized_identifier ??
    (xUsername ? xUsername.toLowerCase() : "");

  useEffect(() => {
    if (loading || !session || wottaHandle) return;
    toastInfo("Link X later if you want a public Wotta @handle", "link-x-optional");
  }, [loading, session, wottaHandle]);

  if (loading) return <HandlesPanelSkeleton />;

  const rows: HandleRow[] = [];
  if (wottaHandle || xIdentity) {
    rows.push({
      key: "wotta-x",
      provider: "x",
      identifier: wottaHandle
        ? `@${wottaHandle}`
        : xUsername
          ? `@${xUsername}`
          : "X connected",
      isWottaHandle: Boolean(wottaHandle),
      subtitle: wottaHandle ? "X · Wotta handle" : "X · verified",
      identity: xIdentity,
    });
  }

  // Each authenticated identity is shown independently. In particular, an X
  // account can supply a verified profile email on first sign-in without that
  // becoming a second, separately linked Google account.
  if (googleIdentity) {
    rows.push({
      key: "google",
      provider: "google",
      identifier: identityEmail(googleIdentity) || "Google connected",
      subtitle: "Google · sign-in",
      identity: googleIdentity,
    });
  }
  if (emailIdentity) {
    rows.push({
      key: "email",
      provider: "email",
      identifier: identityEmail(emailIdentity) || session?.user.email || "Email connected",
      subtitle: "Email · sign-in",
      identity: emailIdentity,
    });
  }
  const xOAuthEmail = identityEmail(xIdentity) ||
    (xIdentity && !googleIdentity && !emailIdentity ? session?.user.email ?? "" : "");
  if (xOAuthEmail) {
    rows.push({
      key: "email-via-x",
      provider: "email",
      identifier: xOAuthEmail,
      subtitle: "Email · supplied by X OAuth",
    });
  }

  const linkedX = Boolean(xIdentity || wottaHandle);
  const showLinkX = !linkedX;
  const showLinkGoogle = !googleIdentity;
  const canUnlinkIdentity = identities.length > 1;

  async function linkIdentity(provider: WottaOAuthProvider) {
    if (!session) {
      toast.error(TOAST.signInToManageHandles);
      return;
    }
    setBusy(true);
    try {
      const result = await createBrowserProductSession().connectProvider(provider);
      if (result.mode === "already_linked") {
        toast.success(`${provider === "x" ? "X" : "Google"} is already linked`);
        await onLinked();
        return;
      }
      toast.success(TOAST.continueLinking);
      await onLinked();
    } catch (e) {
      toast.error(userFacingError(e, TOAST.linkAccountFailed));
    } finally {
      setBusy(false);
    }
  }

  async function unlinkIdentity(row: HandleRow) {
    if (!row.identity) {
      toast.error(
        row.provider === "email"
          ? "This email is from X — unlink X to change it"
          : "Nothing to unlink",
      );
      return;
    }
    if (!canUnlinkIdentity) {
      toast.error(TOAST.keepOneSignIn);
      return;
    }
    if (row.provider === "email") {
      setBusy(true);
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        const { error } = await supabase.auth.unlinkIdentity(row.identity);
        if (error) {
          toast.error(userFacingError(error, TOAST.unlinkFailed));
          return;
        }
        await supabase.auth.refreshSession();
        await syncWottaSession();
        toast.success(TOAST.emailUnlinked);
        await onLinked();
      } catch (e) {
        toast.error(userFacingError(e, TOAST.unlinkFailed));
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      await createBrowserProductSession().unlinkProvider(row.provider);
      toast.success(
        row.provider === "x" ? TOAST.xUnlinked : TOAST.googleUnlinked,
      );
      await onLinked();
    } catch (e) {
      toast.error(userFacingError(e, TOAST.unlinkFailed));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="radius-surface overflow-hidden border border-border/80 bg-card shadow-card">
      <div className="flex items-start gap-3 border-b border-brand-muted/70 bg-brand-mist px-5 py-4 sm:px-6">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-muted bg-brand-soft text-brand-ink">
          <AtSign className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Connected identities
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            X adds a public @handle only. It never changes your Google or email sign-in address; change email by unlinking it first.
          </p>
        </div>
      </div>
      <div className="space-y-4 p-5 sm:p-6">
        {!session ? (
          <p className="radius-surface-inner border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Sign in from the navigation to manage handles.
          </p>
        ) : rows.length === 0 ? (
          <>
            <p className="radius-surface-inner border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No identities yet. Sign in with Google, email, or X to get started.
            </p>
            <ul className="sr-only" data-testid="handles-list">
              <li>empty</li>
            </ul>
          </>
        ) : (
          <ul className="space-y-3" data-testid="handles-list">
            {rows.map((h) => {
              const canUnlink = Boolean(h.identity) && canUnlinkIdentity;
              return (
                <li
                  key={h.key}
                  className="radius-surface-inner flex items-center justify-between gap-3 border border-border/70 px-4 py-3"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-brand-muted/70 bg-brand-mist">
                      <ProviderIcon provider={h.provider} />
                    </span>
                    <div className="min-w-0">
                      <p className="break-all text-sm font-medium text-foreground">
                        {h.identifier}
                      </p>
                      <p className="mt-0.5 text-xs uppercase tracking-wide text-muted-foreground">
                        {h.subtitle}
                      </p>
                    </div>
                  </div>
                  {h.identity ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={busy || !canUnlink}
                      data-testid={`unlink-${h.provider}`}
                      aria-label={
                        !canUnlinkIdentity
                          ? "Keep at least one sign-in method"
                          : `Unlink ${providerLabel(h.provider)}`
                      }
                      onClick={() => void unlinkIdentity(h)}
                    >
                      <Unlink className="h-3.5 w-3.5" aria-hidden />
                      Unlink
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {session && (showLinkX || showLinkGoogle) ? (
          <div className="flex flex-col gap-2">
            {showLinkX ? (
              <Button
                className="w-full"
                variant="outline"
                disabled={busy}
                data-testid="link-x"
                onClick={() => void linkIdentity("x")}
              >
                <XBrandIcon className="h-4 w-4" />
                Link X
              </Button>
            ) : null}
            {showLinkGoogle ? (
              <Button
                className="w-full"
                variant="outline"
                disabled={busy}
                data-testid="link-google"
                onClick={() => void linkIdentity("google")}
              >
                <GoogleIcon className="h-4 w-4" />
                Link Google
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
