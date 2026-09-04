"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api/client";
import {
  buildSourceRoutes,
  type RouteRow,
} from "@/components/SourceChips";
import type { RouteManifest } from "@/lib/wotta/product-session";
import type { NetworkMode } from "@/lib/network-mode";

export type RoutesHealth = "loading" | "ready" | "waking";

const ROUTE_HEALTH_TOAST_ID = "route-health";
const ROUTE_TOAST_DELAY_MS = 1_500;
const ROUTES_RETRY_MS = 5_000;
const ROUTES_RETRY_CAP_MS = 120_000;

const routeToastCopy: Record<Exclude<RoutesHealth, "ready">, { title: string; description: string }> = {
  loading: {
    title: "Checking routes",
    description: "Send unlocks when verified routes are ready.",
  },
  waking: {
    title: "API is waking up",
    description: "Chain selection unlocks when route health is back.",
  },
};

function showRouteHealthToast(health: Exclude<RoutesHealth, "ready">): void {
  const copy = routeToastCopy[health];
  toast.message(copy.title, {
    id: ROUTE_HEALTH_TOAST_ID,
    duration: Infinity,
    description: copy.description,
  });
}

function dismissRouteHealthToast(): void {
  toast.dismiss(ROUTE_HEALTH_TOAST_ID);
}

export function useRoutesHealth(network: NetworkMode, enabled = true) {
  const [routes, setRoutes] = useState<RouteRow[]>(() => buildSourceRoutes());
  const [routesHealth, setRoutesHealth] = useState<RoutesHealth>("loading");
  const [retryNonce, setRetryNonce] = useState(0);
  const startedAt = useRef<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastShown = useRef(false);

  const scheduleRouteToast = useCallback((health: Exclude<RoutesHealth, "ready">) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      toastTimer.current = undefined;
      toastShown.current = true;
      showRouteHealthToast(health);
    }, ROUTE_TOAST_DELAY_MS);
  }, []);

  const clearRouteToast = useCallback(() => {
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
      toastTimer.current = undefined;
    }
    if (toastShown.current) dismissRouteHealthToast();
    toastShown.current = false;
  }, []);

  useEffect(() => {
    if (!enabled) {
      clearRouteToast();
      return;
    }
    setRoutes(buildSourceRoutes());
    setRoutesHealth("loading");
    startedAt.current = Date.now();
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    if (startedAt.current == null) startedAt.current = Date.now();

    const loadRoutes = async () => {
      setRoutesHealth((prev) => (prev === "ready" ? prev : "loading"));
      scheduleRouteToast("loading");
      try {
        const manifest = await apiFetch<RouteManifest>("/v1/routes", {
          suppressServiceStatus: true,
          network,
        });
        if (!active) return;
        setRoutes(buildSourceRoutes(manifest.routes));
        setRoutesHealth("ready");
        clearRouteToast();
      } catch {
        if (!active) return;
        setRoutes(buildSourceRoutes());
        setRoutesHealth("waking");
        if (toastShown.current) {
          showRouteHealthToast("waking");
        } else {
          scheduleRouteToast("waking");
        }
        const elapsed = Date.now() - (startedAt.current ?? Date.now());
        if (elapsed < ROUTES_RETRY_CAP_MS) {
          retryTimer = setTimeout(() => void loadRoutes(), ROUTES_RETRY_MS);
        }
      }
    };

    void loadRoutes();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      clearRouteToast();
    };
  }, [network, enabled, retryNonce, scheduleRouteToast, clearRouteToast]);

  const retryRoutesHealth = useCallback(() => {
    startedAt.current = Date.now();
    setRetryNonce((value) => value + 1);
  }, []);

  return {
    routes,
    routesHealth,
    routesReady: enabled && routesHealth === "ready",
    retryRoutesHealth,
  };
}
