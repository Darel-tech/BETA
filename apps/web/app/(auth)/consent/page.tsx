import React from "react";
import Link from "next/link";
import { COPY } from "@/lib/copy";
import { TactileButton } from "@/components/ui/TactileButton";
import { GlassPanel } from "@/components/ui/GlassPanel";

export default function ConsentPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-[#0A0F1F] via-[#0E152E] to-[#0A0F1F] text-slate-100">
      <div className="absolute w-[500px] h-[500px] bg-blue-600/15 rounded-full blur-[120px] pointer-events-none" />

      <GlassPanel elevated className="relative w-full max-w-lg p-8 border-white/10 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{COPY.auth.consentTitle}</h1>
            <p className="text-xs text-slate-400">Privacy & Monitoring Notice</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-950/40 border border-white/5 mb-6 text-xs text-slate-300 leading-relaxed space-y-3">
          <p>{COPY.auth.consentBody}</p>
          <div className="pt-2 border-t border-white/5 flex items-center gap-2 text-[11px] text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>End-to-end encrypted session & dynamic policy protection</span>
          </div>
        </div>

        <div className="flex gap-3">
          <Link href="/chat" className="flex-1">
            <TactileButton variant="primary" size="md" className="w-full">
              {COPY.auth.consentAgree}
            </TactileButton>
          </Link>
          <Link href="/">
            <TactileButton variant="ghost" size="md">
              {COPY.auth.consentDecline}
            </TactileButton>
          </Link>
        </div>
      </GlassPanel>
    </main>
  );
}
