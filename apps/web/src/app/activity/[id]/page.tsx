import { PageShell } from "@/components/PageShell";

export default function ActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <PageShell title="Activity" subtitle="Public workflow shell only.">
      <ActivityId params={params} />
    </PageShell>
  );
}

async function ActivityId({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <p className="text-sm text-muted-foreground">
      Opaque reference <code className="text-foreground">{id}</code> — no private
      inbox or payment fields are loaded here.
    </p>
  );
}
