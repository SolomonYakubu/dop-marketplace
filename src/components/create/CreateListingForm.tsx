"use client";

import React, { useState, useRef, useCallback } from "react";
import { useAccount } from "wagmi";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { ListingType } from "@/types/marketplace";
import type { ListingMetadata } from "@/types/marketplace";
import { useSearchParams } from "next/navigation";
import { formatAddress } from "@/lib/utils";
import { useToastContext } from "@/components/providers";
import {
  Briefcase,
  Hammer,
  Tag as TagIcon,
  Image as ImageIcon,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

export function CreateListingForm({
  onCreated,
  defaultType,
  defaultTarget,
}: {
  onCreated?: (args: {
    id: string;
    type: "brief" | "gig";
    title?: string;
    metadataURI: string;
  }) => void;
  defaultType?: "brief" | "gig";
  defaultTarget?: string;
}) {
  const { contract } = useMarketplaceContract();
  const search = useSearchParams();
  const preType =
    defaultType || search?.get("type") || search?.get("prefill") || "";
  const target = defaultTarget || search?.get("to") || "";
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
  const dragRef = useRef<HTMLDivElement | null>(null);

  const TITLE_MAX = 100;
  const DESC_MAX = 1200;

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image")) {
      setCoverFile(f);
    }
  }, []);
  const prevent = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  async function uploadToIpfs(file: File): Promise<string> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/ipfs", { method: "POST", body: form });
    if (!res.ok) throw new Error("Failed to upload to IPFS");
    const json = await res.json();
    return json.Hash || json.cid || json.IpfsHash || "";
  }

  async function onSubmit() {
    if (submitting) return;
    if (!title.trim() || !description.trim()) return;
    try {
      setSubmitting(true);
      let imageUri = "";
      if (coverFile) {
        try {
          imageUri = await uploadToIpfs(coverFile);
        } catch (e) {
          console.error(e);
          toast.showError(
            "Upload",
            "Cover upload failed, continuing without it"
          );
        }
      }
      const meta: ListingMetadata = {
        title: title.trim(),
        description: description.trim(),
        image: imageUri,
      };
      const metaRes = await fetch("/api/ipfs", {
        method: "POST",
        body: (() => {
          const f = new FormData();
          f.append(
            "file",
            new Blob([JSON.stringify(meta)], { type: "application/json" })
          );
          return f;
        })(),
      });
      if (!metaRes.ok) throw new Error("Metadata upload failed");
      const metaJson = await metaRes.json();
      const metaHash = metaJson.Hash || metaJson.cid || metaJson.IpfsHash || "";
      if (!metaHash) throw new Error("Missing metadata hash");
      const listingType =
        type === "brief" ? ListingType.BRIEF : ListingType.GIG;
      const receipt = await contract?.createListing(
        listingType,
        BigInt(category),
        `ipfs://${metaHash}`
      );
      toast.showSuccess("Created", `${type} listing created`);
      console.log("Tx receipt", receipt);
      // notify caller with last id if possible
      try {
        const lastId = await contract!.getLastListingId({ force: true });
        onCreated?.({
          id: String(lastId),
          type,
          title: meta.title,
          metadataURI: `ipfs://${metaHash}`,
        });
      } catch {
        // non-fatal
      }
      setTitle("");
      setDescription("");
      setCoverFile(null);
    } catch (e) {
      console.error(e);
      toast.showContractError("Create failed", e, "Failed to create listing");
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = submitting || !title.trim() || !description.trim();

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-3">
          {type === "brief" ? (
            <Briefcase className="w-7 h-7 text-gray-300" />
          ) : (
            <Hammer className="w-7 h-7 text-gray-300" />
          )}
          <span>Create {type === "brief" ? "Brief" : "Gig"}</span>
        </h1>
        <p className="text-sm text-gray-500 max-w-prose">
          Provide a concise title and clear description. You can attach an
          optional cover image to make it stand out.
        </p>
      </header>

      {target && (
        <div className="rounded-lg border border-white/10 bg-gray-900/60 px-4 py-3 text-xs flex items-center gap-2">
          <TagIcon className="w-4 h-4 text-gray-400" />
          <span className="text-gray-400">Target provider:</span>
          <span className="text-gray-200 font-medium">
            {formatAddress(target)}
          </span>
        </div>
      )}

      <div className="inline-flex rounded-xl border border-white/10 bg-gray-900/60 p-1 text-sm font-medium">
        {(["brief", "gig"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`relative px-5 py-2 rounded-lg transition-colors flex items-center gap-2 ${
              type === t
                ? "bg-white text-black shadow"
                : "text-gray-300 hover:bg-white/5"
            }`}
          >
            {t === "brief" ? (
              <Briefcase className="w-4 h-4" />
            ) : (
              <Hammer className="w-4 h-4" />
            )}
            {t === "brief" ? "Brief" : "Gig"}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-8 items-start">
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/40 p-6 space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-400 flex items-center justify-between">
                Title
                <span className="text-[10px] font-normal text-gray-500">
                  {title.length}/{TITLE_MAX}
                </span>
              </label>
              <input
                value={title}
                maxLength={TITLE_MAX}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  type === "brief"
                    ? "e.g. Need audit for smart contract"
                    : "e.g. Solidity dev offering code review"
                }
                className="w-full rounded-lg border border-white/10 bg-gray-950/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/15"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-400 flex items-center justify-between">
                Description
                <span className="text-[10px] font-normal text-gray-500">
                  {description.length}/{DESC_MAX}
                </span>
              </label>
              <textarea
                value={description}
                maxLength={DESC_MAX}
                onChange={(e) => setDescription(e.target.value)}
                rows={7}
                placeholder="Describe the scope, expectations, and any important context."
                className="w-full rounded-lg border border-white/10 bg-gray-950/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/15 resize-none"
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-gray-950/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/15"
                >
                  <option value="0">Project Owner</option>
                  <option value="1">Developer</option>
                  <option value="2">Artist</option>
                  <option value="3">KOL</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-gray-400 flex items-center gap-1">
                  <ImageIcon className="w-4 h-4" /> Cover (optional)
                </label>
                <div
                  ref={dragRef}
                  onDragEnter={prevent}
                  onDragOver={prevent}
                  onDrop={onDrop}
                  className="relative group border border-dashed border-white/15 rounded-lg p-4 text-center text-xs text-gray-400 bg-gray-950/50 hover:border-white/30 transition"
                >
                  {coverFile ? (
                    <div className="space-y-2">
                      <p className="text-gray-300 truncate text-xs">
                        {coverFile.name}
                      </p>
                      <button
                        type="button"
                        onClick={() => setCoverFile(null)}
                        className="text-[10px] text-red-300 hover:text-red-200"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <>
                      <p>Drag & drop or click to upload</p>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) =>
                          setCoverFile(e.target.files?.[0] || null)
                        }
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="pt-2">
              <button
                type="button"
                disabled={disabled}
                onClick={onSubmit}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-white text-black px-5 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? "Creating…" : `Create ${type}`}
              </button>
              {!chain && (
                <p className="mt-2 text-[11px] text-amber-400 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Connect your wallet to create a listing.
                </p>
              )}
            </div>
          </div>
        </div>
        <aside className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/40 p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
              Live Preview
            </h3>
            <div className="rounded-lg border border-white/10 bg-gray-950/60 p-4 space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 rounded-full bg-gray-800/70 text-[11px] text-gray-300 flex items-center gap-1">
                  <TagIcon className="w-3.5 h-3.5" />
                  {
                    (
                      {
                        0: "Project Owner",
                        1: "Developer",
                        2: "Artist",
                        3: "KOL",
                      } as Record<string, string>
                    )[category]
                  }
                </span>
              </div>
              <p className="font-medium line-clamp-2 text-gray-100 min-h-[32px]">
                {title || "Listing title appears here"}
              </p>
              <p className="text-gray-400 line-clamp-4 text-xs min-h-[64px]">
                {description ||
                  "A short description preview will show here as you type."}
              </p>
              {coverFile && (
                <div className="relative h-32 w-full rounded-md overflow-hidden border border-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={URL.createObjectURL(coverFile)}
                    alt="preview"
                    className="object-cover w-full h-full"
                  />
                </div>
              )}
            </div>
            {(!title || !description) && (
              <p className="mt-3 text-[11px] text-gray-500 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-gray-600" />
                Fill required fields to enable create.
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
