"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/context";

export function ProfileMenu() {
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close popup when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (loading) {
    return null;
  }

  if (!user) {
    return (
      <Link
        href="/auth/login"
        className="px-3 py-1.5 rounded-full text-xs font-semibold hover:opacity-90 transition-all"
        style={{
          background: "var(--brand-grad, linear-gradient(135deg, #5B8CFF, #2F6BFF, #1E4FD8))",
          color: "#fff",
        }}
      >
        Sign in
      </Link>
    );
  }

  const initial = (user.username?.[0] || "U").toUpperCase();

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 px-2.5 py-1 rounded-full border transition-all text-xs cursor-pointer focus:outline-none"
        style={{
          background: open ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)",
          borderColor: "var(--border-subtle, rgba(255,255,255,0.1))",
          color: "#cbd5e1",
        }}
      >
        <span
          className="w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px]"
          style={{
            background: "linear-gradient(135deg, #5B8CFF 0%, #2F6BFF 55%, #1E4FD8 100%)",
            color: "#fff",
          }}
        >
          {initial}
        </span>
        <span className="font-medium text-xs max-w-[90px] truncate">{user.username}</span>
        <svg
          className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Pop-up dropdown menu */}
      {open && (
        <div
          className="absolute right-0 mt-2 w-56 rounded-2xl border p-3 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100"
          style={{
            background: "rgba(15, 17, 23, 0.95)",
            backdropFilter: "blur(20px)",
            borderColor: "rgba(255, 255, 255, 0.12)",
            boxShadow: "0 12px 36px rgba(0,0,0,0.5)",
          }}
        >
          {/* User info */}
          <div className="px-2 py-2 mb-2 rounded-xl border-b pb-3" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            <div className="flex items-center gap-2.5 mb-1.5">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs"
                style={{
                  background: "linear-gradient(135deg, #5B8CFF 0%, #2F6BFF 55%, #1E4FD8 100%)",
                  color: "#fff",
                }}
              >
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-white truncate">{user.username}</div>
                <div className="text-[11px] truncate" style={{ color: "#94a3b8" }}>
                  {user.email}
                </div>
              </div>
            </div>
            {user.role === "admin" && (
              <span
                className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{
                  background: "rgba(245,165,36,0.15)",
                  color: "#f59e0b",
                  border: "1px solid rgba(245,165,36,0.3)",
                }}
              >
                ADMIN
              </span>
            )}
          </div>

          {/* Admin link if user is admin */}
          {user.role === "admin" && (
            <Link
              href="/admin"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-slate-300 hover:text-white hover:bg-white/5 transition-all mb-1"
            >
              <span>🛡️</span>
              <span>Admin Panel</span>
            </Link>
          )}

          {/* Sign out button */}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-all text-left cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
