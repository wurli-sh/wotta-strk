import {
  rehashDeploymentManifest,
  type DeploymentManifest,
} from "../../packages/shared/src/index.ts";

const FELT = /^0x[0-9a-f]+$/i;

/** Checks facts required by every mainnet contract operation. */
export function assertMainnetManifest(manifest: DeploymentManifest): void {
  if (manifest.chainId !== "SN_MAIN" || manifest.network !== "mainnet") throw new Error("mainnet_manifest_required");
  if (manifest.rpcUrlEnv !== "STARKNET_MAINNET_RPC_URL") {
    throw new Error("mainnet_blocked:manifest_must_use_mainnet_rpc_env");
  }
  if (manifest.manifestHash !== rehashDeploymentManifest(manifest)) {
    throw new Error("mainnet_blocked:deployment_manifest_hash_mismatch");
  }
}

/**
 * Pilot policy: deployer EOA is also router owner.
 * Syncs both fields from STARKNET_MAINNET_DEPLOYER_ADDRESS (does not rehash).
 */
export function syncMainnetPilotIdentities(
  manifest: DeploymentManifest,
  env: NodeJS.ProcessEnv = process.env,
): DeploymentManifest {
  const deployer = env.STARKNET_MAINNET_DEPLOYER_ADDRESS?.trim();
  if (!deployer || !FELT.test(deployer)) {
    throw new Error("mainnet_blocked:dedicated_deployer_credentials_missing");
  }
  return {
    ...manifest,
    deployer: {
      ...manifest.deployer,
      address: deployer,
      keySource: "env:STARKNET_MAINNET_DEPLOYER_PRIVATE_KEY",
    },
    authority: {
      ...manifest.authority,
      owner: deployer,
    },
  };
}

/** Constructor inputs must be concrete before deployment, not declaration. */
export function assertMainnetDeployConfig(manifest: DeploymentManifest): void {
  assertMainnetManifest(manifest);
  if (!FELT.test(manifest.authority.owner)) throw new Error("mainnet_blocked:authority_owner_open");
  if (manifest.approvedCctpDenominations.length === 0) throw new Error("mainnet_blocked:cctp_denominations_open");
  if (BigInt(manifest.authority.owner) !== BigInt(manifest.deployer.address)) {
    throw new Error("mainnet_blocked:pilot_owner_must_match_deployer");
  }
  if (!FELT.test(manifest.router.classHash) || !FELT.test(manifest.router.declareTxHash)) {
    throw new Error("mainnet_blocked:router_declaration_missing");
  }
  const approved = new Set(manifest.approvedCctpDenominations);
  const pools = manifest.pools.filter((pool) => approved.has(pool.denomination));
  if (pools.length !== approved.size
    || pools.some((pool) => !FELT.test(pool.classHash) || !FELT.test(pool.declareTxHash))) {
    throw new Error("mainnet_blocked:escrow_declaration_missing");
  }
}

/** Declaration/deployment needs only its own key and must not reuse Sepolia. */
export function assertMainnetDeployerIdentity(
  env: NodeJS.ProcessEnv,
  sepoliaDeployerAddress: string,
): void {
  const deployer = env.STARKNET_MAINNET_DEPLOYER_ADDRESS?.trim();
  const deployerKey = env.STARKNET_MAINNET_DEPLOYER_PRIVATE_KEY?.trim();
  if (!deployer || !FELT.test(deployer) || !deployerKey) throw new Error("mainnet_blocked:dedicated_deployer_credentials_missing");
  if (FELT.test(sepoliaDeployerAddress) && BigInt(deployer) === BigInt(sepoliaDeployerAddress)) {
    throw new Error("mainnet_blocked:mainnet_identity_reuses_sepolia_identity");
  }
}
