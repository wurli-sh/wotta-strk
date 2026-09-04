import { encodeCctpHookWrapperV1Hex, type WottaHookV1Input } from "@wotta/shared";
import { encodeFunctionData, getAddress, padHex, type Hex } from "viem";

export const CIRCLE_STARKNET_DOMAIN = 25 as const;

export type WottaSourceRoute = "ethereum" | "arbitrum" | "base" | "solana" | "stellar";
export type CircleEnvironment = "testnet" | "mainnet";

export type CircleRouteConfig = {
  id: WottaSourceRoute;
  environment: CircleEnvironment;
  family: "evm" | "solana" | "stellar";
  domain: number;
  network: string;
  usdc: string;
  tokenMessenger: string;
  messageTransmitter?: string;
  chainId?: number;
  networkPassphrase?: string;
  solanaGenesisHash?: string;
};

/** Circle's current public CCTP V2 testnet deployments. */
export const CIRCLE_TESTNET_ROUTES: Readonly<Record<WottaSourceRoute, CircleRouteConfig>> = {
  ethereum: {
    id: "ethereum", environment: "testnet", family: "evm", domain: 0, network: "Ethereum Sepolia", chainId: 11155111,
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  },
  arbitrum: {
    id: "arbitrum", environment: "testnet", family: "evm", domain: 3, network: "Arbitrum Sepolia", chainId: 421614,
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  },
  base: {
    id: "base", environment: "testnet", family: "evm", domain: 6, network: "Base Sepolia", chainId: 84532,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  },
  solana: {
    id: "solana", environment: "testnet", family: "solana", domain: 5, network: "Solana Devnet",
    usdc: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    tokenMessenger: "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe",
    messageTransmitter: "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC",
    solanaGenesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  },
  stellar: {
    id: "stellar", environment: "testnet", family: "stellar", domain: 27, network: "Stellar Testnet",
    usdc: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    tokenMessenger: "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP",
    messageTransmitter: "CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
};

/** Circle's CCTP V2 mainnet deployments for Base and Solana (the only activated routes). */
export const CIRCLE_MAINNET_ROUTES: Partial<Readonly<Record<WottaSourceRoute, CircleRouteConfig>>> = {
  base: {
    id: "base", environment: "mainnet", family: "evm", domain: 6, network: "Base", chainId: 8453,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tokenMessenger: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
    messageTransmitter: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64",
  },
  solana: {
    id: "solana", environment: "mainnet", family: "solana", domain: 5, network: "Solana",
    usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    tokenMessenger: "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe",
    messageTransmitter: "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC",
    solanaGenesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  },
};

export const CIRCLE_ROUTE_REGISTRY: Record<
  CircleEnvironment,
  Partial<Readonly<Record<WottaSourceRoute, CircleRouteConfig>>>
> = {
  testnet: CIRCLE_TESTNET_ROUTES,
  mainnet: CIRCLE_MAINNET_ROUTES,
};

const ERC20_APPROVE_ABI = [{
  type: "function", name: "approve", stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}] as const;

const TOKEN_MESSENGER_V2_ABI = [{
  type: "function", name: "depositForBurnWithHook", stateMutability: "nonpayable",
  inputs: [
    { name: "amount", type: "uint256" },
    { name: "destinationDomain", type: "uint32" },
    { name: "mintRecipient", type: "bytes32" },
    { name: "burnToken", type: "address" },
    { name: "destinationCaller", type: "bytes32" },
    { name: "maxFee", type: "uint256" },
    { name: "minFinalityThreshold", type: "uint32" },
    { name: "hookData", type: "bytes" },
  ],
  outputs: [],
}] as const;

export type EvmWalletCall = { to: Hex; data: Hex; value: "0x0" };

/**
 * Creates the two executable wallet calls for Ethereum/Base/Arbitrum:
 * approve native Circle USDC, then burn with Wotta's opaque delivery hook.
 */
export function buildEvmCctpBurnCalls(input: {
  env: CircleEnvironment;
  route: "ethereum" | "arbitrum" | "base";
  router: Hex;
  amount: bigint;
  hook: WottaHookV1Input;
  maxFee?: bigint;
  minFinalityThreshold?: 1000 | 2000;
}): { route: CircleRouteConfig; calls: readonly [EvmWalletCall, EvmWalletCall]; hookData: Hex } {
  const registry = CIRCLE_ROUTE_REGISTRY[input.env];
  const route = registry[input.route];
  if (!route) throw new Error(`Route "${input.route}" is not configured for the "${input.env}" environment`);
  if (input.amount <= 0n) throw new RangeError("amount must be positive");
  const routerBytes32 = padHex(input.router, { size: 32 });
  const hookData = encodeCctpHookWrapperV1Hex(input.hook) as Hex;
  const tokenMessenger = getAddress(route.tokenMessenger as Hex);
  const usdc = getAddress(route.usdc as Hex);
  return {
    route,
    hookData,
    calls: [
      {
        to: usdc,
        value: "0x0",
        data: encodeFunctionData({
          abi: ERC20_APPROVE_ABI,
          functionName: "approve",
          args: [tokenMessenger, input.amount],
        }),
      },
      {
        to: tokenMessenger,
        value: "0x0",
        data: encodeFunctionData({
          abi: TOKEN_MESSENGER_V2_ABI,
          functionName: "depositForBurnWithHook",
          args: [
            input.amount,
            CIRCLE_STARKNET_DOMAIN,
            routerBytes32,
            usdc,
            routerBytes32,
            input.maxFee ?? 0n,
            input.minFinalityThreshold ?? 2000,
            hookData,
          ],
        }),
      },
    ],
  };
}

/**
 * Canonical non-EVM instruction inputs. Wallet clients feed these values into
 * Circle's official Solana Anchor or Stellar Soroban SDK builders.
 */
export function buildNonEvmCctpBurnPlan(input: {
  env: CircleEnvironment;
  route: "solana" | "stellar";
  router: Hex;
  amount: bigint;
  hook: WottaHookV1Input;
  maxFee?: bigint;
  minFinalityThreshold?: 1000 | 2000;
}) {
  if (input.amount <= 0n || input.amount > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError("non-EVM amount must fit in u64");
  }
  const registry = CIRCLE_ROUTE_REGISTRY[input.env];
  const route = registry[input.route];
  if (!route) throw new Error(`Route "${input.route}" is not configured for the "${input.env}" environment`);
  return {
    route,
    method: "deposit_for_burn_with_hook" as const,
    args: {
      amount: input.amount.toString(),
      destinationDomain: CIRCLE_STARKNET_DOMAIN,
      mintRecipient: padHex(input.router, { size: 32 }),
      destinationCaller: padHex(input.router, { size: 32 }),
      maxFee: (input.maxFee ?? 0n).toString(),
      minFinalityThreshold: input.minFinalityThreshold ?? 2000,
      hookData: encodeCctpHookWrapperV1Hex(input.hook) as Hex,
    },
  };
}

export type NonEvmCctpBurnPlan = ReturnType<typeof buildNonEvmCctpBurnPlan>;
export type EvmCctpBurnPlan = ReturnType<typeof buildEvmCctpBurnCalls>;
export { connectEvmSource, executeEvmCctpBurn } from "./evm.ts";
export { connectSolanaSource, executeSolanaCctpBurn } from "./solana.ts";
export { connectStellarSource, executeStellarCctpBurn } from "./stellar.ts";
