"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PAGE_BOOT_MS } from "@/lib/skeleton-hold";

/**
 * Holds a full-page body skeleton for at least PAGE_BOOT_MS while resolving
 * whether a Supabase session exists. After `booting` flips false, `signedIn`
 * is definitive.
 */
export function usePageAuthBoot() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [minElapsed, setMinElapsed] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setMinElapsed(true), PAGE_BOOT_MS);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    let active = true;
    void createClient()
      .auth.getSession()
      .then(({ data }) => {
        if (active) setSignedIn(Boolean(data.session?.access_token));
      })
      .catch(() => {
        if (active) setSignedIn(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return {
    booting: !minElapsed || signedIn === null,
    signedIn: signedIn === true,
  };
}
