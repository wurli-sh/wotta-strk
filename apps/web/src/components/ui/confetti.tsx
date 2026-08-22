"use client";

import confetti from "canvas-confetti";

const Z = 99999;

/** Celebration confetti after a successful claim payout. */
export function fireClaimConfetti() {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const colors = [
    "#2c5cc5",
    "#4674d2",
    "#7aa2ef",
    "#e7eeff",
    "#c8d8fb",
    "#171a20",
    "#f6f7f9",
    "#fbbf24",
  ];

  // Full-width burst from the bottom / sides so it reads on claim complete
  void confetti({
    particleCount: 90,
    angle: 60,
    spread: 70,
    startVelocity: 45,
    origin: { x: 0, y: 0.75 },
    colors,
    zIndex: Z,
    disableForReducedMotion: true,
  });
  void confetti({
    particleCount: 90,
    angle: 120,
    spread: 70,
    startVelocity: 45,
    origin: { x: 1, y: 0.75 },
    colors,
    zIndex: Z,
    disableForReducedMotion: true,
  });
  void confetti({
    particleCount: 120,
    spread: 100,
    startVelocity: 40,
    origin: { x: 0.5, y: 0.55 },
    colors,
    zIndex: Z,
    disableForReducedMotion: true,
  });

  window.setTimeout(() => {
    void confetti({
      particleCount: 80,
      spread: 120,
      startVelocity: 35,
      decay: 0.91,
      scalar: 1.05,
      origin: { x: 0.5, y: 0.4 },
      colors,
      zIndex: Z,
      disableForReducedMotion: true,
    });
  }, 220);

  window.setTimeout(() => {
    void confetti({
      particleCount: 60,
      angle: 90,
      spread: 80,
      origin: { x: 0.5, y: 0.9 },
      colors,
      zIndex: Z,
      disableForReducedMotion: true,
    });
  }, 450);
}
