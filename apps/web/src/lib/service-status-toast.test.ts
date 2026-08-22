import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toast } = vi.hoisted(() => ({
  toast: {
    message: vi.fn(),
    success: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast }));

async function loadSubject() {
  return import("./service-status-toast");
}

describe("withServiceStatusToast", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubGlobal("window", {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("explains an API cold start only after the request is delayed", async () => {
    const { withServiceStatusToast } = await loadSubject();
    let resolve: (() => void) | undefined;
    const request = withServiceStatusToast(
      "api",
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );

    await vi.advanceTimersByTimeAsync(4_000);
    expect(toast.message).toHaveBeenCalledWith(
      "Waking up Wotta services…",
      expect.objectContaining({ id: "service-status-api", duration: Infinity }),
    );

    resolve?.();
    await request;
    expect(toast.dismiss).toHaveBeenCalledWith("service-status-api");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does not flash a toast for a responsive service", async () => {
    const { withServiceStatusToast } = await loadSubject();
    await withServiceStatusToast("api", async () => undefined);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(toast.message).not.toHaveBeenCalled();
  });

  it("removes the loading toast when a delayed request fails", async () => {
    const { withServiceStatusToast } = await loadSubject();
    let reject: ((error: Error) => void) | undefined;
    const request = withServiceStatusToast(
      "api",
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    );

    await vi.advanceTimersByTimeAsync(4_000);
    reject?.(new Error("unreachable"));
    await expect(request).rejects.toThrow("unreachable");
    expect(toast.dismiss).toHaveBeenCalledWith("service-status-api");
  });

  it("shows lifecycle status only for the initial service check", async () => {
    const { withServiceStatusToast } = await loadSubject();
    await withServiceStatusToast("api", async () => undefined);

    let resolve: (() => void) | undefined;
    const laterRequest = withServiceStatusToast(
      "api",
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    await vi.advanceTimersByTimeAsync(5_000);

    expect(toast.message).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    resolve?.();
    await laterRequest;
  });
});
