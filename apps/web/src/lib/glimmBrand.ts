/** Light brand-blue glimm sweep — mist / soft / sky cobalt. */
export const BRAND_GLIMM_PALETTE = {
  a: [0.92, 0.94, 0.99] as [number, number, number],
  b: [0.14, 0.12, 0.07] as [number, number, number],
  c: [0.5, 0.5, 0.5] as [number, number, number],
  d: [0.2, 0.34, 0.62] as [number, number, number],
};

/** Natural pace + soft lighting for light UI. */
export const BRAND_GLIMM_SWEEP = {
  palette: BRAND_GLIMM_PALETTE,
  sweepMs: 860,
  outroMs: 420,
  midpoint: 0.52,
  easing: "easeInOutCubic" as const,
  brightness: 0.9,
  peakAlpha: 0.68,
  swellAmount: 0.35,
  rippleAmount: 0.55,
  waveAmount: 0.12,
  bandTight: 10,
};
