"use client";

import { getDefaultConfig, getDefaultWallets } from "@rainbow-me/rainbowkit";
import { abstractWallet } from "@abstract-foundation/agw-react/connectors";
import { defineChain } from "viem";
import { http } from "wagmi";
// Abstract chains
export const abstract = defineChain({
  id: 2741,
  name: "Abstract",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://api.mainnet.abs.xyz"] },
    public: { http: ["https://api.mainnet.abs.xyz"] },
  },
  blockExplorers: {
    default: { name: "Abscan", url: "https://abscan.org" },
  },
});

export const abstractSepolia = defineChain({
  id: 11124,
  name: "Abstract Sepolia Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://api.testnet.abs.xyz"] },
    public: { http: ["https://api.testnet.abs.xyz"] },
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
