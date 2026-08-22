import confetti from "canvas-confetti";
import type { ConfettiRef } from "@/components/ui/confetti";

/** Brand cobalt / mist palette for claim celebration. */
export const CLAIM_CONFETTI_COLORS = [
  "#2c5cc5",
  "#4674d2",
  "#c8d8fb",
  "#e7eeff",
  "#244ca6",
] as const;

export function fireClaimConfetti(confettiRef: ConfettiRef | null): void {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  const colors = [...CLAIM_CONFETTI_COLORS];
  const fire = (options: Parameters<ConfettiRef["fire"]>[0]) => {
    const payload = { ...options, colors, zIndex: 10_000 };
    if (confettiRef) {
      void confettiRef.fire(payload);
      return;
    }
    // Global API appends its own body canvas — works even if the React ref is unset.
    void confetti(payload);
  };

  fire({
    particleCount: 55,
    spread: 64,
    startVelocity: 36,
    origin: { y: 0.62 },
  });

  const end = Date.now() + 1_100;
  const frame = () => {
    if (Date.now() > end) return;
    fire({
      particleCount: 2,
      angle: 60,
      spread: 50,
      startVelocity: 48,
      origin: { x: 0, y: 0.65 },
    });
    fire({
      particleCount: 2,
      angle: 120,
      spread: 50,
      startVelocity: 48,
      origin: { x: 1, y: 0.65 },
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
