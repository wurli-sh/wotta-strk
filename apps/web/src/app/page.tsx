"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { HeroSendBox } from "@/components/HeroSendBox";
import { HowItWorks } from "@/components/HowItWorks";
import { GoogleIcon, XBrandIcon } from "@/components/icons";
import { MotionButton } from "@/components/ui/MotionLink";
import { createClient } from "@/lib/supabase/client";
import { prepareOAuthRedirect } from "@/lib/app-origin";
import { TOAST } from "@/lib/brand-copy";
import { userFacingError } from "@/lib/errors";
import { toSupabaseProvider } from "@/lib/supabase/providers";
import {
  LANDING_HEADLINE,
  LANDING_INBOX_PROMPT,
  LANDING_SUBHEAD,
} from "@/lib/brand-copy";

function HomeContent() {
  const [busy, setBusy] = useState<"google" | "x" | null>(null);
  const reduceMotion = useReducedMotion();

  async function openInbox(which: "google" | "x") {
    if (busy) return;
    setBusy(which);
    try {
      const { error } = await createClient().auth.signInWithOAuth({
        provider: toSupabaseProvider(which),
        options: {
          redirectTo: prepareOAuthRedirect("/inbox"),
        },
      });
      if (error) throw error;
    } catch (cause) {
      setBusy(null);
      toast.error(userFacingError(cause, TOAST.signInFailed));
    }
  }

  return (
    <div className="flex flex-col items-center gap-20 pb-24 text-center">
      <div className="flex min-h-[calc(100svh-7rem)] w-full max-w-3xl flex-col justify-center space-y-7">
        <div className="space-y-5">
          <h1 className="text-4xl font-extrabold leading-[0.95] tracking-tighter text-foreground sm:text-7xl">
            <span
              aria-hidden="true"
              className="flex flex-col items-center gap-2"
            >
              {LANDING_HEADLINE.map((line, index) => (
                <motion.span
                  key={line}
                  className="block"
                  initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: reduceMotion ? 0 : 0.45,
                    delay: reduceMotion ? 0 : index * 0.08,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                >
                  {line}
                </motion.span>
              ))}
            </span>
            <span className="sr-only">
              {LANDING_HEADLINE.join(" ")} {LANDING_SUBHEAD}
            </span>
          </h1>
        </div>

        <p className="mx-auto max-w-xl text-base text-muted-foreground sm:text-lg">
          {LANDING_SUBHEAD}
        </p>

        <div className="flex flex-col items-center gap-5">
          <HeroSendBox />
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-muted-foreground">
              {LANDING_INBOX_PROMPT}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <MotionButton
                disabled={busy !== null}
                onClick={() => void openInbox("google")}
                data-testid="cta-account"
              >
                <GoogleIcon className="h-4 w-4" />
                Continue with Google
              </MotionButton>
              <MotionButton
                disabled={busy !== null}
                onClick={() => void openInbox("x")}
              >
                <XBrandIcon className="h-4 w-4" />
                Continue with X
              </MotionButton>
            </div>
          </div>
        </div>
      </div>

      <HowItWorks />
    </div>
  );
}

export default function HomePage() {
  return <HomeContent />;
}
