import type { Metadata } from "next";
import localFont from "next/font/local";
import { GlimmProvider } from "glimm/next";
import { AppChrome } from "@/components/AppChrome";
import { Providers } from "@/components/Providers";
import { SITE_DESCRIPTION } from "@/lib/brand-copy";
import { BRAND_GLIMM_SWEEP } from "@/lib/glimmBrand";
import "./globals.css";

const onest = localFont({
  src: [
    {
      path: "../../public/fonts/Onest-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/Onest-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../public/fonts/Onest-SemiBold.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../public/fonts/Onest-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-onest",
  display: "swap",
  preload: true,
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  title: "Wotta",
  description: SITE_DESCRIPTION,
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
    <html lang="en" className={onest.variable}>
      <head>
        <meta name="referrer" content="no-referrer" />
      </head>
      <body className="font-sans antialiased">
        <GlimmProvider {...BRAND_GLIMM_SWEEP}>
          <Providers>
            <AppChrome>{children}</AppChrome>
          </Providers>
        </GlimmProvider>
      </body>
    </html>
  );
}
