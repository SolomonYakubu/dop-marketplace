"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { formatAddress, toGatewayUrl } from "@/lib/utils";
// Removed direct ethers/getMarketplaceContract usage in favor of hook contract
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { useToastContext } from "@/components/providers";

export default function ProfilePage() {
  const { contract } = useMarketplaceContract();
  const { address, chain } = useAccount();
  const toast = useToastContext();
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState("");
  const [portfolioUri, setPortfolioUri] = useState("");

  const [saving, setSaving] = useState(false);

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
      if (!chain || !address || !contract) return;
      try {
        const p = await contract.getProfile(address);
        if (p && p.joinedAt && p.joinedAt !== BigInt(0)) {
          setBio(p.bio || "");
          setSkills((p.skills || []).join(", "));
          setPortfolioUri(p.portfolioURIs?.[0] || "");
        }
      } catch {
        // silent
      }
    }
    load();
  }, [chain, address, contract]);

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
        </div>
      </section>

      <section className="container-panel p-6">
        <h2 className="font-medium">Mission history</h2>
        <p className="mt-2 text-sm text-gray-400">No missions yet.</p>
      </section>
    </div>
  );
}
