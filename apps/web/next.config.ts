import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rootEnv = path.join(root, ".env");
if (existsSync(rootEnv)) loadEnvFile(rootEnv);

const isDev = process.env.NODE_ENV !== "production";
const publicValue = (...names: string[]) => {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
};

const proverUpstream =
  process.env.PRIVACY_PROVER_UPSTREAM ??
  "https://transaction-prover.alpha-sepolia.sw-dev.io";
const discoveryUpstream =
  process.env.PRIVACY_DISCOVERY_UPSTREAM ??
  "https://discovery-service.alpha-sepolia.sw-dev.io";
const connectSrc = [
  "'self'",
  "https:",
  "wss:",
  ...(isDev ? ["ws:", "http://localhost:*", "http://127.0.0.1:*"] : []),
].join(" ");

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_ORIGIN:
      publicValue("NEXT_PUBLIC_APP_ORIGIN") ??
      (isDev ? "http://localhost:3000" : undefined),
    NEXT_PUBLIC_API_URL: publicValue("NEXT_PUBLIC_API_URL", "API_ORIGIN"),
    NEXT_PUBLIC_SUPABASE_URL: publicValue(
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_URL",
      "VITE_SUPABASE_URL",
    ),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicValue(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_ANON_KEY",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
    ),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: publicValue(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_ANON_KEY",
      "VITE_SUPABASE_PUBLISHABLE_KEY",
    ),
    NEXT_PUBLIC_STARKNET_RPC_URL: publicValue("NEXT_PUBLIC_STARKNET_RPC_URL", "STARKNET_RPC_URL"),
    NEXT_PUBLIC_SOLANA_RPC_URL: publicValue("NEXT_PUBLIC_SOLANA_RPC_URL", "SOLANA_DEVNET_RPC_URL"),
    NEXT_PUBLIC_STELLAR_RPC_URL: publicValue("NEXT_PUBLIC_STELLAR_RPC_URL", "STELLAR_TESTNET_RPC_URL"),
  },
  outputFileTracingRoot: root,
  poweredByHeader: false,
  transpilePackages: [
    "@wotta/adapters",
    "@wotta/crypto",
    "@wotta/shared",
    "@starkware-libs/starknet-privacy-sdk",
  ],
  experimental: { externalDir: true },
  async rewrites() {
    return [
      {
        source: "/privacy/prover/:path*",
        destination: `${proverUpstream}/:path*`,
      },
      {
        source: "/privacy/discovery/:path*",
        destination: `${discoveryUpstream}/:path*`,
      },
    ];
  },
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "font-src 'self' data:",
            `connect-src ${connectSrc}`,
            "frame-ancestors 'none'",
            "base-uri 'self'",
          ].join("; "),
        },
      ],
    },
    {
      source: "/(register|send|inbox|balance|withdraw|account)/:path*",
      headers: [{ key: "Cache-Control", value: "no-store" }],
    },
  ],
};

export default nextConfig;
