import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { Header } from "@/components/Header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Death of Pengu Marketplace",
  description: "Decentralized Web3 Creative Marketplace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-full antialiased`}
      >
        <div className="noise-layer" aria-hidden />
        <Providers>
          <Header />
          <main className="relative mx-auto w-full max-w-7xl px-5 md:px-8 py-10 md:py-14">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
