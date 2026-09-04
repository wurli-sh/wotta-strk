import { describe, expect, it } from "vitest";
import mainnetDeployment from "../../../../../deployments/mainnet.json";
import { activationFeeToken } from "./ready";

describe("Ready account activation", () => {
  it("selects the token configured for the active Starknet network", () => {
    expect(activationFeeToken("mainnet")).toBe(mainnetDeployment.walletManagedPrivacy.feeToken);
    expect(activationFeeToken("testnet")).toMatch(/^0x[0-9a-f]+$/i);
  });
});
