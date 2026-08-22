"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AccountSkeleton,
  ClaimPageSkeleton,
  InboxSkeleton,
  LandingSkeleton,
  PrivacySkeleton,
  SendPageSkeleton,
  StatusSkeleton,
} from "@/components/ui/Skeleton";
import { SKELETON_MIN_MS } from "@/lib/skeleton-hold";

function skeletonForPath(pathname: string) {
  if (pathname === "/") return <LandingSkeleton />;
  if (pathname.startsWith("/send") || pathname.startsWith("/c"))
    return <SendPageSkeleton />;
  if (pathname.startsWith("/claim")) return <ClaimPageSkeleton />;
  if (pathname.startsWith("/inbox")) return <InboxSkeleton />;
  if (pathname.startsWith("/account") || pathname.startsWith("/register") || pathname.startsWith("/balance"))
    return <AccountSkeleton />;
  if (pathname.startsWith("/withdraw")) return <ClaimPageSkeleton />;
  if (pathname.startsWith("/privacy")) return <PrivacySkeleton />;
  if (pathname.startsWith("/status")) return <StatusSkeleton />;
  return <SendPageSkeleton />;
}

/**
 * Full-page skeleton for pathname changes only.
 * Tab / query switches are handled inside each page (tab content only).
 */
export function RouteSkeletonGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const [holdKey, setHoldKey] = useState(pathname);
  const [holding, setHolding] = useState(true);

  useEffect(() => {
    setHoldKey(pathname);
    setHolding(true);
    const id = window.setTimeout(() => setHolding(false), SKELETON_MIN_MS);
    return () => window.clearTimeout(id);
  }, [pathname]);

  return (
    <AnimatePresence mode="wait">
      {holding ? (
        <motion.div
          key={`sk-${holdKey}`}
          initial={reduce ? false : { opacity: 0.65 }}
          animate={{ opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.18 }}
        >
          {skeletonForPath(pathname)}
        </motion.div>
      ) : (
        <motion.div
          key={`pg-${holdKey}`}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduce
              ? { duration: 0 }
              : { duration: 0.28, ease: [0.16, 1, 0.3, 1] }
          }
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
