"use client";

import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { SessionSync } from "@/components/SessionSync";
import { SourceWalletProvider } from "@/components/SourceWalletProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SourceWalletProvider>
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
    </SourceWalletProvider>
  );
}
