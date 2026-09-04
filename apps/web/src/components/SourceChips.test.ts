import { describe, expect, it } from "vitest";
import { buildSourceRoutes, chipSelectableInMode, orderedSourceChips } from "./SourceChips";

const DISPLAY_CHIPS = [
  "ethereum",
  "arbitrum",
  "base",
  "solana",
  "stellar",
  "starknet",
] as const;

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

describe("chipSelectableInMode", () => {
  const routes = buildSourceRoutes([
    { id: "base", enabled: true },
    { id: "solana", enabled: true },
    { id: "ethereum", enabled: false, reason: "coming_soon" },
    { id: "starknet-private", enabled: true },
    { id: "starknet-public", enabled: false, reason: "coming_soon" },
  ]);

  it("keeps Base/Solana disabled in private mode unless cross-chain private sources are allowed", () => {
    expect(chipSelectableInMode("base", routes, true)).toBe(false);
    expect(chipSelectableInMode("solana", routes, true)).toBe(false);
    expect(chipSelectableInMode("starknet", routes, true)).toBe(true);
  });

  it("allows admitted Base/Solana when private destination permits cross-chain sources", () => {
    expect(chipSelectableInMode("base", routes, true, true)).toBe(true);
    expect(chipSelectableInMode("solana", routes, true, true)).toBe(true);
    expect(chipSelectableInMode("ethereum", routes, true, true)).toBe(false);
    expect(chipSelectableInMode("starknet", routes, true, true)).toBe(true);
  });

  it("shows Starknet live from the private rail while public stays soon", () => {
    const privateRoutes = buildSourceRoutes([
      { id: "starknet-private", enabled: true },
      { id: "starknet-public", enabled: false, reason: "coming_soon" },
      { id: "base", enabled: true },
    ]);
    expect(chipSelectableInMode("starknet", privateRoutes, true, true)).toBe(true);
    expect(chipSelectableInMode("starknet", privateRoutes, false, false)).toBe(false);
  });

  it("orders enabled chips ahead of soon chips", () => {
    expect(orderedSourceChips(DISPLAY_CHIPS, routes, true, true)).toEqual([
      "base",
      "solana",
      "starknet",
      "ethereum",
      "arbitrum",
      "stellar",
    ]);
  });
});
