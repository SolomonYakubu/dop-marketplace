"use client";

import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";

export default function HomePage() {
  const { address } = useAccount();

  return (
    <div className="space-y-12">
      <section className="relative overflow-hidden rounded-2xl border border-gray-800 bg-gradient-to-br from-purple-950/40 via-black to-black p-8 sm:p-12">
        <div className="max-w-3xl">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
            The Web3 creative marketplace for briefs and gigs
          </h1>
          <p className="mt-4 text-lg text-gray-300">
            Escrowed, deflationary, and on-chain. Hire talent or offer services
            with secure dual-validation and DOP-powered boosts.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href="/browse"
              className="inline-flex items-center justify-center rounded-lg bg-white text-black px-5 py-3 text-sm font-medium hover:opacity-90"
            >
              Browse marketplace
            </Link>
            <Link
              href="/create"
              className="inline-flex items-center justify-center rounded-lg border border-gray-700 px-5 py-3 text-sm font-medium text-white hover:bg-gray-900"
            >
              Create a listing
            </Link>
          </div>
        </div>
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-purple-600/20 blur-3xl" />
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        <div className="container-panel p-6">
          <h3 className="text-lg font-medium">Dual-Validation Escrow</h3>
          <p className="mt-2 text-sm text-gray-400">
            Client and provider both approve before funds release.
          </p>
        </div>
        <div className="container-panel p-6">
          <h3 className="text-lg font-medium">Deflationary Tokenomics</h3>
          <p className="mt-2 text-sm text-gray-400">
            Fees trigger DOP buyback & burn. Pay with DOP for direct burn.
          </p>
        </div>
        <div className="container-panel p-6">
          <h3 className="text-lg font-medium">Profiles & Badges</h3>
          <p className="mt-2 text-sm text-gray-400">
            Verified profiles, portfolios on IPFS, and milestone badges.
          </p>
        </div>
      </section>

      <section className="container-panel p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Get started</h2>
            <p className="text-sm text-gray-400">
              Connect your wallet to post briefs, create gigs, and manage
              missions.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ConnectButton chainStatus="icon" showBalance={false} />
            {address ? (
              <span className="text-sm text-gray-400">Connected</span>
            ) : (
              <span className="text-sm text-gray-400">No wallet connected</span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
