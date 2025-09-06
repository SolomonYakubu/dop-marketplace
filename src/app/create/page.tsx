"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { ethers } from "ethers";

import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { ListingType } from "@/types/marketplace";
import type { ListingMetadata } from "@/types/marketplace";
import { useSearchParams } from "next/navigation";
import { formatAddress } from "@/lib/utils";
import { useToastContext } from "@/components/providers";

export default function CreatePage() {
  const { contract } = useMarketplaceContract();
  const search = useSearchParams();
  const preType = search?.get("type") || search?.get("prefill") || "";
  const target = search?.get("to") || "";
  const toast = useToastContext();

  const [type, setType] = useState<"brief" | "gig">(
    preType === "gig" ? "gig" : "brief"
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("0");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { chain } = useAccount();

  async function uploadToIpfs(file: File): Promise<string> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/ipfs", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "IPFS upload failed");
    return `ipfs://${data.cid}`;
  }

  async function onSubmit() {
    if (!chain) {
      toast.showError("Connect Wallet", "Connect your wallet");
      return;
    }
    if (!title.trim() || !description.trim()) {
      toast.showError("Missing Fields", "Title and description required");
      return;
    }

    try {
      setSubmitting(true);
      // 1) Upload cover (optional)
      let imageUri: string | undefined;
      if (coverFile) {
        imageUri = await uploadToIpfs(coverFile);
      }
      // 2) Build and upload metadata JSON (typed)
      const base: ListingMetadata = {
        title,
        description,
        image: imageUri,
        category: Number(category),
        type: type === "brief" ? ListingType.BRIEF : ListingType.GIG,
      };
      const metadata: ListingMetadata & {
        version: number;
        targetUser?: string;
      } = {
        ...base,
        version: 1,
        ...(target ? { targetUser: target } : {}),
      };
      const metaBlob = new Blob([JSON.stringify(metadata, null, 2)], {
        type: "application/json",
      });
      const metaFile = new File([metaBlob], "metadata.json", {
        type: "application/json",
      });
      const metadataUri = await uploadToIpfs(metaFile);

      // 3) Create listing on-chain
      const eth = (window as unknown as { ethereum?: ethers.Eip1193Provider })
        .ethereum;
      if (!eth) throw new Error("Wallet provider not found");

      const listingType = type === "brief" ? 0 : 1; // BRIEF/GIG
      await contract!.createListing(listingType, BigInt(category), metadataUri);

      toast.showSuccess("Success", "Listing created");
      setTitle("");
      setDescription("");
      setCoverFile(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to create listing";
      toast.showError("Error", msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-2">Create a {type}</h1>
      {target && (
        <div className="mb-4 text-xs text-gray-400 border border-gray-800 rounded p-2">
          Target provider:{" "}
          <span className="text-gray-200">{formatAddress(target)}</span>
        </div>
      )}

      <div className="mb-6 inline-flex rounded-lg border border-gray-800 p-1">
        {(["brief", "gig"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`px-4 py-2 text-sm rounded-md transition-colors ${
              type === t
                ? "bg-white text-black"
                : "text-gray-300 hover:bg-gray-900"
            }`}
          >
            {t === "brief" ? "Brief (hire)" : "Gig (offer)"}
          </button>
        ))}
      </div>

      <div className="container-panel p-6 space-y-4">
        <div>
          <label className="block text-sm text-gray-300">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-800 bg-black px-3 py-2 outline-none focus:border-gray-600"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-300">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            className="mt-1 w-full rounded-lg border border-gray-800 bg-black px-3 py-2 outline-none focus:border-gray-600"
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-300">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-800 bg-black px-3 py-2 outline-none focus:border-gray-600"
            >
              <option value="0">Project Owner</option>
              <option value="1">Developer</option>
              <option value="2">Artist</option>
              <option value="3">KOL</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-300">
              Cover image (optional)
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setCoverFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-sm text-gray-400 file:mr-4 file:rounded-md file:border-0 file:bg-gray-800 file:px-3 file:py-2 file:text-gray-200 hover:file:bg-gray-700"
            />
          </div>
        </div>
        <button
          type="button"
          disabled={submitting}
          onClick={onSubmit}
          className="w-full rounded-lg bg-white text-black px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create listing"}
        </button>
      </div>
    </div>
  );
}
