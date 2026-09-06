"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { GoogleIcon, XBrandIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { prepareOAuthRedirect } from "@/lib/app-origin";
import { TOAST } from "@/lib/brand-copy";
import { userFacingError } from "@/lib/errors";
import {
  toSupabaseProvider,
  type WottaOAuthProvider,
} from "@/lib/supabase/providers";
import { cn } from "@/lib/cn";

type Props = {
  redirectNext?: string;
  authError?: boolean;
  className?: string;
  /** Kept for callers; OAuth redirects away before local completion. */
  onAuthenticated?: () => void;
};

export function SignInAuthPanel({
  redirectNext = "/account",
  authError = false,
  className,
}: Props) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (authError) {
      toast.error(TOAST.signInFailed);
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
      if (error) toast.error(userFacingError(error, TOAST.signInFailed));
    } catch (e) {
      toast.error(userFacingError(e, TOAST.signInFailed));
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
    </div>
  );
}
