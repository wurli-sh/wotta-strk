import { shortString } from "starknet";
import mainnetDeployment from "../../../deployments/mainnet.json" with { type: "json" };

export const WOTTA_WORKSPACE_VERSION = "0.0.0" as const;
export const STARKNET_JS_VERSION = "10.5.0" as const;

export const SN_MAIN = "SN_MAIN" as const;
export const SN_MAIN_FELT = shortString.encodeShortString(SN_MAIN);
export const SN_SEPOLIA = "SN_SEPOLIA" as const;
export const SN_SEPOLIA_FELT = shortString.encodeShortString(SN_SEPOLIA);

/** On-chain SNIP-12 domain for the Wotta Sepolia privacy identity class. */
export const SEPOLIA_PRIVACY_IDENTITY_SNIP12_DOMAIN = {
  name: "Wotta",
  version: "1",
  chainId: SN_SEPOLIA,
  revision: "1",
} as const;

export const USDC_MAINNET_ADDRESS = mainnetDeployment.usdc;
export const MAINNET_ESCROW_POOL_ADDRESS = mainnetDeployment.strk20Pool;

export const DENOMINATIONS = [
  "100000",
  "1000000",
  "10000000",
  "50000000",
  "100000000",
] as const;

export type Denomination = (typeof DENOMINATIONS)[number];

/** Codes 0–3 match the live Sepolia hook encoding; 0.1 USDC is code 4. */
export const DENOMINATION_CODES = {
  "1000000": 0,
  "10000000": 1,
  "50000000": 2,
  "100000000": 3,
  "100000": 4,
} as const satisfies Record<Denomination, number>;

export const DENOMINATION_BY_CODE = Object.freeze(
  Object.fromEntries(
    Object.entries(DENOMINATION_CODES).map(([denomination, code]) => [
      code,
      denomination,
    ]),
  ) as Record<number, Denomination>,
);

export const INTENT_STATES = [
  "draft",
  "quoted",
  "source_submitted",
  "source_confirmed",
  "attestation_ready",
  "destination_submitted",
  "funded",
  "delivered",
  "claimable",
  "claimed",
  "expired",
  "refundable",
  "refunded",
  "completed",
  "failed_recoverable",
  "failed_terminal",
] as const;

export type IntentState = (typeof INTENT_STATES)[number];
