"use client";

import { getDefaultConfig, getDefaultWallets } from "@rainbow-me/rainbowkit";
import { abstractWallet } from "@abstract-foundation/agw-react/connectors";
import { defineChain } from "viem";
import { http } from "wagmi";
// Abstract chains
const ABSTRACT_MAINNET_RPC_URL = process.env.NEXT_PUBLIC_RPC_URL_ABSTRACT;
if (!ABSTRACT_MAINNET_RPC_URL) {
  throw new Error("NEXT_PUBLIC_RPC_URL_ABSTRACT env var is required");
}
export const abstract = defineChain({
  id: 2741,
  name: "Abstract",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [ABSTRACT_MAINNET_RPC_URL] },
    public: { http: [ABSTRACT_MAINNET_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Abscan", url: "https://abscan.org" },
  },
});

const ABSTRACT_TESTNET_RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL_ABSTRACT_TESTNET;
if (!ABSTRACT_TESTNET_RPC_URL) {
  throw new Error("NEXT_PUBLIC_RPC_URL_ABSTRACT_TESTNET env var is required");
}

export const abstractSepolia = defineChain({
  id: 11124,
  name: "Abstract Sepolia Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [ABSTRACT_TESTNET_RPC_URL] },
    public: { http: [ABSTRACT_TESTNET_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Abscan", url: "https://sepolia.abscan.org" },
  },
});

// Compose wallet list: take RainbowKit defaults & add Abstract Global Wallet group
const { wallets: defaultWallets } = getDefaultWallets();
const wallets = [
  {
    groupName: "Abstract",
    wallets: [abstractWallet], // note: pass wallet factory, not invoked
  },
  ...defaultWallets,
];

// RainbowKit + Wagmi configuration including Abstract Global Wallet
export const config = getDefaultConfig({
  appName: "Death of Pengu Marketplace",
  projectId:
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "YOUR_PROJECT_ID",
  chains: [abstractSepolia],
  transports: {
    [abstractSepolia.id]: http(),
    [abstract.id]: http(),
  },
  wallets,
  // ssr: true
});

export const SUPPORTED_CHAINS = {
  ABSTRACT_MAINNET: abstract.id,
  ABSTRACT_TESTNET: abstractSepolia.id,
} as const;
