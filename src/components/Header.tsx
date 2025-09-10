"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useAccount, useBalance, useChainId } from "wagmi";
import Image from "next/image";
import logo from "../../public/logo.jpeg";
import { TOKENS } from "@/lib/contract";
import { ethers } from "ethers";
import {
  formatTokenAmountWithSymbol,
  type KnownTokens,
} from "@/lib/utils";
export function Header() {
  const { address } = useAccount();
  const [profileDropdown, setProfileDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const tokenDropdownRef = useRef<HTMLDivElement>(null);
  const tokenDropdownRefMobile = useRef<HTMLDivElement>(null);
  // Ensure we only render address-dependent UI after the component mounts
  const [mounted, setMounted] = useState(false);
  // Mobile menu state & refs
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const toggleBtnRef = useRef<HTMLButtonElement>(null);
  const chainId = useChainId();

  type TokenKey = "DOP" | "USDC" | "ETH";
  const [selectedToken, setSelectedToken] = useState<TokenKey>("DOP");
  const [tokenDropdownOpen, setTokenDropdownOpen] = useState(false);
  const [showBalance, setShowBalance] = useState(true);

  const tokenAddresses = (TOKENS as Record<number, { DOP?: string; USDC?: string }>)[chainId] ||
    (TOKENS as Record<number, { DOP?: string; USDC?: string }>)[11124] || { DOP: "", USDC: "" };
  const knownTokens: KnownTokens = {
    DOP: tokenAddresses.DOP || undefined,
    USDC: tokenAddresses.USDC || undefined,
  };

  // Balances (prefetch all for snappy switching)
  const dopAddress = tokenAddresses.DOP && tokenAddresses.DOP.startsWith("0x") ? (tokenAddresses.DOP as `0x${string}`) : undefined;
  const usdcAddress = tokenAddresses.USDC && tokenAddresses.USDC.startsWith("0x") ? (tokenAddresses.USDC as `0x${string}`) : undefined;

  const { data: ethBal } = useBalance({
    address,
    query: {
      enabled: mounted && !!address,
      refetchInterval: 15000,
    },
  });
  const { data: dopBal } = useBalance({
    address,
    token: dopAddress,
    query: {
      enabled: mounted && !!address && !!dopAddress,
      refetchInterval: 15000,
    },
  });
  const { data: usdcBal } = useBalance({
    address,
    token: usdcAddress,
    query: {
      enabled: mounted && !!address && !!usdcAddress,
      refetchInterval: 15000,
    },
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setProfileDropdown(false);
      }
      if (tokenDropdownRef.current && !tokenDropdownRef.current.contains(target)) {
        setTokenDropdownOpen(false);
      }
      if (tokenDropdownRefMobile.current && !tokenDropdownRefMobile.current.contains(target)) {
        setTokenDropdownOpen(false);
      }
      // Close mobile menu on outside click (ignore clicks on toggle button)
      if (
        mobileOpen &&
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(target) &&
        !(toggleBtnRef.current && toggleBtnRef.current.contains(target))
      ) {
        setMobileOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [mobileOpen]);

  // Ensure selected token is sensible for current chain (fallback to ETH if DOP not set)
  useEffect(() => {
    if (selectedToken === "DOP" && !dopAddress) setSelectedToken("ETH");
  }, [chainId, dopAddress, selectedToken]);

  function currentBalanceFormatted() {
    if (!mounted || !address) return "-";
    const sym = selectedToken;
    const tokenAddr = sym === "ETH" ? ethers.ZeroAddress : (sym === "DOP" ? tokenAddresses.DOP : tokenAddresses.USDC) || ethers.ZeroAddress;
    const val = sym === "ETH" ? ethBal?.value : sym === "DOP" ? dopBal?.value : usdcBal?.value;
    if (val == null) return "-";
    if (!showBalance) {
      const symbol = sym;
      return `•••• ${symbol}`;
    }
    return formatTokenAmountWithSymbol(val, tokenAddr, { tokens: knownTokens, maxFractionDigits: 4 });
  }

  return (
    <header className="sticky top-0 z-30 border-b border-gray-800 bg-black/70 backdrop-blur supports-[backdrop-filter]:bg-black/50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-4">
          <div className="flex items-center gap-3">
            <Image src={logo} alt="Logo" className="h-8 w-8 rounded" />
            <Link href="/" className="hidden md:block text-xl font-semibold text-white">
              Death of Pengu
            </Link>
          </div>

          <nav className="hidden md:flex items-center gap-6">
            <Link
              href="/browse"
              className="text-gray-300 hover:text-white transition-colors"
            >
              Browse
            </Link>
            <Link
              href="/briefs"
              className="text-gray-300 hover:text-white transition-colors"
            >
              Briefs
            </Link>
            <Link
              href="/gigs"
              className="text-gray-300 hover:text-white transition-colors"
            >
              Gigs
            </Link>
            <Link
              href="/offers"
              className="text-gray-300 hover:text-white transition-colors"
            >
              Offers
            </Link>
            <Link
              href="/create"
              className="text-gray-300 hover:text-white transition-colors"
            >
              Create
            </Link>

            {/* Profile Dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setProfileDropdown(!profileDropdown)}
                className="text-gray-300 hover:text-white transition-colors flex items-center gap-1"
              >
                Profile
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              {profileDropdown && (
                <div className="absolute right-0 mt-2 w-48 bg-gray-900 border border-gray-800 rounded-md shadow-lg z-50">
                  <div className="py-1">
                    <Link
                      href="/profile/comprehensive"
                      className="block px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
                      onClick={() => setProfileDropdown(false)}
                    >
                      My Profile
                    </Link>
                    {address && (
                      <Link
                        href={`/profile/${address}`}
                        className="block px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
                        onClick={() => setProfileDropdown(false)}
                      >
                        Public Profile
                      </Link>
                    )}
                    <Link
                      href="/profile"
                      className="block px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white"
                      onClick={() => setProfileDropdown(false)}
                    >
                      Edit Profile
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </nav>

          {/* Right controls (mobile + desktop) */}
          <div className="flex items-center gap-2 md:gap-4">
            {/* Token balance selector (desktop) */}
            <div className="hidden md:flex items-center relative" ref={tokenDropdownRef}>
              <button
                onClick={() => setTokenDropdownOpen((v) => !v)}
                className="flex items-center gap-2 rounded-md border border-gray-800 bg-gray-900/60 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800"
                disabled={!mounted || !address}
                title={mounted && !address ? "Connect wallet to view balances" : undefined}
             >
                <span className="font-medium">{selectedToken}</span>
                <span className="text-gray-400">{currentBalanceFormatted()}</span>
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {/* Eye toggle (desktop) */}
              <button
                onClick={() => setShowBalance((v) => !v)}
                className="ml-2 inline-flex items-center justify-center rounded-md p-2 text-gray-300 hover:text-white hover:bg-gray-800"
                aria-label={showBalance ? "Hide balance" : "Show balance"}
                title={showBalance ? "Hide balance" : "Show balance"}
                disabled={!mounted || !address}
              >
                {showBalance ? (
                  // Eye icon
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.644C3.423 7.51 7.36 5 12 5c4.64 0 8.577 2.51 9.964 6.678.07.207.07.437 0 .644C20.577 16.49 16.64 19 12 19c-4.64 0-8.577-2.51-9.964-6.678z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                ) : (
                  // Eye-off icon
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.584 10.587A3 3 0 0012 15a3 3 0 001.416-.376M9.88 4.515A9.956 9.956 0 0112 4c4.64 0 8.577 2.51 9.964 6.678.07.207.07.437 0 .644a11.948 11.948 0 01-2.262 3.495M6.228 6.228A11.948 11.948 0 002.036 11.678c-.07.207-.07.437 0 .644C3.423 16.49 7.36 19 12 19c1.04 0 2.046-.133 3-.383" />
                  </svg>
                )}
              </button>
              {tokenDropdownOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-gray-900 border border-gray-800 rounded-md shadow-lg z-50">
                  <div className="py-1">
                    {(["DOP", "USDC", "ETH"] as TokenKey[]).map((sym) => {
                      const disabled =
                        (sym === "DOP" && !dopAddress) || (sym === "USDC" && !usdcAddress);
                      const tokenAddr = sym === "ETH" ? ethers.ZeroAddress : sym === "DOP" ? tokenAddresses.DOP : tokenAddresses.USDC;
                      const val = sym === "ETH" ? ethBal?.value : sym === "DOP" ? dopBal?.value : usdcBal?.value;
                      const label = disabled
                        ? `${sym} (not set)`
                        : val != null
                        ? formatTokenAmountWithSymbol(val, tokenAddr || ethers.ZeroAddress, { tokens: knownTokens, maxFractionDigits: 4 })
                        : `${sym} — …`;
                      return (
                        <button
                          key={sym}
                          disabled={disabled}
                          onClick={() => {
                            setSelectedToken(sym);
                            setTokenDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-800 ${
                            disabled ? "text-gray-500 cursor-not-allowed" : "text-gray-300 hover:text-white"
                          } ${selectedToken === sym ? "bg-gray-800/60" : ""}`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            {/* Token balance selector (mobile) */}
            <div className="md:hidden relative" ref={tokenDropdownRefMobile}>
              <div className="flex items-center">
                <button
                  onClick={() => setTokenDropdownOpen((v) => !v)}
                  className="flex items-center gap-1 rounded-md border border-gray-800 bg-gray-900/60 px-2 py-1 text-xs text-gray-200 hover:bg-gray-800"
                  disabled={!mounted || !address}
                  title={mounted && !address ? "Connect wallet to view balances" : undefined}
                >
                  <span className="font-medium">{selectedToken}</span>
                  <span className="text-gray-400">{currentBalanceFormatted()}</span>
                  <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <button
                  onClick={() => setShowBalance((v) => !v)}
                  className="ml-1 inline-flex items-center justify-center rounded-md p-1 text-gray-300 hover:text-white hover:bg-gray-800"
                  aria-label={showBalance ? "Hide balance" : "Show balance"}
                  title={showBalance ? "Hide balance" : "Show balance"}
                  disabled={!mounted || !address}
                >
                  {showBalance ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.644C3.423 7.51 7.36 5 12 5c4.64 0 8.577 2.51 9.964 6.678.07.207.07.437 0 .644C20.577 16.49 16.64 19 12 19c-4.64 0-8.577-2.51-9.964-6.678z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.584 10.587A3 3 0 0012 15a3 3 0 001.416-.376M9.88 4.515A9.956 9.956 0 0112 4c4.64 0 8.577 2.51 9.964 6.678.07.207.07.437 0 .644a11.948 11.948 0 01-2.262 3.495M6.228 6.228A11.948 11.948 0 002.036 11.678c-.07.207-.07.437 0 .644C3.423 16.49 7.36 19 12 19c1.04 0 2.046-.133 3-.383" />
                    </svg>
                  )}
                </button>
              </div>
              {tokenDropdownOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-gray-900 border border-gray-800 rounded-md shadow-lg z-50">
                  <div className="py-1">
                    {(["DOP", "USDC", "ETH"] as TokenKey[]).map((sym) => {
                      const disabled = (sym === "DOP" && !dopAddress) || (sym === "USDC" && !usdcAddress);
                      const tokenAddr = sym === "ETH" ? ethers.ZeroAddress : sym === "DOP" ? tokenAddresses.DOP : tokenAddresses.USDC;
                      const val = sym === "ETH" ? ethBal?.value : sym === "DOP" ? dopBal?.value : usdcBal?.value;
                      const label = disabled
                        ? `${sym} (not set)`
                        : val != null
                        ? formatTokenAmountWithSymbol(val, tokenAddr || ethers.ZeroAddress, { tokens: knownTokens, maxFractionDigits: 4 })
                        : `${sym} — …`;
                      return (
                        <button
                          key={sym}
                          disabled={disabled}
                          onClick={() => {
                            setSelectedToken(sym);
                            setTokenDropdownOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-800 ${
                            disabled ? "text-gray-500 cursor-not-allowed" : "text-gray-300 hover:text-white"
                          } ${selectedToken === sym ? "bg-gray-800/60" : ""}`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            {/* Hide connect button on mobile to reduce clutter */}
            <div className="hidden md:block">
              <ConnectButton chainStatus="icon" showBalance={false} />
            </div>
            {/* Mobile menu toggle */}
            <button
              ref={toggleBtnRef}
              onClick={() => setMobileOpen((v) => !v)}
              className="md:hidden inline-flex items-center justify-center rounded-md p-2 text-gray-300 hover:text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-white/20"
              aria-controls="mobile-menu"
              aria-expanded={mobileOpen}
              aria-label="Toggle navigation menu"
            >
              {mobileOpen ? (
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              ) : (
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 6h16M4 12h16M4 18h16"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu panel with animation */}
      <div
        id="mobile-menu"
        ref={mobileMenuRef}
        className="md:hidden border-t border-gray-800 bg-black/70 backdrop-blur supports-[backdrop-filter]:bg-black/50"
      >
        {/* Animated wrapper: collapses using grid-rows height trick */}
        <div
          className={`grid transition-all duration-300 ease-out ${
            mobileOpen
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0 pointer-events-none"
          }`}
          aria-hidden={!mobileOpen}
        >
          <div className="overflow-hidden">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-3">
              <div className="flex flex-col gap-2">
                {/* Connect button inside the mobile menu */}
                <div className="px-3 py-2">
                  <ConnectButton
                    chainStatus="icon"
                    accountStatus={{
                      smallScreen: "avatar",
                      largeScreen: "full",
                    }}
                    showBalance={false}
                  />
                </div>

                {/* Divider */}
                <div className="my-2 h-px bg-gray-800" />

                <Link
                  href="/browse"
                  className="px-3 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800"
                  onClick={() => setMobileOpen(false)}
                >
                  Browse
                </Link>
                <Link
                  href="/briefs"
                  className="px-3 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800"
                  onClick={() => setMobileOpen(false)}
                >
                  Briefs
                </Link>
                <Link
                  href="/gigs"
                  className="px-3 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800"
                  onClick={() => setMobileOpen(false)}
                >
                  Gigs
                </Link>
                <Link
                  href="/offers"
                  className="px-3 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800"
                  onClick={() => setMobileOpen(false)}
                >
                  Offers
                </Link>
                <Link
                  href="/create"
                  className="px-3 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800"
                  onClick={() => setMobileOpen(false)}
                >
                  Create
                </Link>

                {/* Divider */}
                <div className="my-2 h-px bg-gray-800" />

                {/* Profile links on mobile */}
                <div>
                  <p className="px-3 pb-1 text-xs uppercase tracking-wider text-gray-500">
                    Profile
                  </p>
                  <div className="flex flex-col gap-2">
                    <Link
                      href="/profile/comprehensive"
                      className="px-3 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800"
                      onClick={() => setMobileOpen(false)}
                    >
                      My Profile
                    </Link>
                    {mounted && address && (
                      <Link
                        href={`/profile/${address}`}
                        className="px-3 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800"
                        onClick={() => setMobileOpen(false)}
                      >
                        Public Profile
                      </Link>
                    )}
                    <Link
                      href="/profile"
                      className="px-3 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800"
                      onClick={() => setMobileOpen(false)}
                    >
                      Edit Profile
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
