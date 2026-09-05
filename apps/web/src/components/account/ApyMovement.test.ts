import { describe, expect, it } from "vitest";
import { calculateApyMovement, formatApySignificant } from "./ApyMovement";

describe("calculateApyMovement", () => {
  it("reports an APY increase in points and relative percent", () => {
    const movement = calculateApyMovement(3.75, 3.5);
    expect(movement).toMatchObject({
      direction: "up",
      percentagePoints: 0.25,
    });
    expect(movement.relativePercent).toBeCloseTo(100 / 14);
  });

  it("reports an APY decrease", () => {
    expect(calculateApyMovement(3.25, 3.5)).toMatchObject({
      direction: "down",
      percentagePoints: -0.25,
    });
  });
});

describe("formatApySignificant", () => {
  it("keeps four significant figures for APY and movement amounts", () => {
    expect(formatApySignificant(3.5124)).toBe("3.512");
    expect(formatApySignificant(0.2541)).toBe("0.2541");
    expect(formatApySignificant(0.25)).toBe("0.2500");
    expect(formatApySignificant(0)).toBe("0.000");
  });
});
