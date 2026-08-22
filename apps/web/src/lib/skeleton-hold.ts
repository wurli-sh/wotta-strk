/** Mandatory skeleton hold duration (ms) for page switch, mount, and refresh/reveal. */
export const SKELETON_MIN_MS = 500;

/**
 * Run `work` and do not resolve until at least `minMs` has elapsed.
 * Use for refresh/reveal so skeletons always flash long enough to read.
 */
export async function withMinSkeleton<T>(
  work: () => Promise<T>,
  minMs: number = SKELETON_MIN_MS,
): Promise<T> {
  const started = performance.now();
  try {
    return await work();
  } finally {
    const elapsed = performance.now() - started;
    const remaining = minMs - elapsed;
    if (remaining > 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, remaining);
      });
    }
  }
}
