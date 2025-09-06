"use client";

import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { useMemo } from "react";
import { getMarketplaceContract } from "@/lib/contract";
import { getRpcUrl } from "@/lib/utils";
export function useMarketplaceContract() {
  const { address, chain } = useAccount();

  const contract = useMemo(() => {
    const chainId =
      chain?.id ?? (Number(process.env.NEXT_PUBLIC_CHAIN_ID) || 11124);

    const provider = new ethers.JsonRpcProvider(getRpcUrl(chainId));

    try {
      const marketplaceContract = getMarketplaceContract(
        chain?.id || 11124,
        provider
      );

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
