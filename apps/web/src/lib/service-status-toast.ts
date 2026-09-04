import { toast } from "sonner";

type Service = "api";

type PendingService = {
  count: number;
  shown: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
};

const pending = new Map<Service, PendingService>();
const checked = new Set<Service>();
// Only surface a genuinely slow initial check. Normal requests and short
// restarts stay quiet, and a completed wake-up disappears without a second
// "ready" notification.
const COLD_START_DELAY_MS = 4_000;

const copy: Record<Service, { loading: string; description: string }> = {
  api: {
    loading: "Waking up Wotta services…",
    description: "The API is starting after idle time — your request is still running.",
  },
};

/**
 * Explain a real slow request without flashing a toast for normal responses.
 * Render can suspend idle services, so a delayed response is the useful signal.
 */
export async function withServiceStatusToast<T>(
  service: Service,
  request: () => Promise<T>,
): Promise<T> {
  if (typeof window === "undefined") return request();
  if (checked.has(service)) return request();
  checked.add(service);

  let state = pending.get(service);
  if (!state) {
    state = { count: 0, shown: false, timer: undefined };
    pending.set(service, state);
  }
  state.count += 1;

  if (!state.timer && !state.shown) {
    state.timer = setTimeout(() => {
      state!.timer = undefined;
      state!.shown = true;
      toast.message(copy[service].loading, {
        id: `service-status-${service}`,
        duration: Infinity,
        description: copy[service].description,
      });
    }, COLD_START_DELAY_MS);
  }

  try {
    return await request();
  } finally {
    state.count -= 1;
    if (state.count > 0) continueServiceToast(service, state);
    else finishServiceToast(service, state);
  }
}

function continueServiceToast(service: Service, state: PendingService): void {
  pending.set(service, state);
}

function finishServiceToast(service: Service, state: PendingService): void {
  if (state.timer) clearTimeout(state.timer);
  pending.delete(service);
  if (!state.shown) return;
  const id = `service-status-${service}`;
  toast.dismiss(id);
}
