import { describe, expect, it } from "vitest";
import { calculateApyMovement } from "./ApyMovement";

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
