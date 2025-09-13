"use client";

import { useEffect, useState, useCallback, useMemo, ChangeEvent } from "react";
import Image from "next/image";
import { useAccount } from "wagmi";
import { formatAddress, formatTokenAmountWithSymbol } from "@/lib/utils";

import { getTokenAddresses } from "@/lib/contract";
import { toGatewayUrl } from "@/lib/utils";
import { useMarketplaceContract } from "@/hooks/useMarketplaceContract";
import {
  UserType,
  Badge,
  Mission,
  OnchainUserProfile,
} from "@/types/marketplace";
import { useToastContext } from "@/components/providers";
import {
  UserCircle2,
  BadgeCheck,
  Loader2,
  Award,
  Target,
  History,
  Link as LinkIcon,
} from "lucide-react";

export default function ComprehensiveProfilePage() {
  const { address, chain } = useAccount();
  const { contract } = useMarketplaceContract();
  const toast = useToastContext();
  const [profile, setProfile] = useState<OnchainUserProfile | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);

  // Form states
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState("");
  const [portfolioUri, setPortfolioUri] = useState("");
  const [userType, setUserType] = useState<UserType>(UserType.DEVELOPER);
  const [username, setUsername] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [saving, setSaving] = useState(false);

  const tokens = getTokenAddresses(chain?.id ?? 11124);

  const loadProfileData = useCallback(async () => {
    if (!chain || !address) return;

    try {
      setLoading(true);

      // Load profile
      const profileData = (await contract!.getProfile(
        address
      )) as OnchainUserProfile;
      if (profileData && profileData.joinedAt !== BigInt(0)) {
        setProfile(profileData);
        setBio(profileData.bio || "");
        setSkills((profileData.skills || []).join(", "));
        setPortfolioUri(profileData.portfolioURIs?.[0] || "");
        setUserType(profileData.userType);
        setUsername(profileData.username || "");
        if (profileData.profilePicCID) {
          const gw =
            toGatewayUrl(profileData.profilePicCID) ||
            profileData.profilePicCID;
          setAvatarPreview(gw);
        }
      }

      // Load mission history
      const missionHistory = await contract!.getMissionHistory(address);
      setMissions(missionHistory);

      // Load badges
      const userBadges = await contract!.getUserBadges(address);
      setBadges(userBadges);
    } catch (error) {
      console.error("Failed to load profile data:", error);
    } finally {
      setLoading(false);
    }
  }, [chain, address, contract]);

  async function handleAvatarUploadIfNeeded(): Promise<string | undefined> {
    if (!avatarFile) return profile?.profilePicCID; // nothing new selected
    try {
      setUploadingAvatar(true);
      const form = new FormData();
      form.append("file", avatarFile);
      // Optional: add a directory or tag
      form.append("type", "avatar");
      const res = await fetch("/api/ipfs", { method: "POST", body: form });
      if (!res.ok) throw new Error("Upload failed");
      const json = await res.json();
      const cid = json.cid || json.Hash || json.CID;
      if (!cid) throw new Error("CID missing in response");
      return `ipfs://${cid}`;
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function saveProfile() {
    if (!chain || !address) {
      toast.showError("Connect Wallet", "Connect your wallet");
      return;
    }
    try {
      setSaving(true);

      const skillsArr = skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      // Upload avatar first (if chosen)
      const avatarCid = await handleAvatarUploadIfNeeded();
      if (profile && profile.joinedAt !== BigInt(0)) {
        await contract!.updateProfile(
          bio,
          skillsArr,
          portfolioUri ? portfolioUri : "",
          avatarCid
        );
        // Username can be updated separately only if changed and non-empty
        if (username && username !== (profile.username || "")) {
          try {
            // access underlying ethers contract interface safely
            type UsernameCapable = {
              setUsername?: (u: string) => Promise<unknown>;
            };
            const underlying: UsernameCapable | undefined = (
              contract as unknown as { contract?: UsernameCapable }
            ).contract;
            if (underlying?.setUsername) await underlying.setUsername(username);
          } catch (err) {
            console.warn("Username update failed", err);
          }
        }
      } else {
        if (!username.trim())
          throw new Error("Username required for new profile");
        await contract!.createProfile(
          bio,
          skillsArr,
          portfolioUri ? portfolioUri : "",
          userType,
          username,
          avatarCid || ""
        );
      }

      toast.showSuccess("Success", "Profile saved successfully!");
      await loadProfileData();
    } catch (e: unknown) {
      console.error("Profile save error:", e);
      toast.showContractError("Error", e, "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadProfileData();
  }, [loadProfileData]);

  const skillCount = useMemo(
    () => skills.split(",").filter((s) => s.trim()).length,
    [skills]
  );
  const bioRemaining = 600 - bio.length;

  function onAvatarChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    const url = URL.createObjectURL(file);
    setAvatarPreview(url);
  }
  const disputes = useMemo(
    () => missions.filter((m) => m.wasDisputed).length,
    [missions]
  );
  const successRate = useMemo(
    () =>
      missions.length
        ? Math.round(((missions.length - disputes) / missions.length) * 100)
        : 0,
    [missions, disputes]
  );

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-8">
        <div className="space-y-6 animate-pulse">
          <div className="h-8 bg-gray-800/60 rounded w-1/3" />
          <div className="h-72 bg-gray-800/40 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-10">
      {/* Header */}
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-3">
          <UserCircle2 className="w-9 h-9 text-gray-400" />
          <span>Comprehensive Profile</span>
        </h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          {address && (
            <span className="px-2 py-0.5 rounded-full bg-gray-800/70 text-gray-300">
              {formatAddress(address)}
            </span>
          )}
          {profile?.isVerified && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-300 flex items-center gap-1">
              <BadgeCheck className="w-3.5 h-3.5" /> Verified
            </span>
          )}
          <span className="px-2 py-0.5 rounded-full bg-gray-800/70 text-gray-300">
            {skillCount} skills
          </span>
          {profile?.joinedAt && profile.joinedAt !== BigInt(0) && (
            <span className="px-2 py-0.5 rounded-full bg-gray-800/70 text-gray-300">
              Joined{" "}
              {new Date(Number(profile.joinedAt) * 1000).toLocaleDateString()}
            </span>
          )}
        </div>
      </header>

      <div className="grid lg:grid-cols-3 gap-8 items-start">
        {/* Left: Form */}
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
                  profile?.joinedAt !== undefined &&
                  profile.joinedAt !== BigInt(0)
                }
                className="w-full rounded-lg border border-white/10 bg-gray-950/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/15 disabled:opacity-50"
              >
                <option value={UserType.PROJECT_OWNER}>Project Owner</option>
                <option value={UserType.DEVELOPER}>Developer</option>
                <option value={UserType.ARTIST}>Artist</option>
                <option value={UserType.KOL}>KOL</option>
              </select>
              {profile?.joinedAt !== undefined &&
                profile.joinedAt !== BigInt(0) && (
                  <p className="text-[11px] text-gray-500">
                    User type is permanent after creation.
                  </p>
                )}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-400 flex items-center justify-between">
                Username{" "}
                {profile?.joinedAt && profile.joinedAt !== BigInt(0) && (
                  <span className="text-[10px] text-gray-500">Changeable</span>
                )}
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
                onChange={(e) => setBio(e.target.value)}
                maxLength={600}
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
              {skillCount > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {skills
                    .split(",")
                    .filter((s) => s.trim())
                    .slice(0, 8)
                    .map((s, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded-full bg-gray-800/60 text-[10px] text-gray-300"
                      >
                        {s.trim()}
                      </span>
                    ))}
                  {skillCount > 8 && (
                    <span className="text-[10px] text-gray-400">
                      +{skillCount - 8}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-400">
                Portfolio (URL / IPFS)
              </label>
              <input
                value={portfolioUri}
                onChange={(e) => setPortfolioUri(e.target.value)}
                placeholder="https:// or ipfs://"
                className="w-full rounded-lg border border-white/10 bg-gray-950/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-white/15"
              />
              {portfolioUri && (
                <p className="text-[11px] text-gray-500 break-all flex items-center gap-1">
                  <LinkIcon className="w-3 h-3" />
                  {portfolioUri}
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
                onClick={saveProfile}
                disabled={
                  saving ||
                  uploadingAvatar ||
                  !bio.trim() ||
                  (!profile && !username.trim())
                }
                className="inline-flex items-center gap-2 rounded-lg bg-white text-black px-5 py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-40"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving
                  ? "Saving…"
                  : profile?.joinedAt && profile.joinedAt !== BigInt(0)
                  ? "Update Profile"
                  : "Create Profile"}
              </button>
            </div>
          </div>

          {/* Mission History (condensed) */}
          {missions.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/40 p-6 space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                <History className="w-4 h-4" /> Recent Missions
              </div>
              <div className="space-y-3">
                {missions.slice(0, 5).map((mission, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-white/10 bg-gray-950/50 p-4 text-xs flex items-start justify-between gap-4"
                  >
                    <div className="space-y-1 min-w-0">
                      <p className="font-medium text-gray-200">
                        Escrow #{mission.escrowId.toString()}
                      </p>
                      <p className="text-gray-500">
                        Client {formatAddress(mission.client)}
                      </p>
                      <p className="text-gray-500">
                        Provider {formatAddress(mission.provider)}
                      </p>
                    </div>
                    <div className="text-right space-y-1">
                      <p className="font-semibold text-gray-100">
                        {formatTokenAmountWithSymbol(
                          mission.amount,
                          mission.token,
                          { tokens }
                        )}
                      </p>
                      <p className="text-[10px] text-gray-500">
                        {new Date(
                          Number(mission.completedAt) * 1000
                        ).toLocaleDateString()}
                      </p>
                      {mission.wasDisputed && (
                        <span className="inline-block px-2 py-0.5 rounded bg-red-900/70 text-red-300 text-[10px]">
                          Disputed
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {missions.length > 5 && (
                <p className="text-[11px] text-gray-500">
                  Showing 5 of {missions.length} missions.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right Sidebar */}
        <aside className="space-y-6">
          {/* Preview */}
          <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/40 p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Profile Preview
            </h3>
            <div className="rounded-lg border border-white/10 bg-gray-950/60 p-4 space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {avatarPreview && (
                  <div className="relative h-12 w-12 rounded-full overflow-hidden border border-white/10">
                    <Image
                      src={avatarPreview}
                      alt="avatar"
                      fill
                      sizes="48px"
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
                {userType === UserType.PROJECT_OWNER && (
                  <span className="px-2 py-0.5 rounded-full bg-gray-800/70 text-[11px] text-rose-300">
                    Owner
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
                  <LinkIcon className="w-3 h-3" /> {portfolioUri}
                </div>
              )}
            </div>
          </div>
          {/* Badges */}
          <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/40 p-5 space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              <Award className="w-4 h-4" /> Badges
            </div>
            {badges.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {badges.map((badge, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded-full bg-yellow-600/30 text-yellow-200 text-[10px] tracking-wide"
                  >
                    {Badge[badge] || "NONE"}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-gray-500">No badges yet.</p>
            )}
          </div>
          {/* Mission Stats */}
          <div className="rounded-xl border border-white/10 bg-gradient-to-b from-gray-900/70 to-gray-900/40 p-5 space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              <Target className="w-4 h-4" /> Mission Stats
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Total Missions</span>
                <span className="font-medium text-gray-200">
                  {missions.length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Disputed</span>
                <span className="font-medium text-red-300">{disputes}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Success Rate</span>
                <span className="font-medium text-emerald-300">
                  {successRate}%
                </span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
