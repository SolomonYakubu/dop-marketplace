"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  LockKeyhole,
  Flame,
  Trophy,
  Layers3,
  RefreshCcw,
  Coins,
  Handshake,
  Wallet,
  Search,
  FileText,
  ArrowRight,
  Palette,
  Shield,
  Zap,
  Code,
  Briefcase,
} from "lucide-react";

// Core features - simplified and focused
const coreFeatures = [
  {
    title: "Trustless Payments",
    description:
      "Funds locked in smart contracts until both parties confirm delivery",
    icon: LockKeyhole,
    color: "emerald",
  },
  {
    title: "On-Chain Reputation",
    description:
      "Build verifiable history that travels with you across platforms",
    icon: Trophy,
    color: "purple",
  },
  {
    title: "Deflationary Economics",
    description:
      "Every transaction burns tokens, creating sustainable value growth",
    icon: Flame,
    color: "orange",
  },
];

// How it works - streamlined process
const workflowSteps = [
  {
    step: "01",
    title: "Connect Wallet",
    description: "Link your Web3 wallet - no email required",
    icon: Wallet,
  },
  {
    step: "02",
    title: "Create or Browse",
    description: "Post work requests or offer your services",
    icon: Search,
  },
  {
    step: "03",
    title: "Secure Funds",
    description: "Lock payment in trustless smart contract",
    icon: LockKeyhole,
  },
  {
    step: "04",
    title: "Collaborate",
    description: "Work together with milestone tracking",
    icon: Handshake,
  },
  {
    step: "05",
    title: "Release & Build",
    description: "Confirm completion and earn reputation",
    icon: Trophy,
  },
];

// Use cases - clear value props
const useCases = [
  {
    title: "For Businesses",
    description:
      "Hire top talent with guaranteed delivery and transparent pricing",
    icon: Briefcase,
    features: ["Escrow protection", "Quality assurance", "Global talent pool"],
  },
  {
    title: "For Creators",
    description:
      "Showcase skills, build reputation, and get paid fairly for great work",
    icon: Palette,
    features: ["Portfolio building", "Instant payments", "Reputation system"],
  },
  {
    title: "For Developers",
    description:
      "Find technical projects and build your on-chain professional identity",
    icon: Code,
    features: ["Tech-focused gigs", "Verifiable commits", "Skill validation"],
  },
];

// Security features
const securityFeatures = [
  {
    title: "Multi-sig Escrow",
    description: "Funds released only when both parties agree",
    icon: Shield,
  },
  {
    title: "Dispute Resolution",
    description: "Built-in mediation for fair conflict resolution",
    icon: RefreshCcw,
  },
  {
    title: "Reentrancy Safe",
    description: "Battle-tested smart contract security patterns",
    icon: Zap,
  },
  {
    title: "Upgradeable",
    description: "Evolve safely without compromising user funds",
    icon: Layers3,
  },
];

// Tiny scroll-reveal wrapper for tasteful entrance animations
function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? "is-visible" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="relative">
      {/* Enhanced Aurora Background */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-black"></div>
      </div>

      {/* Hero Section */}
      <section className="relative px-6 pt-20 pb-16">
        {/* Background kept pure black: removed floating orbs */}

        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-500/5 px-4 py-2 backdrop-blur-sm">
              <div className="relative">
                <div className="absolute h-2 w-2 animate-ping rounded-full bg-purple-400 opacity-75"></div>
                <div className="h-2 w-2 rounded-full bg-purple-400"></div>
              </div>
              <span className="text-sm font-medium text-purple-200">
                Now in Beta
              </span>
            </div>

            <Reveal>
              <h1 className="mt-8 text-5xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">
                <span className="metallic-silver">The Future of</span>
                <br />
                <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-400 bg-clip-text text-transparent">
                  Creative Work
                </span>
              </h1>
            </Reveal>

            <Reveal delay={80}>
              <p className="mx-auto mt-6 max-w-3xl text-xl leading-relaxed text-gray-300">
                A trustless marketplace where creativity meets blockchain
                technology. Secure payments, verifiable reputation, and global
                opportunities—all on-chain.
              </p>
            </Reveal>

            <Reveal delay={140}>
              <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
                <Link
                  href="/browse"
                  aria-label="Start exploring gigs and listings"
                  className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-8 py-4 text-lg font-semibold text-white transition-all hover:scale-105 hover:shadow-lg hover:shadow-purple-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  <span>Start Exploring</span>
                  <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                </Link>

                <Link
                  href="/create"
                  aria-label="Create a new listing"
                  className="group inline-flex items-center gap-2 rounded-xl border border-gray-600/50 bg-gray-900/50 px-8 py-4 text-lg font-medium text-white backdrop-blur-sm transition-all hover:border-gray-500 hover:bg-gray-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  <FileText className="h-5 w-5" />
                  <span>Create Listing</span>
                </Link>
              </div>
            </Reveal>

            <div className="scroll-indicator" />
          </div>
        </div>
      </section>

      {/* Core Features */}
      <section className="relative px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <div className="text-center">
              <h2 className="text-3xl font-bold text-white sm:text-4xl">
                Built Different
              </h2>
              <div className="mx-auto mt-3 h-1 w-24 rounded-full bg-gradient-to-r from-purple-500 to-pink-500" />
              <p className="mt-4 text-xl text-gray-400">
                Three pillars that make creative work safer and more rewarding
              </p>
            </div>
          </Reveal>

          <div className="mt-16 grid gap-8 lg:grid-cols-3">
            {coreFeatures.map((feature, index) => {
              const Icon = feature.icon;
              const colorClasses = {
                emerald:
                  "from-emerald-500/20 to-emerald-600/10 border-emerald-500/20 text-emerald-400",
                purple:
                  "from-purple-500/20 to-purple-600/10 border-purple-500/20 text-purple-400",
                orange:
                  "from-orange-500/20 to-orange-600/10 border-orange-500/20 text-orange-400",
              };

              return (
                <Reveal key={index} delay={index * 80}>
                  <div className="group relative">
                    <div
                      className={`card-tilt rounded-2xl border bg-gradient-to-br p-8 backdrop-blur-sm hover:shadow-lg hover:shadow-black/10 ${
                        colorClasses[feature.color as keyof typeof colorClasses]
                      }`}
                    >
                      <div className="mb-6">
                        <div
                          className={`inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${
                            feature.color === "emerald"
                              ? "from-emerald-600 to-emerald-700"
                              : feature.color === "purple"
                              ? "from-purple-600 to-purple-700"
                              : "from-orange-600 to-orange-700"
                          }`}
                        >
                          <Icon className="icon-pop h-6 w-6 text-white" />
                        </div>
                      </div>
                      <h3 className="mb-3 text-xl font-semibold text-white">
                        {feature.title}
                      </h3>
                      <p className="text-gray-400">{feature.description}</p>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="relative px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <div className="text-center">
              <h2 className="text-3xl font-bold text-white sm:text-4xl">
                How It Works
              </h2>
              <div className="mx-auto mt-3 h-1 w-24 rounded-full bg-gradient-to-r from-purple-500 to-pink-500" />
              <p className="mt-4 text-xl text-gray-400">
                From connection to completion in five simple steps
              </p>
            </div>
          </Reveal>

          <div className="mt-16">
            <div className="mx-auto max-w-4xl">
              {workflowSteps.map((step, index) => {
                const Icon = step.icon;
                const isLast = index === workflowSteps.length - 1;

                return (
                  <Reveal key={index} delay={index * 80}>
                    <div className="relative">
                      <div className="card-tilt flex items-center gap-6 rounded-2xl border border-gray-800/50 bg-gray-900/30 p-6 backdrop-blur-sm transition-all hover:border-purple-500/30">
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-pink-600">
                          <Icon className="icon-pop h-8 w-8 text-white" />
                        </div>

                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-medium text-purple-400">
                              {step.step}
                            </span>
                            <h3 className="text-xl font-semibold text-white">
                              {step.title}
                            </h3>
                          </div>
                          <p className="mt-2 text-gray-400">
                            {step.description}
                          </p>
                        </div>
                      </div>

                      {!isLast && (
                        <div className="ml-8 h-6 w-px bg-gradient-to-b from-purple-500/50 to-transparent"></div>
                      )}
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="relative px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <div className="text-center">
              <h2 className="text-3xl font-bold text-white sm:text-4xl">
                Made For Everyone
              </h2>
              <div className="mx-auto mt-3 h-1 w-24 rounded-full bg-gradient-to-r from-purple-500 to-pink-500" />
              <p className="mt-4 text-xl text-gray-400">
                Whether you&apos;re hiring or getting hired, we&apos;ve got you
                covered
              </p>
            </div>
          </Reveal>

          <div className="mt-16 grid gap-8 lg:grid-cols-3">
            {useCases.map((useCase, index) => {
              const Icon = useCase.icon;

              return (
                <Reveal key={index} delay={index * 80}>
                  <div className="group relative">
                    <div className="card-tilt rounded-2xl border border-gray-800/50 bg-gray-900/30 p-8 backdrop-blur-sm transition-all hover:border-purple-500/30 hover:bg-gray-900/50">
                      <div className="mb-6">
                        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-pink-600">
                          <Icon className="icon-pop h-6 w-6 text-white" />
                        </div>
                      </div>

                      <h3 className="mb-3 text-xl font-semibold text-white">
                        {useCase.title}
                      </h3>
                      <p className="mb-6 text-gray-400">
                        {useCase.description}
                      </p>

                      <ul className="space-y-2">
                        {useCase.features.map((feature, featureIndex) => (
                          <li
                            key={featureIndex}
                            className="flex items-center gap-2 text-sm text-gray-300"
                          >
                            <div className="h-1.5 w-1.5 rounded-full bg-purple-400"></div>
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* Token Economics */}
      <section className="relative px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <div className="text-center">
              <h2 className="text-3xl font-bold text-white sm:text-4xl">
                Smart Economics
              </h2>
              <div className="mx-auto mt-3 h-1 w-24 rounded-full bg-gradient-to-r from-purple-500 to-pink-500" />
              <p className="mt-4 text-xl text-gray-400">
                Transparent fees with built-in deflationary mechanics
              </p>
            </div>
          </Reveal>

          <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-3 items-stretch">
            <Reveal>
              <div className="card-tilt h-full rounded-2xl border border-gray-800/50 bg-gray-900/30 p-8 backdrop-blur-sm">
                <div className="mb-6">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-600">
                    <Coins className="h-6 w-6 text-white" />
                  </div>
                </div>

                <h3 className="mb-4 text-xl font-semibold text-white">
                  Multi-Token Support
                </h3>
                <p className="mb-6 text-gray-400">
                  Accept payments in ETH, stablecoins, or our native DOP token.
                  Each payment type optimizes for different needs.
                </p>

                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-2 h-2 w-2 rounded-full bg-blue-400"></div>
                    <div>
                      <p className="font-medium text-white">
                        ETH & Stablecoins
                      </p>
                      <p className="text-sm text-gray-400">
                        20% fee with automatic DOP buyback & burn (ETH/USDC)
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-2 h-2 w-2 rounded-full bg-purple-400"></div>
                    <div>
                      <p className="font-medium text-white">DOP Token</p>
                      <p className="text-sm text-gray-400">
                        10% fee with direct burn (DOP)
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>

            <Reveal delay={100}>
              <div className="card-tilt h-full rounded-2xl border border-gray-800/50 bg-gray-900/30 p-8 backdrop-blur-sm">
                <div className="mb-6">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-600 to-red-600">
                    <Flame className="h-6 w-6 text-white" />
                  </div>
                </div>

                <h3 className="mb-4 text-xl font-semibold text-white">
                  Deflationary Model
                </h3>
                <p className="mb-6 text-gray-400">
                  Every transaction burns tokens, creating sustainable value
                  while funding platform development.
                </p>

                <div className="space-y-4">
                  <div className="rounded-lg border border-gray-700/50 bg-gray-800/50 p-4">
                    <p className="font-medium text-purple-200">
                      ETH/USDC Fee: 20%
                    </p>
                    <p className="text-sm text-gray-400">
                      50% bought back and burned, 50% to treasury
                    </p>
                  </div>
                  <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-4">
                    <p className="font-medium text-purple-200">DOP Fee: 10%</p>
                    <p className="text-sm text-gray-300">
                      50% burned directly, 50% to treasury
                    </p>
                  </div>
                </div>
              </div>
            </Reveal>

            {/* Boost Visibility */}
            <Reveal delay={200}>
              <div className="card-tilt h-full rounded-2xl border border-gray-800/50 bg-gray-900/30 p-8 backdrop-blur-sm flex flex-col">
                <div className="mb-6">
                  <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600">
                    <Zap className="h-6 w-6 text-white" />
                  </div>
                </div>

                <h3 className="mb-4 text-xl font-semibold text-white">
                  Boost Visibility
                </h3>
                <p className="mb-4 text-gray-400">
                  Use DOP to boost your listings and profile for 7 days. The
                  floor price adjusts dynamically with active boosts, and you
                  can top up during an active boost to extend time and outrank
                  others.
                </p>

                <div className="mb-6 flex flex-wrap gap-2">
                  <span className="rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1 text-xs text-fuchsia-200">
                    7d duration
                  </span>
                  <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs text-purple-200">
                    Dynamic pricing
                  </span>
                  <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-xs text-rose-200">
                    50% burn • 50% treasury
                  </span>
                </div>

                <div className="mt-auto">
                  <Link
                    href="/create"
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-700/60 bg-gray-800/40 px-4 py-2 text-sm font-medium text-white transition-all hover:border-purple-500/40 hover:bg-gray-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  >
                    <span>Boost a listing</span>
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="relative px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <div className="text-center">
              <h2 className="text-3xl font-bold text-white sm:text-4xl">
                Enterprise Security
              </h2>
              <div className="mx-auto mt-3 h-1 w-24 rounded-full bg-gradient-to-r from-purple-500 to-pink-500" />
              <p className="mt-4 text-xl text-gray-400">
                Bank-grade protection built into every transaction
              </p>
            </div>
          </Reveal>

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {securityFeatures.map((feature, index) => {
              const Icon = feature.icon;

              return (
                <Reveal key={index} delay={index * 80}>
                  <div className="group relative">
                    <div className="card-tilt rounded-2xl border border-gray-800/50 bg-gray-900/30 p-6 text-center backdrop-blur-sm transition-all hover:border-purple-500/30 hover:bg-gray-900/50">
                      <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-gray-600 to-gray-700">
                        <Icon className="icon-pop h-6 w-6 text-white" />
                      </div>
                      <h3 className="mb-2 text-lg font-semibold text-white">
                        {feature.title}
                      </h3>
                      <p className="text-sm text-gray-400">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative px-6 py-20">
        <div className="mx-auto max-w-4xl text-center">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl border border-purple-500/20 bg-gradient-to-r from-purple-500/10 to-pink-500/10 p-12 backdrop-blur-sm">
              <div className="absolute inset-0 bg-gradient-to-r from-purple-600/5 to-pink-600/5"></div>
              <div className="relative">
                <h2 className="text-3xl font-bold text-white sm:text-4xl">
                  Ready to Build the Future?
                </h2>
                <p className="mt-4 text-xl text-gray-300">
                  Join thousands of creators and businesses already using our
                  platform
                </p>

                <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                  <Link
                    href="/create"
                    aria-label="Create a listing and start a project"
                    className="inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 text-lg font-semibold text-black transition-all hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  >
                    <FileText className="h-5 w-5" />
                    <span>Create Listing</span>
                  </Link>

                  <Link
                    href="/browse"
                    aria-label="Explore the marketplace"
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-600/50 bg-gray-900/50 px-8 py-4 text-lg font-medium text-white backdrop-blur-sm transition-all hover:border-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  >
                    <span>Explore Marketplace</span>
                    <ArrowRight className="h-5 w-5" />
                  </Link>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-gray-800/50 px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <span className="text-gray-400">
              © {new Date().getFullYear()} DOP Marketplace. Building the future
              of work.
            </span>
            <div className="flex gap-8">
              <Link
                href="/terms"
                className="text-gray-400 transition-colors hover:text-white"
              >
                Terms
              </Link>
              <Link
                href="/privacy"
                className="text-gray-400 transition-colors hover:text-white"
              >
                Privacy
              </Link>
              <Link
                href="/docs"
                className="text-gray-400 transition-colors hover:text-white"
              >
                Docs
              </Link>
            </div>
          </div>
        </div>
      </footer>

      {/* Enhanced Styles */}
      <style jsx global>{`
        .metallic-silver {
          background: linear-gradient(
            135deg,
            #f8fafc 0%,
            #e2e8f0 25%,
            #ffffff 50%,
            #f1f5f9 75%,
            #e2e8f0 100%
          );
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          filter: drop-shadow(0 2px 4px rgba(255, 255, 255, 0.1));
        }

        .aurora {
          background: conic-gradient(
            from 0deg at 50% 50%,
            rgba(76, 29, 149, 0.06),
            rgba(124, 58, 237, 0.05),
            rgba(88, 28, 135, 0.05),
            rgba(76, 29, 149, 0.06)
          );
          mask-image: radial-gradient(
            80% 70% at 50% 30%,
            black,
            transparent 70%
          );
          animation: aurora-move 20s linear infinite;
        }

        @keyframes aurora-move {
          0% {
            transform: rotate(0deg) scale(1);
          }
          50% {
            transform: rotate(180deg) scale(1.1);
          }
          100% {
            transform: rotate(360deg) scale(1);
          }
        }

        /* Reveal on scroll */
        .reveal {
          opacity: 0;
          transform: translateY(12px) scale(0.99);
          transition: opacity 0.5s ease, transform 0.5s ease;
          will-change: opacity, transform;
        }
        .reveal.is-visible {
          opacity: 1;
          transform: translateY(0) scale(1);
        }

        /* Card lift + icon micro-interactions */
        .card-tilt {
          transition: transform 0.25s ease, box-shadow 0.25s ease,
            border-color 0.25s ease, background-color 0.25s ease;
        }
        .card-tilt:hover {
          transform: translateY(-4px);
        }
        .icon-pop {
          transition: transform 0.25s ease;
        }
        .group:hover .icon-pop {
          transform: scale(1.08) rotate(-1.5deg);
        }

        /* Floating color orbs for hero depth */
        .floating-orb {
          position: absolute;
          filter: blur(40px);
          opacity: 0.45;
          animation: float-slow 20s ease-in-out infinite;
        }
        @keyframes float-slow {
          0%,
          100% {
            transform: translateY(0) translateX(0) scale(1);
          }
          50% {
            transform: translateY(-20px) translateX(10px) scale(1.05);
          }
        }

        /* Scroll indicator */
        .scroll-indicator {
          width: 24px;
          height: 36px;
          border: 2px solid rgba(255, 255, 255, 0.25);
          border-radius: 16px;
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          bottom: -6px;
          display: flex;
          justify-content: center;
          padding-top: 6px;
        }
        .scroll-indicator::after {
          content: "";
          width: 4px;
          height: 8px;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.6);
          animation: scroll 1.8s ease-in-out infinite;
        }
        @keyframes scroll {
          0% {
            transform: translateY(0);
            opacity: 1;
          }
          60% {
            transform: translateY(12px);
            opacity: 0.2;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </main>
  );
}
