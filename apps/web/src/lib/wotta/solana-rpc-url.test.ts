import { describe, expect, it, vi, afterEach } from "vitest";
import { browserSolanaMainnetRpcUrl } from "./product-session";

describe("browserSolanaMainnetRpcUrl", () => {
  const origin = "http://localhost:3000";
  const proxy = "http://localhost:3000/api/solana-mainnet-rpc";

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to the same-origin Next proxy", () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL", "");
    expect(browserSolanaMainnetRpcUrl(origin)).toBe(proxy);
  });

  it("rewrites Solana Labs public hosts to the proxy", () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL", "https://api.mainnet-beta.solana.com");
    expect(browserSolanaMainnetRpcUrl(origin)).toBe(proxy);
    vi.stubEnv("NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL", "https://api.mainnet.solana.com");
    expect(browserSolanaMainnetRpcUrl(origin)).toBe(proxy);
  });

  it("keeps a dedicated provider URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL", "https://mainnet.helius-rpc.com/?api-key=test");
    expect(browserSolanaMainnetRpcUrl(origin)).toBe("https://mainnet.helius-rpc.com/?api-key=test");
  });

  it("resolves an explicit same-origin proxy path to an absolute RPC URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL", "/api/solana-mainnet-rpc");
    const rpcUrl = browserSolanaMainnetRpcUrl(origin);
    expect(rpcUrl).toBe(proxy);
    expect(new URL(rpcUrl).protocol).toBe("http:");
  });
});
