"use client";

import { useEffect, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { apiBase } from "@/lib/api/client";

type HealthBody = {
  ok?: boolean;
  chainId?: string;
  manifestHash?: string;
  routesEnabled?: number;
  relayerQueued?: number;
  oldestQueuedAgeSec?: number | null;
  relayerFailed?: number;
  strkAlert?: boolean | null;
  workers?: { indexer?: boolean; relayer?: boolean };
};

export default function StatusPage() {
  const [api, setApi] = useState<string>("…");
  const [health, setHealth] = useState<HealthBody | null>(null);
  const [routes, setRoutes] = useState<string>("…");

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`${apiBase()}/v1/health`);
        const body = (await r.json()) as HealthBody;
        setApi(r.ok ? "ok" : `http_${r.status}`);
        setHealth(body);
      } catch {
        setApi("unreachable");
        setHealth(null);
      }
      try {
        const r = await fetch(`${apiBase()}/v1/routes`);
        if (!r.ok) setRoutes(`http_${r.status}`);
        else {
          const j = (await r.json()) as {
            routes?: Array<{ id?: string; routeId?: string; enabled?: boolean; reason?: string }>;
          };
          const list = Array.isArray(j.routes) ? j.routes : [];
          setRoutes(
            list
              .map((x) => `${x.id || x.routeId}:${x.enabled ? "live" : (x.reason ?? "soon")}`)
              .join(", ") || "loaded",
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
          <dt className="text-muted-foreground">Chain</dt>
          <dd>{health?.chainId ?? "unavailable"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Manifest</dt>
          <dd>
            {health?.manifestHash
              ? `${health.manifestHash.slice(0, 12)}… · ${health.routesEnabled ?? 0} routes enabled`
              : "unavailable"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Relayer queue</dt>
          <dd>
            queued {health?.relayerQueued ?? "—"}
            {health?.oldestQueuedAgeSec != null ? ` · oldest ${health.oldestQueuedAgeSec}s` : ""}
            {` · failed ${health?.relayerFailed ?? "—"}`}
            {health?.strkAlert === true ? " · STRK alert" : health?.strkAlert === false ? " · STRK ok" : ""}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Routes</dt>
          <dd className="break-all">{routes}</dd>
        </div>
        <p className="text-warning">
          Route admission is fail-closed. Queue fields never include addresses or balances.
        </p>
      </dl>
    </PageShell>
  );
}
