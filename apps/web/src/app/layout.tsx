import type { Metadata } from "next";
import { GlimmProvider, InterceptLinks } from "glimm/next";
import { AppChrome } from "@/components/AppChrome";
import { Providers } from "@/components/Providers";
import { BRAND_GLIMM_SWEEP } from "@/lib/glimmBrand";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wotta",
  description:
    "Private USDC payments through Starknet, with full Testnet beta routes and a restricted live-pool Mainnet mode.",
  referrer: "no-referrer",
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", type: "image/png" },
      { url: "/favicon-16x16.png", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="referrer" content="no-referrer" />
      </head>
      <body>
        <GlimmProvider {...BRAND_GLIMM_SWEEP}>
          <InterceptLinks />
          <Providers>
            <AppChrome>{children}</AppChrome>
          </Providers>
        </GlimmProvider>
      </body>
    </html>
  );
}
