import React from "react";
import Link from "next/link";
import { COPY } from "@/lib/copy";
import { TactileButton } from "@/components/ui/TactileButton";
import { GlassPanel } from "@/components/ui/GlassPanel";

export default function ConsentPage() {
  return (
    <div className="bk-app flex items-center justify-center p-4">
      <GlassPanel elevated className="relative w-full max-w-lg p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="bk-frame--thin grid h-10 w-10 place-items-center border bg-[var(--bk-success-soft)] text-[var(--bk-success-text)]">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-black text-[var(--bk-ink)]">{COPY.auth.consentTitle}</h1>
            <p className="text-xs text-[var(--bk-muted)]">Privacy &amp; Monitoring Notice</p>
          </div>
        </div>

        <div className="bk-frame--thin mb-6 border bg-[var(--bk-paper)] p-4 text-xs leading-relaxed text-[var(--bk-ink)]">
          <p>{COPY.auth.consentBody}</p>
          <div className="bk-divider mt-2 flex items-center gap-2 pt-2 text-[11px] text-[var(--bk-muted)]">
            <span className="h-2 w-2 bg-[var(--bk-success)]" />
            <span>End-to-end encrypted session &amp; dynamic policy protection</span>
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
    </div>
  );
}
