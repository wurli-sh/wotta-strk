"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { GoogleIcon, XBrandIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { prepareOAuthRedirect } from "@/lib/app-origin";
import { userFacingError } from "@/lib/errors";
import {
  toSupabaseProvider,
  type WottaOAuthProvider,
} from "@/lib/supabase/providers";
import { syncWottaSession } from "@/lib/auth";
import { cn } from "@/lib/cn";

type Props = {
  redirectNext?: string;
  authError?: boolean;
  className?: string;
  onAuthenticated?: () => void;
};

export function SignInAuthPanel({
  redirectNext = "/account",
  authError = false,
  className,
  onAuthenticated,
}: Props) {
  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authError) {
      toast.error("Sign-in did not complete. Please try again.");
    }
  }, [authError]);

  async function oauth(provider: WottaOAuthProvider) {
    setBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: toSupabaseProvider(provider),
        options: {
          redirectTo: prepareOAuthRedirect(redirectNext),
        },
      });
      if (error) toast.error(userFacingError(error, "Sign-in failed"));
    } catch (e) {
      toast.error(userFacingError(e, "Sign-in failed"));
    } finally {
      setBusy(false);
    }
  }

  async function sendOtp() {
    if (!email.trim()) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
      });
      if (error) {
        toast.error(userFacingError(error, "Could not send code"));
        return;
      }
      setOtpSent(true);
      toast.success("Check your email for a one-time code.");
    } catch (e) {
      toast.error(userFacingError(e, "Could not send code"));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    if (!otp.trim()) return;
    setBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: otp.trim(),
        type: "email",
      });
      if (error) {
        toast.error(userFacingError(error, "Could not verify code"));
        return;
      }
      toast.success("Signed in");
      await syncWottaSession({ notify: true });
      onAuthenticated?.();
    } catch (e) {
      toast.error(userFacingError(e, "Could not verify code"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("space-y-5", className)}>
      <div className="flex flex-col gap-3">
        <Button
          data-testid="auth-google"
          disabled={busy}
          variant="outline"
          onClick={() => void oauth("google")}
        >
          <GoogleIcon className="h-4 w-4" />
          Continue with Google
        </Button>
        <Button
          data-testid="auth-x"
          disabled={busy}
          variant="outline"
          onClick={() => void oauth("x")}
        >
          <XBrandIcon className="h-4 w-4" />
          Continue with X
        </Button>
      </div>
      <form
        className="space-y-3 border-t border-border/70 pt-5"
        onSubmit={(event) => {
          event.preventDefault();
          void (otpSent ? verifyOtp() : sendOtp());
        }}
      >
        <label
          htmlFor="auth-email"
          className="block text-sm font-medium text-foreground"
        >
          Email
        </label>
        <input
          id="auth-email"
          type="email"
          className="radius-control w-full border border-border/70 bg-muted px-4 py-3 text-sm outline-none transition-[border-color,box-shadow] duration-100 ease-out focus:border-brand focus:ring-2 focus:ring-ring/30"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          spellCheck={false}
          data-testid="auth-email"
        />
        {!otpSent ? (
          <Button
            type="submit"
            data-testid="auth-send-code"
            disabled={busy || !email.trim()}
          >
            <Mail className="h-4 w-4" aria-hidden="true" />
            Send code
          </Button>
        ) : (
          <>
            <label htmlFor="auth-otp" className="sr-only">
              One-time code
            </label>
            <input
              id="auth-otp"
              type="text"
              inputMode="numeric"
              className="radius-control w-full border border-border/70 bg-muted px-4 py-3 text-sm outline-none transition-[border-color,box-shadow] duration-100 ease-out focus:border-brand focus:ring-2 focus:ring-ring/30"
              placeholder="One-time code"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              autoComplete="one-time-code"
              spellCheck={false}
              data-testid="auth-otp"
            />
            <Button
              type="submit"
              data-testid="auth-verify"
              disabled={busy || !otp.trim()}
            >
              <BadgeCheck className="h-4 w-4" aria-hidden="true" />
              Verify
            </Button>
          </>
        )}
      </form>
    </div>
  );
}
