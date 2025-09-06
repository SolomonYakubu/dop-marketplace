"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import {
  formatAddress,
  formatTokenAmountWithSymbol,
  getBadgeLabel,
} from "@/lib/utils";
import { ethers } from "ethers";
import { getMarketplaceContract, getTokenAddresses } from "@/lib/contract";
import {
  UserType,
  Badge,
  Mission,
  OnchainUserProfile,
} from "@/types/marketplace";
import { useToastContext } from "@/components/providers";

export default function ComprehensiveProfilePage() {
  const { address, chain } = useAccount();
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

  const [saving, setSaving] = useState(false);

  const tokens = getTokenAddresses(chain?.id ?? 11124);

  const loadProfileData = useCallback(async () => {
    if (!chain || !address) return;

    try {
      setLoading(true);
      const provider = new ethers.BrowserProvider(
        (window as unknown as { ethereum: ethers.Eip1193Provider }).ethereum
      );
      const contract = getMarketplaceContract(chain.id, provider);

      // Load profile
      const profileData = (await contract.getProfile(
        address
      )) as OnchainUserProfile;
      if (profileData && profileData.joinedAt !== BigInt(0)) {
        setProfile(profileData);
        setBio(profileData.bio || "");
        setSkills((profileData.skills || []).join(", "));
        setPortfolioUri(profileData.portfolioURIs?.[0] || "");
        setUserType(profileData.userType);
      }

      // Load mission history
      const missionHistory = await contract.getMissionHistory(address);
      setMissions(missionHistory);

      // Load badges
      const userBadges = await contract.getUserBadges(address);
      setBadges(userBadges);
    } catch (error) {
      console.error("Failed to load profile data:", error);
    } finally {
      setLoading(false);
    }
  }, [chain, address]);

  async function saveProfile() {
    if (!chain || !address) {
      toast.showError("Connect Wallet", "Connect your wallet");
      return;
    }
    try {
      setSaving(true);
      const provider = new ethers.BrowserProvider(
        (window as unknown as { ethereum: ethers.Eip1193Provider }).ethereum
      );
      const contract = getMarketplaceContract(chain.id, provider);
      const signer = await provider.getSigner();
      contract.connect(signer);

      const skillsArr = skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (profile && profile.joinedAt !== BigInt(0)) {
        await contract.updateProfile(
          bio,
          skillsArr,
          portfolioUri ? portfolioUri : ""
        );
      } else {
        await contract.createProfile(
          bio,
          skillsArr,
          portfolioUri ? portfolioUri : "",
          userType
        );
      }

      toast.showSuccess("Success", "Profile saved successfully!");
      await loadProfileData();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save profile";
      console.error("Profile save error:", e);
      toast.showError("Error", msg);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadProfileData();
  }, [loadProfileData]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-800 rounded mb-6"></div>
          <div className="h-64 bg-gray-800 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Profile</h1>
          <p className="text-gray-400">
            {address && formatAddress(address)}
            {profile?.isVerified && (
              <span className="ml-2 text-green-400">✓ Verified</span>
            )}
          </p>
        </div>
        {profile?.joinedAt && profile.joinedAt !== BigInt(0) && (
          <div className="text-sm text-gray-400">
            Joined:{" "}
            {new Date(Number(profile.joinedAt) * 1000).toLocaleDateString()}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main Profile Form */}
        <div className="lg:col-span-2">
          <div className="container-panel p-6 space-y-6">
            <h2 className="text-xl font-semibold mb-4">Profile Information</h2>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
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
                className="w-full rounded-lg border border-gray-800 bg-black px-3 py-2 outline-none focus:border-gray-600 disabled:opacity-50"
              >
                <option value={UserType.PROJECT_OWNER}>Project Owner</option>
                <option value={UserType.DEVELOPER}>Developer</option>
                <option value={UserType.ARTIST}>Artist</option>
                <option value={UserType.KOL}>KOL</option>
              </select>
              {profile?.joinedAt !== undefined &&
                profile.joinedAt !== BigInt(0) && (
                  <p className="text-xs text-gray-500 mt-1">
                    User type cannot be changed after profile creation
                  </p>
                )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                placeholder="Tell us about yourself..."
                className="w-full rounded-lg border border-gray-800 bg-black px-3 py-2 outline-none focus:border-gray-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Skills (comma-separated)
              </label>
              <input
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                placeholder="React, TypeScript, Solidity, Web3..."
                className="w-full rounded-lg border border-gray-800 bg-black px-3 py-2 outline-none focus:border-gray-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Portfolio URI
              </label>
              <input
                value={portfolioUri}
                onChange={(e) => setPortfolioUri(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-lg border border-gray-800 bg-black px-3 py-2 outline-none focus:border-gray-600"
              />
            </div>

            <button
              onClick={saveProfile}
              disabled={saving || !bio.trim()}
              className="w-full rounded-lg bg-white text-black px-4 py-2 font-medium hover:opacity-90 disabled:opacity-50"
            >
              {saving
                ? "Saving..."
                : profile?.joinedAt !== undefined &&
                  profile.joinedAt !== BigInt(0)
                ? "Update Profile"
                : "Create Profile"}
            </button>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Badges */}
          <div className="container-panel p-6">
            <h3 className="text-lg font-semibold mb-4">Badges</h3>
            {badges.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {badges.map((badge, index) => (
                  <span
                    key={index}
                    className="px-3 py-1 bg-gradient-to-r from-yellow-600 to-orange-600 text-white text-xs rounded-full"
                  >
                    {getBadgeLabel(badge)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-sm">No badges earned yet</p>
            )}
          </div>

          {/* Mission Stats */}
          <div className="container-panel p-6">
            <h3 className="text-lg font-semibold mb-4">Mission Stats</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-400">Total Missions:</span>
                <span className="font-semibold">{missions.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Disputed:</span>
                <span className="font-semibold text-red-400">
                  {missions.filter((m) => m.wasDisputed).length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Success Rate:</span>
                <span className="font-semibold text-green-400">
                  {missions.length > 0
                    ? Math.round(
                        ((missions.length -
                          missions.filter((m) => m.wasDisputed).length) /
                          missions.length) *
                          100
                      )
                    : 0}
                  %
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mission History */}
      {missions.length > 0 && (
        <div className="mt-6">
          <div className="container-panel p-6">
            <h3 className="text-lg font-semibold mb-4">Mission History</h3>
            <div className="space-y-4">
              {missions.slice(0, 10).map((mission, index) => (
                <div
                  key={index}
                  className="border border-gray-800 rounded-lg p-4 hover:border-gray-700"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">
                        Escrow #{mission.escrowId.toString()}
                      </p>
                      <p className="text-sm text-gray-400">
                        Client: {formatAddress(mission.client)}
                      </p>
                      <p className="text-sm text-gray-400">
                        Provider: {formatAddress(mission.provider)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        {formatTokenAmountWithSymbol(
                          mission.amount,
                          mission.token,
                          { tokens }
                        )}
                      </p>
                      <p className="text-xs text-gray-400">
                        {new Date(
                          Number(mission.completedAt) * 1000
                        ).toLocaleDateString()}
                      </p>
                      {mission.wasDisputed && (
                        <span className="inline-block px-2 py-1 bg-red-900 text-red-200 text-xs rounded mt-1">
                          Disputed
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
