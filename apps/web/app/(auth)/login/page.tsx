"use client";

import React from "react";
import Link from "next/link";
import { COPY } from "@/lib/copy";
import { TactileButton } from "@/components/ui/TactileButton";
import { GlassPanel } from "@/components/ui/GlassPanel";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-[#0A0F1F] via-[#0E152E] to-[#0A0F1F] text-slate-100">
      {/* Decorative Glow */}
      <div className="absolute w-[500px] h-[500px] bg-blue-600/15 rounded-full blur-[120px] pointer-events-none" />

      <GlassPanel elevated className="relative w-full max-w-md p-8 border-white/10 shadow-2xl">
        {/* Brand Icon / Logo Tile */}
        <div className="flex flex-col items-center mb-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/30 mb-3 border border-white/20">
            <svg
              className="w-8 h-8 text-white drop-shadow"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">{COPY.auth.welcomeBack}</h1>
          <p className="text-xs text-slate-400 mt-1">{COPY.auth.signInSubtitle}</p>
        </div>

        {/* Form */}
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              {COPY.auth.emailLabel}
            </label>
            <div className="relative">
              <input
                type="email"
                placeholder={COPY.auth.emailPlaceholder}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-950/60 border border-white/10 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-medium text-slate-300">
                {COPY.auth.passwordLabel}
              </label>
              <Link
                href="/forgot-password"
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                {COPY.auth.forgotPassword}
              </Link>
            </div>
            <input
              type="password"
              placeholder={COPY.auth.passwordPlaceholder}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-950/60 border border-white/10 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
            />
          </div>

          <div className="flex items-center">
            <input
              id="remember"
              type="checkbox"
              className="w-4 h-4 rounded border-white/20 bg-slate-950 text-blue-600 focus:ring-blue-500"
            />
            <label htmlFor="remember" className="ml-2 text-xs text-slate-400 select-none cursor-pointer">
              {COPY.auth.rememberMe}
            </label>
          </div>

          <TactileButton variant="primary" size="md" className="w-full mt-2" type="submit">
            <span>{COPY.auth.signInButton}</span>
            <span className="text-sm">→</span>
          </TactileButton>
        </form>

        {/* Divider */}
        <div className="relative my-6 text-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/10" />
          </div>
          <span className="relative px-3 text-[11px] uppercase tracking-wider text-slate-500 bg-[#0E152E]">
            {COPY.auth.dividerText}
          </span>
        </div>

        {/* Continue with Google */}
        <TactileButton variant="secondary" size="md" className="w-full gap-3">
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span className="text-xs font-medium">{COPY.auth.continueWithGoogle}</span>
        </TactileButton>
      </GlassPanel>
    </main>
  );
}
