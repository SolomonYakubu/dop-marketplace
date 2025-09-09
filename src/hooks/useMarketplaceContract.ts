"use client";

import { useAccount, useWalletClient } from "wagmi";
import { ethers } from "ethers";
import { useMemo } from "react";
import { getMarketplaceContract } from "@/lib/contract";
import { getRpcUrl } from "@/lib/utils";
export function useMarketplaceContract() {
  const { address, chain, connector } = useAccount();
  const { data: walletClient } = useWalletClient();

  let provider;
  // Prefer the connected wagmi walletClient (AGW, WalletConnect, etc.)
  if (walletClient) {
    const eip1193Provider: ethers.Eip1193Provider = {
      request: async (args) => {
        // Forward request to wagmi walletClient
        const result = await walletClient.request({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          method: args.method as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          params: args.params as any,
        });

        // Some Abstract Global Wallet flows may return a full tx object (already mined)
        // or tx objects without signature fields (r,s,v) for AA-style tx type 0x71.
        // Ethers v6 expects r,s,v (or signature) when formatting a TransactionResponse.
        if (
          args.method === "eth_getTransactionByHash" &&
          result &&
          typeof result === "object" &&
          (result as { type?: string }).type === "0x71" &&
          (result as { r?: string }).r == null
        ) {
          interface MutableTx {
            r?: string;
            s?: string;
            v?: string;
            [k: string]: unknown;
          }
          const m = result as MutableTx;
          m.r = "0x" + "0".repeat(64);
          m.s = "0x" + "0".repeat(64);
          m.v = "0x0"; // minimal v
        }

        // If eth_sendTransaction returns a full object instead of a hash, reduce to hash
        if (
          args.method === "eth_sendTransaction" &&
          result &&
          typeof result === "object" &&
          (result as { hash?: string }).hash
        ) {
          return (result as { hash: string }).hash;
        }

        return result;
      },
    };
    provider = new ethers.BrowserProvider(
      eip1193Provider,
      walletClient.chain?.id
    );
  } else if (
    // Only use injected provider if the user explicitly chose an injected connector
    connector?.id === "injected" &&
    typeof window !== "undefined" &&
    (window as unknown as { ethereum: unknown }).ethereum
  ) {
    provider = new ethers.BrowserProvider(
      (window as unknown as { ethereum: ethers.Eip1193Provider }).ethereum,
      chain?.id
    );
  } else {
    // Public RPC fallback (read-only)
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
