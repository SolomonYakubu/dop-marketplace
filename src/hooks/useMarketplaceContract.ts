"use client";

import { useAccount, useWalletClient } from "wagmi";
import { ethers } from "ethers";
import { useMemo } from "react";
import { getMarketplaceContract } from "@/lib/contract";
import { getRpcUrl } from "@/lib/utils";
export function useMarketplaceContract() {
  const { address, chain } = useAccount();
  const { data: walletClient } = useWalletClient();

  let provider;
  if (
    typeof window !== "undefined" &&
    (window as unknown as { ethereum: unknown }).ethereum
  ) {
    provider = new ethers.BrowserProvider(
      (window as unknown as { ethereum: ethers.Eip1193Provider }).ethereum
    );
  } else if (walletClient) {
    const eip1193Provider: ethers.Eip1193Provider = {
      request: (args) =>
        // Cast to any because walletClient.request expects a narrowed union of method strings
        walletClient.request({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          method: args.method as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          params: args.params as any,
        }),
    };
    provider = new ethers.BrowserProvider(
      eip1193Provider,
      walletClient.chain?.id
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
