import { describe, expect, it } from "vitest";
import { privacyVaultUnlockConfig } from "./privacy-vault-config";
import { directPrivacyConfig } from "./privacy-config";
import { mainnetPrivacyConfig } from "./mainnet-privacy";

describe("privacyVaultUnlockConfig", () => {
  it("binds the Sepolia direct-privacy pool on testnet", () => {
    expect(privacyVaultUnlockConfig("testnet")).toMatchObject({
      chainId: "SN_SEPOLIA",
      poolAddress: directPrivacyConfig().poolAddress,
    });
  });

  it("binds the Mainnet wallet-managed pool on mainnet", () => {
    expect(privacyVaultUnlockConfig("mainnet")).toMatchObject({
      chainId: "SN_MAIN",
      poolAddress: mainnetPrivacyConfig().poolAddress,
    });
  });
});
