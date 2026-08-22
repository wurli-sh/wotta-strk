import sepoliaDeployment from "../../../../../deployments/sepolia.json";

export type DirectPrivacyConfig = {
  chainId: "SN_SEPOLIA";
  poolAddress: string;
  poolClassHash: string;
  identityClassHash: string;
  usdc: string;
  proverPath: "/privacy/prover";
  discoveryPath: "/privacy/discovery";
  source: string;
  escrow?: { address: string; classHash: string; denomination: bigint };
};

export function directPrivacyConfig(): DirectPrivacyConfig {
  const direct = sepoliaDeployment.directPrivacy;
  if (direct.status !== "verified" || direct.escrow?.status !== "verified") {
    throw new Error("Sepolia private route is not verified");
  }
  return {
    chainId: "SN_SEPOLIA",
    poolAddress: direct.poolAddress,
    poolClassHash: direct.poolClassHash,
    identityClassHash: direct.identityClassHash,
    usdc: direct.usdc,
    proverPath: "/privacy/prover",
    discoveryPath: "/privacy/discovery",
    source: direct.source,
    escrow: {
      address: direct.escrow.address,
      classHash: direct.escrow.classHash,
      denomination: BigInt(direct.escrow.denomination),
    },
  };
}

export const SEPOLIA_CHAIN_ID = sepoliaDeployment.chainId;
