"use client";

import { useAccount } from "wagmi";
import { ethers } from "ethers";
import { useMemo } from "react";
import { getMarketplaceContract } from "@/lib/contract";
import { getRpcUrl } from "@/lib/utils";
export function useMarketplaceContract() {
  const { address, chain } = useAccount();
  let provider;
  if (
    typeof window !== "undefined" &&
    (window as unknown as { ethereum: unknown }).ethereum
  ) {
    provider = new ethers.BrowserProvider(
      (window as unknown as { ethereum: ethers.Eip1193Provider }).ethereum
    );
  } else {
    provider = new ethers.JsonRpcProvider(
      getRpcUrl(Number(process.env.NEXT_PUBLIC_CHAIN_ID) || 11124)
    );
  }
  const marketplaceContract = getMarketplaceContract(
    chain?.id || 11124,
    provider
  );
  const contract = useMemo(() => {
    try {
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
  }, [address, marketplaceContract, provider]);

  return {
    contract,
    address,
    chainId: chain?.id,
    isConnected: !!address,
  };
}
