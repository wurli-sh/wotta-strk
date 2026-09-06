import { describe, expect, it } from "vitest";
import type { WalletAccountV6 } from "starknet";
import { loadVesuEarn, type VesuEarnConfig } from "./config";
import {
  assertVesuRuntime,
  assertVesuRuntimeWithConfig,
  VESU_RUNTIME_TEST,
} from "./runtime";

const verifiedConfig = {
  ...loadVesuEarn(),
  status: "verified" as const,
  anonymizerAddress: "0xabc",
};

function mockAccount(handlers: {
  classHashAt?: (address: string) => string;
  call?: (entrypoint: string, address: string) => string;
}): WalletAccountV6 {
  return {
    provider: {
      getClassHashAt: async (address: string) =>
        handlers.classHashAt?.(address) ?? "0xdead",
      callContract: async (
        req: { contractAddress: string; entrypoint: string; calldata?: string[] },
      ) => {
        const value = handlers.call?.(req.entrypoint, req.contractAddress);
        if (value === undefined) throw new Error(`unexpected call ${req.entrypoint}`);
        return [value];
      },
    },
  } as unknown as WalletAccountV6;
}

function happyPathHandlers(config: VesuEarnConfig = verifiedConfig) {
  const fee = VESU_RUNTIME_TEST.pinnedPrivacyFee().toString();
  const privacyClass = VESU_RUNTIME_TEST.pinnedPrivacyPoolClassHash();
  return {
    classHashAt: (address: string) => {
      if (BigInt(address) === BigInt(config.poolAddress)) return config.poolClassHash;
      if (BigInt(address) === BigInt(config.factoryAddress)) return config.factoryClassHash;
      if (BigInt(address) === BigInt(config.vTokenAddress)) return config.vTokenClassHash;
      if (BigInt(address) === BigInt(config.anonymizerAddress)) return config.anonymizerClassHash;
      if (BigInt(address) === BigInt(config.privacyPoolAddress)) return privacyClass;
      return "0x0";
    },
    call: (entrypoint: string, address: string) => {
      if (entrypoint === "v_token_for_asset") return config.vTokenAddress;
      if (entrypoint === "asset") return config.underlyingAddress;
      if (entrypoint === "pool_contract") return config.poolAddress;
      if (entrypoint === "decimals" && BigInt(address) === BigInt(config.vTokenAddress)) {
        return `0x${config.vTokenDecimals.toString(16)}`;
      }
      if (entrypoint === "decimals" && BigInt(address) === BigInt(config.underlyingAddress)) {
        return `0x${config.underlyingDecimals.toString(16)}`;
      }
      if (entrypoint === "get_version") {
        return VESU_RUNTIME_TEST.encodeShortString(VESU_RUNTIME_TEST.PINNED_POOL_VERSION);
      }
      if (entrypoint === "get_fee_amount") return fee;
      if (entrypoint === "get_proof_validity_blocks") return "0xa";
      if (entrypoint === "is_open_note_depositor_blocked") return "0x0";
      throw new Error(`unexpected ${entrypoint}`);
    },
  };
}

describe("Vesu runtime validation", () => {
  it("fails before RPC while the manifest is pending", async () => {
    let called = false;
    const account = {
      provider: {
        getClassHashAt: async () => {
          called = true;
          return "0x1";
        },
      },
    } as unknown as WalletAccountV6;
    await expect(assertVesuRuntime(account)).rejects.toThrow("vesu_earn_pending");
    expect(called).toBe(false);
  });

  it("passes when Vesu tuple and privacy pool pins match", async () => {
    await expect(
      assertVesuRuntimeWithConfig(mockAccount(happyPathHandlers()), verifiedConfig),
    ).resolves.toBeUndefined();
  });

  it("rejects privacy pool fee drift", async () => {
    const handlers = happyPathHandlers();
    const baseCall = handlers.call;
    handlers.call = (entrypoint, address) => {
      if (entrypoint === "get_fee_amount") return "0x1";
      return baseCall(entrypoint, address);
    };
    await expect(
      assertVesuRuntimeWithConfig(mockAccount(handlers), verifiedConfig),
    ).rejects.toThrow("privacy_pool_fee");
  });

  it("rejects privacy pool version drift", async () => {
    const handlers = happyPathHandlers();
    const baseCall = handlers.call;
    handlers.call = (entrypoint, address) => {
      if (entrypoint === "get_version") return VESU_RUNTIME_TEST.encodeShortString("2.1");
      return baseCall(entrypoint, address);
    };
    await expect(
      assertVesuRuntimeWithConfig(mockAccount(handlers), verifiedConfig),
    ).rejects.toThrow("privacy_pool_version");
  });

  it("rejects anonymizer open-note denylist", async () => {
    const handlers = happyPathHandlers();
    const baseCall = handlers.call;
    handlers.call = (entrypoint, address) => {
      if (entrypoint === "is_open_note_depositor_blocked") return "0x1";
      return baseCall(entrypoint, address);
    };
    await expect(
      assertVesuRuntimeWithConfig(mockAccount(handlers), verifiedConfig),
    ).rejects.toThrow("anonymizer_open_note_blocked");
  });

  it("rejects underlying decimals drift", async () => {
    const handlers = happyPathHandlers();
    const baseCall = handlers.call;
    handlers.call = (entrypoint, address) => {
      if (
        entrypoint === "decimals"
        && BigInt(address) === BigInt(verifiedConfig.underlyingAddress)
      ) {
        return "0x12";
      }
      return baseCall(entrypoint, address);
    };
    await expect(
      assertVesuRuntimeWithConfig(mockAccount(handlers), verifiedConfig),
    ).rejects.toThrow("usdc_decimals");
  });

  it("rejects an admitted config without a deployed anonymizer", async () => {
    const config = { ...verifiedConfig, anonymizerAddress: "UNDEPLOYED" };
    await expect(
      assertVesuRuntimeWithConfig(mockAccount(happyPathHandlers()), config),
    ).rejects.toThrow("vesu_manifest_mismatch:anonymizer_not_live");
  });
});
