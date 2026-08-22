"use client";

import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { SessionSync } from "@/components/SessionSync";
import { PrivacyVaultProvider } from "@/components/PrivacyVaultProvider";
import { SourceWalletProvider } from "@/components/SourceWalletProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SourceWalletProvider>
      <PrivacyVaultProvider>
        <SessionSync />
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
  );
}
