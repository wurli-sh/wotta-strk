"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { syncWottaSession, clearStaleSupabaseLocalStorage } from "@/lib/auth";
import { userFacingError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/client";
import { consumeOAuthCallbackFailure } from "@/lib/wotta/product-session";

/** Keeps Wotta profile/inbox in sync after OAuth callbacks and auth changes. */
export function SessionSync() {
  const lastToken = useRef<string | null | undefined>(undefined);
  const oauthHandled = useRef(false);

  useEffect(() => {
    if (oauthHandled.current) return;
    oauthHandled.current = true;
    const failure = consumeOAuthCallbackFailure();
    if (failure) {
      toast.error(
        userFacingError(failure, "Sign-in did not complete — try again"),
        { id: "oauth-callback-failure" },
      );
    }
  }, []);

  useEffect(() => {
    clearStaleSupabaseLocalStorage();
    try {
      const supabase = createClient();
      void supabase.auth.getSession().then(({ data }) => {
        lastToken.current = data.session?.access_token ?? null;
        if (data.session) void syncWottaSession();
      });
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        const token = session?.access_token ?? null;
        if (lastToken.current === token) return;
        lastToken.current = token;
        if (session) void syncWottaSession();
      });
      return () => sub.subscription.unsubscribe();
    } catch {
      /* Supabase may be unconfigured in some test builds */
    }
  }, []);

  return null;
}
