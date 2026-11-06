/**
 * BETA Extension — Content Script
 *
 * Automatically detects when a ChatGPT or Claude AI reply finishes streaming
 * and fires a check WITHOUT any user interaction.
 *
 * Rules (Phase 5.5.4):
 * - Uses MutationObserver on the reply container — not setInterval.
 * - Debounces 500 ms after the last DOM mutation so the check never fires
 *   mid-stream.
 * - Fires automatically; the user never clicks, selects text, or opens a
 *   popup. The badge appears next to the message once the reply is done.
 * - API keys NEVER appear in extension code — calls go through the BETA
 *   web app which holds the keys server-side (Phase 12 anti-pattern check).
 */

(() => {
  "use strict";

  const host = window.location.hostname;
  const APP_URL = "http://localhost:3000"; // The Next.js app — not the Python services

  // ── Badge helpers ─────────────────────────────────────────────────────────

  function verdictClass(verdict) {
    return {
      trustworthy: "beta-verdict--trustworthy",
      uncertain: "beta-verdict--uncertain",
      needs_correction: "beta-verdict--needs-correction",
    }[verdict] ?? "beta-verdict--unknown";
  }

  function verdictLabel(verdict) {
    return {
      trustworthy: "✓ Trustworthy",
      uncertain: "~ Uncertain",
      needs_correction: "✗ Needs Correction",
    }[verdict] ?? "? Unknown";
  }

  function injectBadgeStyles() {
    if (document.getElementById("beta-styles")) return;
    const style = document.createElement("style");
    style.id = "beta-styles";
    style.textContent = `
      .beta-badge {
        display: inline-flex; align-items: center; gap: 6px;
        font-family: ui-sans-serif, system-ui, sans-serif;
        font-size: 11px; font-weight: 700;
        padding: 3px 10px; border-radius: 999px;
        margin-top: 8px; cursor: pointer;
        border: 1px solid transparent;
        transition: opacity 0.2s;
        text-decoration: none;
      }
      .beta-badge:hover { opacity: 0.8; }
      .beta-verdict--trustworthy  { color:#22c55e; background:rgba(34,197,94,.12);  border-color:rgba(34,197,94,.35);  }
      .beta-verdict--uncertain    { color:#f59e0b; background:rgba(245,158,11,.12); border-color:rgba(245,158,11,.35); }
      .beta-verdict--needs-correction { color:#ef4444; background:rgba(239,68,68,.12); border-color:rgba(239,68,68,.35); }
      .beta-verdict--loading      { color:#94a3b8; background:rgba(148,163,184,.1); border-color:rgba(148,163,184,.2);  }
      .beta-verdict--error        { color:#64748b; background:rgba(100,116,139,.1); border-color:rgba(100,116,139,.2);  }
    `;
    document.head.appendChild(style);
  }

  /**
   * Insert or update a badge element AFTER a reply container element.
   * Never appended inside the AI reply text itself.
   */
  function upsertBadge(containerEl, state, verdict, question) {
    let badge = containerEl.__betaBadge;
    if (!badge) {
      badge = document.createElement("a");
      badge.className = "beta-badge";
      // Link to the compare page pre-populated with the question
      containerEl.insertAdjacentElement("afterend", badge);
      containerEl.__betaBadge = badge;
    }

    if (state === "loading") {
      badge.className = "beta-badge beta-verdict--loading";
      badge.textContent = "⟳ BETA checking…";
      badge.href = "#";
    } else if (state === "error") {
      badge.className = "beta-badge beta-verdict--error";
      badge.textContent = "BETA: check failed";
      badge.href = APP_URL;
    } else {
      badge.className = `beta-badge ${verdictClass(verdict)}`;
      badge.textContent = `BETA ${verdictLabel(verdict)}`;
      badge.target = "_blank";
      badge.rel = "noopener noreferrer";
      badge.href = question
        ? `${APP_URL}/compare?q=${encodeURIComponent(question)}`
        : APP_URL;
    }
  }

  // ── API call ───────────────────────────────────────────────────────────────

  async function checkWithBeta(answer, source, question) {
    const res = await fetch(`${APP_URL}/api/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: answer, source, question }),
    });
    if (!res.ok) throw new Error(`BETA API ${res.status}`);
    return res.json();
  }

  // ── Extractor helpers ──────────────────────────────────────────────────────

  function getLatestChatGPTReply() {
    // ChatGPT: assistant messages carry data-content-search-unit-key with ":assistant"
    const containers = [...document.querySelectorAll("[data-content-search-unit-key]")].filter(
      (el) => el.getAttribute("data-content-search-unit-key")?.includes(":assistant")
    );
    if (!containers.length) return null;
    const latest = containers[containers.length - 1];
    const text = latest.innerText
      .split("\n")
      .filter((l) => l.trim() && l.trim() !== "ChatGPT said:")
      .join("\n")
      .trim();
    return text ? { el: latest, text } : null;
  }

  function getLatestClaudeReply() {
    const messages = document.querySelectorAll('[data-testid="assistant-message"]');
    if (!messages.length) return null;
    const latest = messages[messages.length - 1];
    const textEl = latest.querySelector("[data-perf-reply-text]") ?? latest;
    const text = textEl.innerText?.trim();
    return text ? { el: latest, text } : null;
  }

  // ── Core watcher factory ───────────────────────────────────────────────────

  function watchReplies(source, getLatestReply) {
    injectBadgeStyles();

    let lastCheckedText = "";
    let debounceTimer = null;
    let inflightText = null;

    async function handleStableReply() {
      const reply = getLatestReply();
      if (!reply) return;
      const { el, text } = reply;

      // Skip if we already checked this exact text
      if (text === lastCheckedText || text === inflightText) return;

      inflightText = text;
      upsertBadge(el, "loading", null, null);

      try {
        const result = await checkWithBeta(text, source, text.slice(0, 200));
        lastCheckedText = text;
        inflightText = null;
        upsertBadge(el, "done", result.verdict, text.slice(0, 200));
      } catch (err) {
        inflightText = null;
        console.error("BETA extension check failed:", err);
        upsertBadge(el, "error", null, null);
      }
    }

    // MutationObserver — fires on every DOM change in the conversation
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      // Wait 500 ms of silence before treating the reply as "finished streaming"
      debounceTimer = setTimeout(handleStableReply, 500);
    });

    // Observe the whole document body for subtree changes
    observer.observe(document.body, { childList: true, subtree: true });

    // Also handle the case where a reply is already on-screen before the
    // observer starts (e.g. page reload mid-conversation)
    setTimeout(handleStableReply, 1000);
  }

  // ── Entry point ────────────────────────────────────────────────────────────

  if (host === "chatgpt.com") {
    console.log("BETA extension: watching ChatGPT");
    watchReplies("chatgpt", getLatestChatGPTReply);
  } else if (host === "claude.ai") {
    console.log("BETA extension: watching Claude");
    watchReplies("claude", getLatestClaudeReply);
  }
})();
