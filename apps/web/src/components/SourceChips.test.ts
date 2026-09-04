import { describe, expect, it } from "vitest";
import { buildSourceRoutes } from "./SourceChips";

describe("buildSourceRoutes", () => {
  it("keeps every source visible and disabled when capability data is unavailable", () => {
    const routes = buildSourceRoutes();
    expect(routes.map((route) => route.key)).toEqual([
      "ethereum",
      "arbitrum",
      "base",
      "solana",
      "stellar",
      "starknet-public",
      "starknet-private",
    ]);
    expect(routes.every((route) => route.status === "soon" && !route.selectable)).toBe(true);
  });

  it("uses route-specific safe copy without hiding enabled capabilities", () => {
    const routes = buildSourceRoutes([
      { id: "base", enabled: false, reason: "awaiting_route_evidence" },
      { id: "solana", enabled: true },
      { id: "stellar", enabled: false, reason: "coming_soon" },
    ]);
    expect(routes.find((route) => route.key === "base")?.reason).toBe(
      "Awaiting route verification — coming soon",
    );
    expect(routes.find((route) => route.key === "solana")).toMatchObject({
      status: "live",
      selectable: true,
    });
    expect(routes.find((route) => route.key === "stellar")?.reason).toBe("Coming soon");
  });

  it("maps a paused route to a distinct paused badge", () => {
    const routes = buildSourceRoutes([
      { id: "base", enabled: false, reason: "route_paused" },
      { id: "solana", enabled: true },
    ]);
    expect(routes.find((route) => route.key === "base")).toMatchObject({
      status: "paused",
      selectable: false,
      reason: "Paused",
    });
    expect(routes.find((route) => route.key === "solana")?.selectable).toBe(true);
  });
});
