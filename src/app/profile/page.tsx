"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { formatAddress, toGatewayUrl } from "@/lib/utils";
import { ethers } from "ethers";
import { getMarketplaceContract } from "@/lib/contract";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { useToastContext } from "@/components/providers";

export default function ProfilePage() {
  const { contract } = useMarketplaceContract();
  const { address, chain } = useAccount();
  const toast = useToastContext();
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState("");
  const [portfolioUri, setPortfolioUri] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function uploadToIpfs() {
    try {
      setUploading(true);
      const payload = {
        bio,
        skills: skills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        createdAt: Date.now(),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const file = new File([blob], "profile.json", {
        type: "application/json",
      });
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/ipfs", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      setPortfolioUri(`ipfs://${data.cid}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      toast.showError("Upload Failed", msg);
    } finally {
      setUploading(false);
    }
  }

  async function saveOnChain() {
    if (!chain) {
      toast.showError("Connect Wallet", "Connect your wallet");
      return;
    }
    try {
      setSaving(true);

      const skillsArr = skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const existing = address ? await contract!.getProfile(address) : null;
      if (existing && existing.joinedAt && existing.joinedAt !== BigInt(0)) {
        await contract!.updateProfile(
          bio,
          skillsArr,
          portfolioUri ? portfolioUri : ""
        );
      } else {
        await contract!.createProfile(
          bio,
          skillsArr,
          portfolioUri ? portfolioUri : "",
          1
        );
      }
      toast.showSuccess("Success", "Profile saved");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save profile";
      toast.showError("Error", msg);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    async function load() {
      if (!chain || !address) return;
      try {
        const provider = new ethers.BrowserProvider(
          (window as unknown as { ethereum: ethers.Eip1193Provider }).ethereum
        );
        const contract = getMarketplaceContract(chain.id, provider);
        const p = await contract.getProfile(address);
        if (p && p.joinedAt && p.joinedAt !== BigInt(0)) {
          setBio(p.bio || "");
          setSkills((p.skills || []).join(", "));
          setPortfolioUri(p.portfolioURIs?.[0] || "");
        }
      } catch {}
    }
    load();
  }, [chain, address]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <header className="container-panel p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Your profile</h1>
            <p className="text-sm text-gray-400">
              {address ? formatAddress(address) : "Not connected"}
            </p>
          </div>
          <div className="text-sm text-gray-400">Badges: Rookie</div>
        </div>
      </header>

      <section className="container-panel p-6 space-y-4">
        <div>
          <label className="block text-sm text-gray-300">Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-lg border border-gray-800 bg-black px-3 py-2 outline-none focus:border-gray-600"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-300">
            Skills (comma separated)
          </label>
          <input
            value={skills}
            onChange={(e) => setSkills(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-800 bg-black px-3 py-2 outline-none focus:border-gray-600"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-300">
            Portfolio (IPFS URI)
          </label>
          <input
            value={portfolioUri}
            onChange={(e) => setPortfolioUri(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-800 bg-black px-3 py-2 outline-none focus:border-gray-600"
          />
          {portfolioUri && (
            <p className="mt-2 text-xs text-gray-500 break-all">
              {toGatewayUrl(portfolioUri)}
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <button
            disabled={saving}
            onClick={saveOnChain}
            className="rounded-lg bg-white text-black px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={uploading}
            onClick={uploadToIpfs}
            className="rounded-lg border border-gray-800 px-4 py-2 text-sm hover:bg-gray-900 disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "Upload to IPFS"}
          </button>
        </div>
      </section>

      <section className="container-panel p-6">
        <h2 className="font-medium">Mission history</h2>
        <p className="mt-2 text-sm text-gray-400">No missions yet.</p>
      </section>
    </div>
  );
}
