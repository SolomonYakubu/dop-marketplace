"use client";

import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { useMemo } from "react";
import { MarketplaceContract, getMarketplaceContract } from "@/lib/contract";

export function useMarketplaceContract() {
  const { address, chain } = useAccount();

  const contract = useMemo(() => {
    if (!chain) return null;

    try {
      // Create a provider from the current connection
      const provider = new ethers.BrowserProvider(window.ethereum!);
      const marketplaceContract = getMarketplaceContract(chain.id, provider);

      // If we have a connected address, connect a signer (mutates instance)
      if (address) {
        provider.getSigner().then((signer) => {
          marketplaceContract.connect(signer);
        });
      }

      return marketplaceContract;
    } catch (error) {
      console.error("Error creating contract:", error);
      return null;
    }
  }, [chain, address]);

  return {
    contract,
    address,
    chainId: chain?.id,
    isConnected: !!address,
  };
}
