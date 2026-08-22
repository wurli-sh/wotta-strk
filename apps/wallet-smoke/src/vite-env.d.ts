/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STARKNET_RPC_URL?: string;
  readonly VITE_STARKNET_NETWORK?: "mainnet" | "sepolia";
  readonly STARKNET_RPC_URL?: string;
  readonly VITE_HELPER_ADDRESS?: string;
  readonly VITE_TRANSFER_RECIPIENT?: string;
  readonly VITE_SMOKE_AMOUNT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
