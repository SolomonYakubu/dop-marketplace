"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import Image from "next/image";
import logo from "../../public/logo.jpeg";
export function Header() {
  const { address } = useAccount();
  const [profileDropdown, setProfileDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Ensure we only render address-dependent UI after the component mounts
  const [mounted, setMounted] = useState(false);
  // Mobile menu state & refs
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const toggleBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setProfileDropdown(false);
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

  return (
    <header className="sticky top-0 z-30 border-b border-gray-800 bg-black/70 backdrop-blur supports-[backdrop-filter]:bg-black/50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center py-4">
          <div className="flex items-center gap-3">
            <Image src={logo} alt="Logo" className="h-8 w-8 rounded" />
            <Link href="/" className="text-xl font-semibold text-white">
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
                  <ConnectButton chainStatus="icon" showBalance={false} />
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
