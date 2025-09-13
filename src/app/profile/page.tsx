"use client";

import { useEffect, useState, useMemo, ChangeEvent } from "react";
import { useAccount } from "wagmi";
import { formatAddress, toGatewayUrl } from "@/lib/utils";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import { useToastContext } from "@/components/providers";
import { UserType } from "@/types/marketplace";
import {
  UserCircle2,
  BadgeCheck,
  Loader2,
  Link as LinkIcon,
} from "lucide-react";
import Image from "next/image";

interface LoadedProfile {
  bio?: string;
  skills?: string[];
  portfolioURIs?: string[];
  joinedAt?: bigint;
  profilePicCID?: string;
  username?: string;
  userType?: number;
}

export default function ProfilePage() {
  const { address, chain } = useAccount();
  const { contract } = useMarketplaceContract();
  const toast = useToastContext();

  // Form state
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState("");
  const [portfolioUri, setPortfolioUri] = useState("");
  const [userType, setUserType] = useState<UserType>(UserType.DEVELOPER);
  const [username, setUsername] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Existing profile snapshot
  const [profile, setProfile] = useState<LoadedProfile | null>(null);
  const [saving, setSaving] = useState(false);

  function onAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  async function uploadAvatarIfNeeded(): Promise<string | undefined> {
    if (!avatarFile) return profile?.profilePicCID; // keep existing
    setUploadingAvatar(true);
    try {
      const form = new FormData();
      form.append("file", avatarFile);
      form.append("type", "avatar");
      const res = await fetch("/api/ipfs", { method: "POST", body: form });
      if (!res.ok) throw new Error("Avatar upload failed");
      const json = await res.json();
      const cid = json.cid || json.CID || json.Hash;
      if (!cid) throw new Error("CID missing from upload response");
      return `ipfs://${cid}`;
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function saveOnChain() {
    if (!chain || !address || !contract) {
      toast.showError("Connect Wallet", "Connect your wallet");
      return;
    }
    try {
      setSaving(true);
      const skillsArr = skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const avatarCid = await uploadAvatarIfNeeded();

      if (profile && profile.joinedAt && profile.joinedAt !== BigInt(0)) {
        // update flow
        await contract.updateProfile(
          bio,
          skillsArr,
          portfolioUri || "",
          avatarCid || ""
        );
        if (username && username !== (profile.username || "")) {
          try {
            type Underlying = { setUsername?: (u: string) => Promise<unknown> };
            const underlying: Underlying | undefined = (
              contract as unknown as { contract?: Underlying }
            ).contract;
            if (underlying?.setUsername) await underlying.setUsername(username);
          } catch (err) {
            console.warn("Username update failed", err);
          }
        }
        toast.showSuccess("Updated", "Profile updated");
      } else {
        if (!username.trim())
          throw new Error("Username required for new profile");
        await contract.createProfile(
          bio,
          skillsArr,
          portfolioUri || "",
          userType,
          username,
          avatarCid || ""
        );
        toast.showSuccess("Created", "Profile created");
      }

      // reload profile
      const fresh = (await contract.getProfile(
        address
      )) as unknown as LoadedProfile;
      if (fresh && fresh.joinedAt && fresh.joinedAt !== BigInt(0)) {
        setProfile(fresh);
      }
    } catch (e) {
      toast.showContractError("Error", e, "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    async function load() {
      if (!chain || !address || !contract) return;
      try {
        const p = (await contract.getProfile(
          address
        )) as unknown as LoadedProfile;
        if (p && p.joinedAt && p.joinedAt !== BigInt(0)) {
          setProfile(p);
          setBio(p.bio || "");
          setSkills((p.skills || []).join(", "));
          setPortfolioUri(p.portfolioURIs?.[0] || "");
          if (p.userType !== undefined) setUserType(Number(p.userType));
          if (p.username) setUsername(p.username);
          if (p.profilePicCID) {
            const gw = toGatewayUrl(p.profilePicCID) || p.profilePicCID;
            setAvatarPreview(gw);
          }
        }
      } catch (err) {
        console.warn("Failed to load profile", err);
      }
    }
    load();
  }, [chain, address, contract]);

  const skillCount = useMemo(
    () => skills.split(",").filter((s) => s.trim()).length,
    [skills]
  );
  const bioRemaining = 600 - bio.length;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-3">
          <UserCircle2 className="w-8 h-8 text-gray-400" />
          <span>Your Profile</span>
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <span className="px-2 py-0.5 rounded-full bg-gray-800/70 text-gray-300">
            {address ? formatAddress(address) : "Not connected"}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-gray-800/70 text-gray-300 flex items-center gap-1">
            <BadgeCheck className="w-3.5 h-3.5" />
            Rookie
          </span>
          <span className="px-2 py-0.5 rounded-full bg-gray-800/70 text-gray-300">
            {skillCount} skills
          </span>
        </div>
      </header>

      <div className="grid lg:grid-cols-3 gap-8 items-start">
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/40 p-6 space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-400">
                User Type
              </label>
              <select
                value={userType}
                onChange={(e) =>
                  setUserType(Number(e.target.value) as UserType)
                }
                disabled={
                  !!(
                    profile &&
                    profile.joinedAt &&
                    profile.joinedAt !== BigInt(0)
                  )
                }
                className="w-full rounded-lg border border-white/10 bg-gray-950/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/15 disabled:opacity-50"
              >
                <option value={UserType.DEVELOPER}>Developer</option>
                <option value={UserType.ARTIST}>Artist</option>
                <option value={UserType.KOL}>KOL</option>
                <option value={UserType.PROJECT_OWNER}>Project Owner</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-400 flex items-center justify-between">
                Username{" "}
                <span className="text-[10px] text-gray-500">
                  {username.length}/32
                </span>
              </label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="unique handle (3-32 chars)"
                maxLength={32}
                className="w-full rounded-lg border border-white/10 bg-gray-950/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/15"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-400 flex items-center justify-between">
                Bio{" "}
                <span className="text-[10px] text-gray-500">
                  {bioRemaining}
                </span>
              </label>
              <textarea
                value={bio}
                maxLength={600}
                onChange={(e) => setBio(e.target.value)}
                rows={5}
                placeholder="Tell people what you do, experience, interests…"
                className="w-full rounded-lg border border-white/10 bg-gray-950/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/15 resize-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Skills (comma separated)
              </label>
              <input
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                placeholder="React, TypeScript, Solidity, Web3…"
                className="w-full rounded-lg border border-white/10 bg-gray-950/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/15"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Portfolio (IPFS / URL)
              </label>
              <input
                value={portfolioUri}
                onChange={(e) => setPortfolioUri(e.target.value)}
                placeholder="ipfs:// or https:// link"
                className="w-full rounded-lg border border-white/10 bg-gray-950/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/15"
              />
              {portfolioUri && (
                <p className="text-[11px] text-gray-500 break-all">
                  {toGatewayUrl(portfolioUri)}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-400 flex items-center justify-between">
                Avatar
                {uploadingAvatar && (
                  <span className="text-[10px] text-gray-500 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> uploading
                  </span>
                )}
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={onAvatarChange}
                className="w-full text-[11px] file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-[11px] file:font-semibold file:bg-white file:text-black hover:file:opacity-90"
              />
              {avatarPreview && (
                <div className="relative h-20 w-20 rounded-lg overflow-hidden border border-white/10">
                  <Image
                    src={avatarPreview}
                    alt="avatar preview"
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                </div>
              )}
              <p className="text-[10px] text-gray-500">
                PNG/JPG, &lt;2MB recommended.
              </p>
            </div>
            <div>
              <button
                disabled={
                  saving ||
                  uploadingAvatar ||
                  !bio.trim() ||
                  (!profile && !username.trim())
                }
                onClick={saveOnChain}
                className="inline-flex items-center gap-2 rounded-lg bg-white text-black px-5 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40"
              >
                {(saving || uploadingAvatar) && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                {profile && profile.joinedAt && profile.joinedAt !== BigInt(0)
                  ? saving
                    ? "Updating…"
                    : "Update Profile"
                  : saving
                  ? "Creating…"
                  : "Create Profile"}
              </button>
            </div>
          </div>
        </div>
        <aside className="space-y-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            Preview
          </h3>
          <div className="rounded-lg border border-white/10 bg-gray-950/60 p-4 space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {avatarPreview && (
                <div className="relative h-10 w-10 rounded-full overflow-hidden border border-white/10">
                  <Image
                    src={avatarPreview}
                    alt="avatar"
                    fill
                    sizes="40px"
                    className="object-cover"
                  />
                </div>
              )}
              <span className="px-2 py-0.5 rounded-full bg-gray-800/70 text-[11px] text-gray-300 flex items-center gap-1">
                <UserCircle2 className="w-3.5 h-3.5" />
                {username || "Profile"}
              </span>
              {userType === UserType.DEVELOPER && (
                <span className="px-2 py-0.5 rounded-full bg-gray-800/70 text-[11px] text-indigo-300">
                  Dev
                </span>
              )}
              {userType === UserType.ARTIST && (
                <span className="px-2 py-0.5 rounded-full bg-gray-800/70 text-[11px] text-pink-300">
                  Artist
                </span>
              )}
              {userType === UserType.KOL && (
                <span className="px-2 py-0.5 rounded-full bg-gray-800/70 text-[11px] text-emerald-300">
                  KOL
                </span>
              )}
              {userType === UserType.PROJECT_OWNER && (
                <span className="px-2 py-0.5 rounded-full bg-gray-800/70 text-[11px] text-rose-300">
                  Owner
                </span>
              )}
            </div>
            <p className="text-gray-300 line-clamp-5 min-h-[80px] text-xs whitespace-pre-wrap">
              {bio || "Your bio preview will appear here."}
            </p>
            {skillCount > 0 && (
              <div className="flex flex-wrap gap-1">
                {skills
                  .split(",")
                  .filter((s) => s.trim())
                  .slice(0, 6)
                  .map((s, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded-full bg-gray-800/60 text-[10px] text-gray-300"
                    >
                      {s.trim()}
                    </span>
                  ))}
                {skillCount > 6 && (
                  <span className="text-[10px] text-gray-400">
                    +{skillCount - 6}
                  </span>
                )}
              </div>
            )}
            {portfolioUri && (
              <div className="text-[10px] text-gray-500 truncate flex items-center gap-1">
                <LinkIcon className="w-3 h-3" /> {toGatewayUrl(portfolioUri)}
              </div>
            )}
          </div>
          <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/40 p-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">
              Mission History
            </h3>
            <p className="text-xs text-gray-500">No missions yet.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
