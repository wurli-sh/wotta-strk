"use client";

import { Suspense, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IslandNav } from "@/components/IslandNav";
import { useNetworkMode } from "@/components/NetworkModeProvider";
import { RouteSkeletonGate } from "@/components/RouteSkeletonGate";
import { SendPageSkeleton } from "@/components/ui/Skeleton";

function NetworkAwareSendPageSkeleton() {
  const { mode, ready } = useNetworkMode();
  // Until mode is hydrated, prefer the mainnet skeleton (no private-route toggle).
  return <SendPageSkeleton mode={ready ? mode : "mainnet"} />;
}

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const showLandingFooter = pathname === "/";

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: reduceMotion ? "auto" : "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  return (
    <>
      <div
        className="pointer-events-none fixed inset-0 -z-10 app-atmosphere"
        aria-hidden
      />
      <IslandNav />
      <main className="mx-auto min-h-svh max-w-5xl px-4 pb-12 pt-28">
        <Suspense fallback={<NetworkAwareSendPageSkeleton />}>
          <RouteSkeletonGate>{children}</RouteSkeletonGate>
        </Suspense>
      </main>
      {showLandingFooter ? (
        <footer className="relative mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 pb-10 text-sm text-muted-foreground">
          <Link
            href="/"
            className="flex min-h-10 items-center gap-2 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/sable-logo.svg" alt="" className="h-4 w-auto" />
            <span className="text-sm font-bold tracking-tight text-foreground">
              Wotta
            </span>
          </Link>
          <Link
            href="/privacy"
            className="inline-flex min-h-10 items-center px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Privacy
          </Link>
        </footer>
      ) : null}
    </>
  );
}
