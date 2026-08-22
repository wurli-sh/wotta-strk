import { encodeCctpHookWrapperV1Hex, type WottaHookV1Input } from "@wotta/shared";
import { encodeFunctionData, getAddress, padHex, type Hex } from "viem";

export const CIRCLE_STARKNET_DOMAIN = 25 as const;

export type WottaSourceRoute = "ethereum" | "arbitrum" | "base" | "solana" | "stellar";

export type CircleRouteConfig = {
  id: WottaSourceRoute;
  family: "evm" | "solana" | "stellar";
  domain: number;
  network: string;
  usdc: string;
  tokenMessenger: string;
  messageTransmitter?: string;
  chainId?: number;
  networkPassphrase?: string;
};

/** Circle's current public CCTP V2 testnet deployments. */
export const CIRCLE_TESTNET_ROUTES: Readonly<Record<WottaSourceRoute, CircleRouteConfig>> = {
  ethereum: {
    id: "ethereum", family: "evm", domain: 0, network: "Ethereum Sepolia", chainId: 11155111,
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  },
  arbitrum: {
    id: "arbitrum", family: "evm", domain: 3, network: "Arbitrum Sepolia", chainId: 421614,
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  },
  base: {
    id: "base", family: "evm", domain: 6, network: "Base Sepolia", chainId: 84532,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    tokenMessenger: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  },
  solana: {
    id: "solana", family: "solana", domain: 5, network: "Solana Devnet",
    usdc: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    tokenMessenger: "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe",
    messageTransmitter: "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC",
  },
  stellar: {
    id: "stellar", family: "stellar", domain: 27, network: "Stellar Testnet",
    usdc: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    tokenMessenger: "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP",
    messageTransmitter: "CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
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
  route: "ethereum" | "arbitrum" | "base";
  router: Hex;
  amount: bigint;
  hook: WottaHookV1Input;
  maxFee?: bigint;
  minFinalityThreshold?: 1000 | 2000;
}): { route: CircleRouteConfig; calls: readonly [EvmWalletCall, EvmWalletCall]; hookData: Hex } {
  const route = CIRCLE_TESTNET_ROUTES[input.route];
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
  return {
    route: CIRCLE_TESTNET_ROUTES[input.route],
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
