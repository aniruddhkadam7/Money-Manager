import type { Metadata, Viewport } from "next";
import { Playfair_Display } from "next/font/google";
import "./globals.css";
import { THEME_SCRIPT } from "@/lib/theme-script";

/** The app's name is set like a British broadsheet headline (The Times' own masthead font isn't free to use). */
const brand = Playfair_Display({ weight: ["700", "800"], subsets: ["latin"], variable: "--font-playfair", display: "swap" });

export const metadata: Metadata = {
  title: "Money Manager",
  description: "A simple personal expense tracker.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the bottom tab bar sit above the iPhone home indicator (env(safe-area-inset-*)).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1120" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={brand.variable} suppressHydrationWarning>
      <head>
        {/* Sets the dark class before first paint, so a dark page never flashes white. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
