"use client";

import type { ReactNode } from "react";

/**
 * Route content renders immediately once Suspense resolves.
 * Per-page and in-panel skeletons handle real loading states.
 */
export function RouteSkeletonGate({ children }: { children: ReactNode }) {
  return children;
}
