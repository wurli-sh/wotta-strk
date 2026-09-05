import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { constants } from "starknet";
import mainnetDeployment from "../../../../../deployments/mainnet.json";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  requestChainId: vi.fn(),
  supportedWalletApi: vi.fn(),
  switchStarknetChain: vi.fn(),
  wallet: { name: "Ready" },
}));

vi.mock("@starknet-io/get-starknet-discovery", () => ({
  createStore: () => ({ getWallets: () => [mocks.wallet] }),
}));

vi.mock("starknet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("starknet")>();
  return {
    ...actual,
    WalletAccountV6: { connect: mocks.connect },
    walletV6: {
      ...actual.walletV6,
      requestChainId: mocks.requestChainId,
      supportedWalletApi: mocks.supportedWalletApi,
      switchStarknetChain: mocks.switchStarknetChain,
    },
  };
});

import { activationFeeToken, clearReadyConnections, connectReady } from "./ready";

function account(chainId: string, address = "0x123") {
  return {
    address,
    provider: { getChainId: vi.fn().mockResolvedValue(chainId) },
  };
}

beforeEach(() => {
  clearReadyConnections();
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_STARKNET_MAINNET_RPC_URL", "https://mainnet.rpc.example");
  vi.stubEnv("NEXT_PUBLIC_STARKNET_TESTNET_RPC_URL", "https://sepolia.rpc.example");
  mocks.requestChainId.mockResolvedValue(constants.StarknetChainId.SN_MAIN);
  mocks.supportedWalletApi.mockResolvedValue(["0.10.3"]);
  mocks.connect.mockResolvedValue(account(constants.StarknetChainId.SN_MAIN));
});

afterEach(() => {
  clearReadyConnections();
  vi.unstubAllEnvs();
});

describe("Ready account activation", () => {
  it("selects the token configured for the active Starknet network", () => {
    expect(activationFeeToken("mainnet")).toBe(mainnetDeployment.walletManagedPrivacy.feeToken);
    expect(activationFeeToken("testnet")).toMatch(/^0x[0-9a-f]+$/i);
  });
});

describe("Ready connection lifecycle", () => {
  it("reuses the Ready connection for repeated actions on one network", async () => {
    const first = await connectReady("mainnet");
    const second = await connectReady("mainnet");

    expect(second).toBe(first);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent unlock and claim connection requests", async () => {
    let resolveConnect!: (value: ReturnType<typeof account>) => void;
    mocks.connect.mockReturnValue(new Promise((resolve) => {
      resolveConnect = resolve;
    }));

    const unlock = connectReady("mainnet");
    const claim = connectReady("mainnet");
    resolveConnect(account(constants.StarknetChainId.SN_MAIN));

    const [unlocked, claimed] = await Promise.all([unlock, claim]);
    expect(claimed).toBe(unlocked);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
  });

  it("keeps separate cached connections for Mainnet and Sepolia", async () => {
    mocks.requestChainId
      .mockResolvedValueOnce(constants.StarknetChainId.SN_MAIN)
      .mockResolvedValueOnce(constants.StarknetChainId.SN_SEPOLIA)
      .mockResolvedValueOnce(constants.StarknetChainId.SN_MAIN);
    mocks.connect
      .mockResolvedValueOnce(account(constants.StarknetChainId.SN_MAIN, "0x123"))
      .mockResolvedValueOnce(account(constants.StarknetChainId.SN_SEPOLIA, "0x456"));

    const mainnet = await connectReady("mainnet");
    const testnet = await connectReady("testnet");
    const mainnetAgain = await connectReady("mainnet");

    expect(mainnetAgain).toBe(mainnet);
    expect(testnet).not.toBe(mainnet);
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });

  it("creates a fresh connection only when explicitly forced", async () => {
    mocks.connect
      .mockResolvedValueOnce(account(constants.StarknetChainId.SN_MAIN, "0x123"))
      .mockResolvedValueOnce(account(constants.StarknetChainId.SN_MAIN, "0x123"));

    const first = await connectReady("mainnet");
    const second = await connectReady("mainnet", { forceReconnect: true });

    expect(second).not.toBe(first);
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });
});
