/**
 * Pins for the Vesu lending anonymizer source-to-class gate.
 * Keep in sync with docs/dependencies.md and deployments/mainnet.json#vesuEarn.
 */
export const VESU_ANONYMIZER_SOURCE = {
  repoUrl: "https://github.com/starkware-libs/starknet-privacy.git",
  /** PRIVACY-0.14.3-RC.2 */
  commit: "9bfeb8dd35565a2915a0617dff3f649bd5bb891a",
  tag: "PRIVACY-0.14.3-RC.2",
  scarbPackage: "vesu_lending_anonymizer",
  /** Sierra class hash reproduced with Scarb 2.17.0; must match mainnet.json. */
  expectedSierraClassHash:
    "0x05932298db5e32106f6f5814db6f3c378472d9c0d8f0d8370c87f6f1fd311e2f",
  /** CASM hash reproduced from the same pinned source and compiler. */
  expectedCompiledClassHash:
    "0x048bb3d8ac192bf1adca19a34fba73bc8478ccfa8875575776c2debea1225ccd",
} as const;
