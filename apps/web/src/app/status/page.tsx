"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { apiBase } from "@/lib/api/client";

export default function StatusPage() {
  const [api, setApi] = useState<string>("…");
  const [manifest, setManifest] = useState<string>("…");
  const [routes, setRoutes] = useState<string>("…");

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`${apiBase()}/v1/health`);
        const body = (await r.json()) as {
          manifestHash?: string;
          routesEnabled?: number;
        };
        setApi(r.ok ? "ok" : `http_${r.status}`);
        setManifest(body.manifestHash ? `${body.manifestHash.slice(0, 12)}… · ${body.routesEnabled ?? 0} routes enabled` : "unavailable");
      } catch {
        setApi("unreachable");
        setManifest("unreachable");
      }
      try {
        const r = await fetch(`${apiBase()}/v1/routes`);
        if (!r.ok) setRoutes(`http_${r.status}`);
        else {
          const j = (await r.json()) as {
            routes?: { routes?: Array<{ id: string; status?: string }> };
          };
          const list = j.routes?.routes ?? (j as { routes?: unknown }).routes;
          setRoutes(
            Array.isArray(list)
              ? list
                  .map(
                    (x: { id?: string; routeId?: string; status?: string }) =>
                      `${x.id || x.routeId}:${x.status ?? "?"}`,
                  )
                  .join(", ")
              : "loaded",
          );
        }
      } catch {
        setRoutes("unreachable");
      }
    })();
  }, []);

  return (
    <PageShell title="Status" subtitle="Safe aggregate health only.">
      <dl className="space-y-3 rounded-[var(--radius-surface)] border border-border bg-card p-5 text-sm">
        <div>
          <dt className="text-muted-foreground">API</dt>
          <dd>{api}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Sepolia manifest</dt>
          <dd>{manifest}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Routes</dt>
          <dd className="break-all">{routes}</dd>
        </div>
        <p className="text-warning">
          testnet only · route admission is fail-closed until evidence is retained
        </p>
      </dl>
    </PageShell>
  );
}
