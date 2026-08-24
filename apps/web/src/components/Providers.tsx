"use client";

import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { SessionSync } from "@/components/SessionSync";
import { PrivacyVaultProvider } from "@/components/PrivacyVaultProvider";
import { SourceWalletProvider } from "@/components/SourceWalletProvider";
import { NetworkModeProvider } from "@/components/NetworkModeProvider";
import { NetworkWalletReconnectPrompt } from "@/components/NetworkWalletReconnectPrompt";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NetworkModeProvider>
      <SourceWalletProvider>
        <PrivacyVaultProvider>
        <SessionSync />
        <NetworkWalletReconnectPrompt />
        {children}
      <Toaster
        position="top-right"
        richColors
        closeButton
        toastOptions={{
          classNames: {
            toast: "max-w-sm text-sm",
            title: "text-sm font-medium",
            description: "text-xs",
          },
          duration: 4500,
        }}
      />
        </PrivacyVaultProvider>
      </SourceWalletProvider>
    </NetworkModeProvider>
  );
}
