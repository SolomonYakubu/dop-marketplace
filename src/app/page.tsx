"use client";

import Link from "next/link";
import {
  ShieldCheck,
  LockKeyhole,
  Flame,
  Trophy,
  Layers3,
  RefreshCcw,
  Coins,
  Handshake,
  Sparkles,
} from "lucide-react";

// Feature & step configuration (could be extracted later if reused)
const features = [
  {
    title: "Dual Validation",
    desc: "Payment only releases when both sides finalize—simple, fair, human readable.",
    icon: LockKeyhole,
  },
  {
    title: "Deflationary Engine",
    desc: "DOP payments route part of fees to burn. Other tokens trigger a DOP buy & burn.",
    icon: Flame,
  },
  {
    title: "Reputation Layer",
    desc: "Earn mission history, badges & trust signals that compound discovery.",
    icon: Trophy,
  },
  {
    title: "Boost Visibility",
    desc: "Burn-backed boosts push listings & profiles for a timed window.",
    icon: Sparkles,
  },
  {
    title: "Portable Assets",
    desc: "Profiles & portfolios reference decentralized storage (IPFS compatible).",
    icon: Layers3,
  },
  {
    title: "Dispute Path",
    desc: "Built-in dispute & appeal flow—recover fairness when collaboration stalls.",
    icon: RefreshCcw,
  },
];

const steps = [
  { n: 1, t: "Connect wallet", d: "No email, just your address & session." },
  { n: 2, t: "Post or browse", d: "Briefs for hiring. Gigs for offering." },
  { n: 3, t: "Lock escrow", d: "Funds held in smart contract vault." },
  { n: 4, t: "Deliver & validate", d: "Both confirm → release or dispute." },
  { n: 5, t: "Earn reputation", d: "Badges + immutable record on-chain." },
];

export default function HomePage() {
  return (
    <main className="relative">
      {/* Animated grid background */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-black">
        {/* Base grid pattern */}
        <div className="absolute inset-0 opacity-30">
          <div
            className="h-full w-full animate-pulse"
            style={{
              backgroundImage: `
                linear-gradient(rgba(75, 85, 99, 0.3) 1px, transparent 1px),
                linear-gradient(90deg, rgba(75, 85, 99, 0.3) 1px, transparent 1px)
              `,
              backgroundSize: "50px 50px",
            }}
          />
        </div>

        {/* Moving grid overlay */}
        <div className="absolute inset-0 opacity-10">
          <div
            className="h-full w-full grid-move"
            style={{
              backgroundImage: `
                linear-gradient(rgba(156, 163, 175, 0.4) 1px, transparent 1px),
                linear-gradient(90deg, rgba(156, 163, 175, 0.4) 1px, transparent 1px)
              `,
              backgroundSize: "100px 100px",
            }}
          />
        </div>

        {/* Diagonal moving lines */}
        <div className="absolute inset-0 opacity-5">
          <div
            className="h-full w-full diagonal-move"
            style={{
              backgroundImage: `
                linear-gradient(45deg, rgba(107, 114, 128, 0.6) 1px, transparent 1px),
                linear-gradient(-45deg, rgba(107, 114, 128, 0.6) 1px, transparent 1px)
              `,
              backgroundSize: "80px 80px",
            }}
          />
        </div>
      </div>{" "}
      {/* Hero Section */}
      <section className="relative py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            {/* Left column - Main content */}
            <div className="space-y-8 text-center lg:text-left">
              <div className="space-y-6">
                <div className="inline-flex items-center gap-2 rounded-full border border-gray-800 bg-gray-900/50 px-4 py-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75"></span>
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-purple-400"></span>
                  </span>
                  <span className="text-xs font-medium tracking-wide text-purple-200">
                    Now in Beta
                  </span>
                </div>

                <h1 className="text-balance text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight">
                  <span className="block metallic-silver">
                    The on‑chain creative marketplace
                  </span>
                  <span className="mt-1 block text-xl sm:text-2xl font-normal text-gray-400">
                    for the modern web
                  </span>
                </h1>

                <p className="mx-auto max-w-2xl text-lg leading-relaxed text-gray-300 lg:mx-0">
                  Escrow-secured collaboration with deflationary token
                  mechanics. Build reputation that compounds your opportunities.
                  Discover, hire, deliver, verify—all trustlessly.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-4 lg:justify-start">
                <Link
                  href="/browse"
                  className="group relative inline-flex items-center gap-3 rounded-lg bg-purple-600 px-6 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:bg-purple-700 focus-visible:ring-2 focus-visible:ring-purple-500"
                >
                  <span>Explore Live Briefs</span>
                  <span className="transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </Link>

                <Link
                  href="/create"
                  className="inline-flex items-center gap-3 rounded-lg border border-gray-700 bg-gray-800/50 px-6 py-3 text-sm font-medium text-gray-200 transition-all hover:bg-gray-700/50 focus-visible:ring-2 focus-visible:ring-gray-500"
                >
                  Launch a Listing
                </Link>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 pt-4 text-sm text-gray-500 lg:justify-start">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-400"></div>
                  <span>Trustless escrow</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-fuchsia-400"></div>
                  <span>Deflationary mechanics</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-indigo-400"></div>
                  <span>On-chain reputation</span>
                </div>
              </div>
            </div>

            {/* Right column - Interactive preview */}
            <div className="relative">
              <div className="mx-auto max-w-lg">
                {/* Main panel */}
                <div className="relative overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50 p-6">
                  <div className="space-y-6">
                    <header className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold tracking-wider text-gray-400 uppercase">
                        Collaboration Flow
                      </h3>
                      <span className="rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-xs text-gray-400">
                        Immutable
                      </span>
                    </header>
                    <div className="space-y-4">
                      {steps.map((s, index) => (
                        <div key={s.n} className="flex items-start gap-3">
                          <div className="relative">
                            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-600 text-xs font-bold text-white">
                              {s.n}
                            </div>
                            {index < steps.length - 1 && (
                              <div className="absolute left-1/2 top-7 h-4 w-px -translate-x-1/2 bg-gray-700" />
                            )}
                          </div>
                          <div className="flex-1 space-y-1">
                            <p className="font-medium text-gray-200 text-sm">
                              {s.t}
                            </p>
                            <p className="text-xs leading-relaxed text-gray-400">
                              {s.d}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-lg border border-purple-600/30 bg-purple-600/10 p-4">
                      <p className="text-sm font-medium text-purple-200">
                        Built for trust
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-purple-300/80">
                        Every step is reversible until both parties confirm
                        completion. No hidden fees, no platform lock-in.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* Features Section */}
      <section className="relative py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white">
              Why it works
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-gray-400">
              Simple primitives that compose into powerful collaboration tools
            </p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="container-panel p-6 transition-all hover:border-purple-600/40"
                >
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-purple-600 text-white">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-white">
                    {f.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-400">
                    {f.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      {/* Protocol Details Section */}
      <section className="relative py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white">
              Designed for everyone
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-gray-400">
              Multi-token support, fair fees, and enterprise-grade security
            </p>
          </div>

          <div className="mt-12 grid gap-8 lg:grid-cols-3">
            {/* Multi-token payments */}
            <div className="container-panel p-6">
              <div className="flex items-center gap-3 text-lg font-semibold text-purple-200">
                <Coins className="h-6 w-6" />
                <span>Multi‑Token Payments</span>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-gray-300">
                Pay or get paid in ETH, stablecoins (USDC), or native DOP
                tokens. DOP payments enjoy reduced fees with instant burn
                mechanics, while other tokens trigger automatic DOP buy & burn.
              </p>
              <div className="mt-6 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-purple-400" />
                  <div>
                    <p className="font-medium text-gray-200 text-sm">ETH</p>
                    <p className="text-xs text-gray-400">
                      Standard escrow + buy & burn
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-purple-400" />
                  <div>
                    <p className="font-medium text-gray-200 text-sm">
                      USDC & Stablecoins
                    </p>
                    <p className="text-xs text-gray-400">
                      Stable pricing + DOP conversion
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-purple-400" />
                  <div>
                    <p className="font-medium text-gray-200 text-sm">DOP</p>
                    <p className="text-xs text-gray-400">
                      Reduced fees & direct burn
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Fee Structure */}
            <div className="container-panel p-6">
              <div className="flex items-center gap-3 text-lg font-semibold text-purple-200">
                <Flame className="h-6 w-6" />
                <span>Transparent Fees</span>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-gray-300">
                Two simple tiers with built-in deflationary mechanics. Half of
                every protocol fee is burned, creating sustainable scarcity
                while funding development.
              </p>
              <div className="mt-6 space-y-3">
                <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-4">
                  <p className="font-semibold text-purple-200 text-sm">
                    Standard Rate
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-400">
                    Up to 20% service fee, split 50/50 between burn mechanism
                    and treasury
                  </p>
                </div>
                <div className="rounded-lg border border-purple-600/30 bg-purple-600/10 p-4">
                  <p className="font-semibold text-purple-200 text-sm">
                    DOP Preferred
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-300">
                    Reduced 10% fee with immediate burn mechanics
                  </p>
                </div>
              </div>
            </div>

            {/* Security */}
            <div className="container-panel p-6">
              <div className="flex items-center gap-3 text-lg font-semibold text-purple-200">
                <ShieldCheck className="h-6 w-6" />
                <span>Enterprise Security</span>
              </div>
              <div className="mt-4 space-y-4">
                <div className="flex gap-3">
                  <Handshake className="h-4 w-4 text-purple-300 mt-1" />
                  <div>
                    <p className="font-medium text-gray-200 text-sm">
                      Dual Confirmation
                    </p>
                    <p className="text-xs text-gray-400">
                      Payment only releases when both parties approve
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <LockKeyhole className="h-4 w-4 text-purple-300 mt-1" />
                  <div>
                    <p className="font-medium text-gray-200 text-sm">
                      Reentrancy Protection
                    </p>
                    <p className="text-xs text-gray-400">
                      Industry-standard security patterns embedded
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <RefreshCcw className="h-4 w-4 text-purple-300 mt-1" />
                  <div>
                    <p className="font-medium text-gray-200 text-sm">
                      Dispute Resolution
                    </p>
                    <p className="text-xs text-gray-400">
                      Built-in appeal system for fair outcomes
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Layers3 className="h-4 w-4 text-purple-300 mt-1" />
                  <div>
                    <p className="font-medium text-gray-200 text-sm">
                      Upgradeable Design
                    </p>
                    <p className="text-xs text-gray-400">
                      Safe iteration without compromising funds
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* CTA Section */}
      <section className="relative py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="container-panel p-12 text-center">
            <h3 className="text-3xl font-bold text-white">
              Ready to build your reputation?
            </h3>
            <p className="mt-4 text-lg leading-relaxed text-gray-300">
              Start with a listing or respond to open briefs. The protocol
              handles escrow, validation, and deflationary alignment
              automatically.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/create"
                className="inline-flex items-center gap-3 rounded-lg bg-white px-6 py-3 text-lg font-semibold text-black transition-all hover:bg-gray-100"
              >
                Launch a Listing
              </Link>
              <Link
                href="/browse"
                className="inline-flex items-center gap-3 rounded-lg border border-gray-600 bg-gray-800/50 px-6 py-3 text-lg font-medium text-white transition-all hover:bg-gray-700/50"
              >
                Explore Briefs
              </Link>
            </div>
          </div>
        </div>
      </section>
      {/* Footer */}
      <footer className="relative border-t border-gray-800 py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-6 text-sm text-gray-500">
            <span>© {new Date().getFullYear()} DOP Marketplace (Beta)</span>
            <div className="flex gap-8">
              <Link
                href="/terms"
                className="transition-colors hover:text-gray-300"
              >
                Terms
              </Link>
              <Link
                href="/privacy"
                className="transition-colors hover:text-gray-300"
              >
                Privacy
              </Link>
              <Link
                href="/docs"
                className="transition-colors hover:text-gray-300"
              >
                Documentation
              </Link>
            </div>
          </div>
        </div>
      </footer>
      {/* Local styles for metallic silver effect and grid animations */}
      <style jsx global>{`
        .metallic-silver {
          background: linear-gradient(
            100deg,
            #f5f7fa 0%,
            #cfd3d9 20%,
            #ffffff 38%,
            #babfc6 55%,
            #f7f9fb 72%,
            #d5d9df 84%,
            #ffffff 100%
          );
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          filter: drop-shadow(0 2px 4px rgba(255, 255, 255, 0.05))
            drop-shadow(0 4px 18px rgba(120, 110, 160, 0.25));
        }

        @keyframes grid-move {
          0% {
            transform: translate(0, 0);
          }
          100% {
            transform: translate(100px, 100px);
          }
        }

        @keyframes diagonal-move {
          0% {
            transform: translate(0, 0) rotate(0deg);
          }
          100% {
            transform: translate(80px, 80px) rotate(180deg);
          }
        }

        .grid-move {
          animation: grid-move 20s linear infinite;
        }

        .diagonal-move {
          animation: diagonal-move 30s linear infinite;
        }
      `}</style>
    </main>
  );
}
