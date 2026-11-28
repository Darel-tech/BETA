"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { VerdictChip } from "@/components/ui/VerdictChip";
import { ConfidenceRing } from "@/components/ui/ConfidenceRing";
import { StageStepper } from "@/components/ui/StageStepper";
import { FirewallTelemetry } from "@/components/ui/FirewallTelemetry";
import { BkNav } from "@/components/ui/BoldKit";
/**
 * Chat styling lives in Tailwind utilities + the shared global shell classes.
 * CSS Modules are disabled by this app's Turbopack CSS rule, so importing a
 * `.module.css` file here would produce an empty class map and an unstyled page.
 */
const styles = {
  shell: "bk-app",
  grain: "pointer-events-none fixed inset-0 opacity-[0.03]",
  sidebar:
    "bk-card bk-frame flex h-full min-h-0 w-full flex-col p-4 lg:sticky lg:top-24 lg:h-[calc(100vh-7rem)] lg:w-64",
  brandRow: "flex items-center gap-3 px-2 pb-5",
  brandMark:
    "bk-frame--thin grid h-9 w-9 place-items-center bg-[var(--bk-insight)] text-base font-black text-white",
  brandName: "text-sm font-black tracking-wide text-[var(--bk-ink)]",
  brandSub: "bk-label mt-0.5",
  newChat: "bk-btn bk-btn--sm bk-press w-full justify-center",
  sectionLabel: "bk-label mb-2 mt-5 px-2",
  convList: "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1",
  convItem:
    "group flex items-center gap-1 border-2 border-transparent transition-colors hover:bg-[var(--bk-brand-soft)]",
  convActive: "border-[var(--bk-line)] bg-[var(--bk-brand-soft)]",
  convButton: "min-w-0 flex-1 px-3 py-2 text-left text-inherit",
  convTitle: "block truncate text-xs font-bold text-[var(--bk-ink)]",
  convMeta: "mt-1 block text-[9px] text-[var(--bk-muted)]",
  convDelete:
    "px-2 py-1 text-sm leading-none text-[var(--bk-muted)] opacity-0 transition hover:bg-[var(--bk-risk-soft)] hover:text-[var(--bk-risk-text)] group-hover:opacity-100",
  nav: "mt-4 flex flex-col gap-1 border-t-[3px] border-[var(--bk-line)] pt-4",
  navLink:
    "px-3 py-2 text-xs font-bold text-[var(--bk-ink)] transition hover:bg-[var(--bk-brand-soft)]",
  navIcon: "mr-2 text-sm",
  session:
    "mt-4 flex items-center justify-between border-t-[3px] border-[var(--bk-line)] px-2 pt-4 text-[10px] text-[var(--bk-muted)]",
  main: "bk-card bk-frame flex h-[min(74vh,860px)] min-h-[520px] min-w-0 flex-col overflow-hidden p-0",
  header:
    "flex h-16 shrink-0 items-center justify-between gap-3 border-b-[3px] border-[var(--bk-line)] bg-[var(--bk-brand-soft)] px-5",
  headerLeft: "flex min-w-0 items-center gap-3",
  liveDot:
    "inline-block h-2.5 w-2.5 shrink-0 border-2 border-[var(--bk-line)] bg-[var(--bk-success)]",
  liveDotBusy: "animate-pulse bg-[var(--bk-warning)]",
  headerTitle: "truncate text-sm font-black text-[var(--bk-ink)]",
  headerHint: "truncate text-[10px] text-[var(--bk-muted)]",
  headerActions: "flex shrink-0 items-center gap-2",
  pill: "bk-badge bk-badge--paper whitespace-nowrap font-mono text-[10px] normal-case",
  toggle:
    "hidden border-2 border-[var(--bk-line)] bg-[var(--bk-brand)] px-3 py-1.5 text-[10px] font-black uppercase text-white transition hover:bg-[var(--bk-brand-text)] xl:inline-flex",
  toggleOff: "bg-[var(--bk-paper)] text-[var(--bk-ink)]",
  thread: "min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-10 [scroll-behavior:smooth]",
  dayLabel:
    "mx-auto mb-6 flex max-w-3xl items-center gap-3 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--bk-muted)]",
  rowUser: "mb-5 flex justify-end",
  rowAssistant: "mb-6 flex gap-3",
  avatar:
    "bk-frame--thin grid h-8 w-8 shrink-0 place-items-center bg-[var(--bk-insight)] text-xs font-black text-white",
  bubbleUser:
    "max-w-[85%] whitespace-pre-wrap border-[3px] border-[var(--bk-line)] bg-[var(--bk-brand)] px-4 py-3 text-sm font-semibold leading-relaxed text-white shadow-[4px_4px_0_0_var(--bk-shadow)] sm:max-w-[72%]",
  assistantBody: "min-w-0 max-w-[calc(100%-2.5rem)] flex-1 sm:max-w-[80%]",
  bubbleAssistant:
    "whitespace-pre-wrap border-[3px] border-[var(--bk-line)] bg-[var(--bk-paper)] px-4 py-3.5 text-sm leading-relaxed text-[var(--bk-ink)] shadow-[4px_4px_0_0_var(--bk-shadow)]",
  draftText: "italic text-[var(--bk-muted)]",
  metaLine: "mt-2 font-mono text-[10px] text-[var(--bk-muted)]",
  statusLine: "mt-2 text-xs font-bold text-[var(--bk-brand-text)]",
  errorLine: "mt-2 text-xs font-bold text-[var(--bk-risk-text)]",
  analysis: "bk-panel bk-panel--evidence mt-3",
  analysisHead:
    "mb-3 flex flex-wrap items-center justify-between gap-3 border-b-[3px] border-[var(--bk-line)] pb-3",
  analysisTitle: "bk-label text-[var(--bk-evidence-text)]",
  verdictRow: "flex flex-wrap items-center gap-2",
  engineTag: "font-mono text-[9px] font-bold tracking-wide text-[var(--bk-evidence-text)]",
  analysisGrid: "grid gap-3 sm:grid-cols-2",
  analysisBlock: "bk-frame--thin border bg-[var(--bk-paper)] p-3",
  blockLabel: "bk-label mb-2",
  tagRow: "flex flex-wrap gap-1.5",
  tag: "bk-badge bk-badge--insight",
  evidenceList: "flex flex-col gap-2",
  evidenceItem: "flex gap-2 text-[11px] leading-relaxed text-[var(--bk-ink)]",
  evidenceYes: "font-black text-[var(--bk-success-text)]",
  evidenceNo: "font-black text-[var(--bk-risk-text)]",
  evidenceDetail: "mt-1 block text-[10px] text-[var(--bk-muted)]",
  factList: "flex flex-col gap-2",
  factItem: "flex gap-2 text-[11px] leading-relaxed text-[var(--bk-ink)]",
  factId: "pt-0.5 font-mono text-[9px] font-black text-[var(--bk-evidence-text)]",
  factSource: "font-bold text-[var(--bk-brand-text)]",
  muted: "text-[10px] text-[var(--bk-muted)]",
  correction: "bk-panel bk-panel--success mt-3",
  correctionHead:
    "mb-2 flex items-center justify-between text-xs font-black text-[var(--bk-success-text)]",
  correctionText: "text-[13px] font-semibold leading-relaxed text-[var(--bk-ink)]",
  correctionSources: "mt-3 border-t-[3px] border-[var(--bk-line)] pt-3",
  telemetryWrap: "mt-3",
  composer:
    "shrink-0 border-t-[3px] border-[var(--bk-line)] bg-[var(--bk-paper)] px-5 py-4 sm:px-10",
  examples: "mb-3 flex flex-wrap gap-2",
  example: "bk-btn bk-btn--paper bk-btn--sm bk-press",
  composerBox:
    "flex items-end gap-3 border-[3px] border-[var(--bk-line)] bg-[var(--bk-paper)] p-2 pl-4 shadow-[4px_4px_0_0_var(--bk-shadow)]",
  input:
    "max-h-36 min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed text-[var(--bk-ink)] outline-none placeholder:text-[var(--bk-muted)]",
  send: "bk-btn bk-press grid h-10 w-10 shrink-0 place-items-center p-0 text-lg",
  composerNote: "mt-2 text-center text-[9px] text-[var(--bk-muted)]",
  inspector:
    "bk-card bk-frame hidden h-full max-h-[min(74vh,860px)] w-full overflow-y-auto p-5 xl:block xl:w-72",
  inspectorHead:
    "mb-3 flex items-center justify-between border-b-[3px] border-[var(--bk-line)] pb-3",
  inspectorTitle: "bk-label text-[var(--bk-insight-text)]",
  inspectorIntro: "mb-4 text-[11px] leading-relaxed text-[var(--bk-muted)]",
  contextCard:
    "bk-frame--thin mt-5 border bg-[var(--bk-insight-soft)] p-3 text-[10px] leading-relaxed text-[var(--bk-insight-text)]",
  contextValue: "font-black text-[var(--bk-insight-text)]",
  mobileNew:
    "inline-flex h-8 w-8 items-center justify-center border-2 border-[var(--bk-line)] bg-[var(--bk-brand)] text-sm font-black text-white lg:hidden",
};

/**
 * Chat is intentionally automatic. There is no model picker and no separate
 * "verify" button. Questions generate a real model answer which is checked;
 * pasted claims are checked directly. Conversations and their analysis records
 * persist locally so follow-ups have context like a normal chat product.
 */
const AUTO_SOURCE = "groq";
const CONVERSATIONS_KEY = "beta.chat.conversations.v1";
const ACTIVE_KEY = "beta.chat.activeConversation.v1";
const RUNS_KEY = "beta.chat.runs.v1";

const EXAMPLES = [
  { label: "Ask a fact", value: "When did the Berlin Wall fall?" },
  { label: "Correct a false claim", value: "The Berlin Wall fell in 1975 after the Paris Peace Accords." },
] as const;

type Verdict = "trustworthy" | "uncertain" | "needs_correction";
type ServiceStageStatus = "completed" | "skipped" | "unavailable";

interface ServiceStage {
  name: string;
  status: ServiceStageStatus;
  latency_ms?: number;
  details?: Record<string, unknown>;
}

interface EvidenceItem {
  kind: string;
  statement: string;
  detail: string;
  supports: boolean;
}

interface SignalItem {
  label: string;
  value?: number;
  detail: string;
  risk?: boolean;
}

interface FactDetail {
  id: string;
  fact: string;
  source: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  claimMode?: boolean;
  verdict?: Verdict;
  confidence?: number;
  evidence?: string[];
  evidenceItems?: EvidenceItem[];
  signalList?: SignalItem[];
  stages?: ServiceStage[];
  entities?: string[];
  referenceFacts?: string[];
  referenceFactDetails?: FactDetail[];
  correctedAnswer?: string | null;
  usedFacts?: string[];
  usedFactDetails?: FactDetail[];
  signals?: Record<string, unknown>;
  sourceMode?: "microservice" | "inprocess" | "unavailable";
  generationProvider?: string;
  generationModel?: string;
  generationLatencyMs?: number;
  verificationStatus?: "pending" | "complete" | "error";
  verificationError?: string;
  verificationNote?: string | null;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

interface RunRecord {
  id: string;
  conversationId: string;
  createdAt: string;
  question: string;
  answer: string;
  verdict: string | null;
  confidence: number | null;
  latencyMs: number | null;
  source: string;
  mode: string;
  signals?: Record<string, unknown>;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

type StageStatus = "idle" | "running" | "done" | "error" | "skipped";

interface StageItem {
  name: string;
  label: string;
  status: StageStatus;
  ms?: number;
  payload?: Record<string, unknown>;
}

const INITIAL_STAGES: StageItem[] = [
  { name: "routing", label: "Model routing & generation", status: "idle" },
  { name: "entities", label: "Entity extraction", status: "idle" },
  { name: "resampling", label: "Semantic resampling", status: "idle" },
  { name: "nli", label: "NLI claim entailment", status: "idle" },
  { name: "evidence", label: "Reference evidence", status: "idle" },
  { name: "verdict", label: "Verdict scoring", status: "idle" },
  { name: "correction", label: "Grounded correction", status: "idle" },
];

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function makeWelcome(): Message {
  return {
    id: uid("welcome"),
    role: "assistant",
    content:
      "Ask a factual question, or paste a claim. BETA generates when needed, then automatically extracts entities, resamples, checks every claim against reference facts, and rewrites anything it catches — with sources shown inline. This conversation and its analysis stay saved here.",
  };
}

function createConversation(): Conversation {
  const now = new Date().toISOString();
  return {
    id: uid("conv"),
    title: "New conversation",
    createdAt: now,
    updatedAt: now,
    messages: [makeWelcome()],
  };
}

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Conversation =>
        Boolean(
          item &&
          typeof item === "object" &&
          typeof (item as Conversation).id === "string" &&
          Array.isArray((item as Conversation).messages)
        )
      )
      .map((item) => ({
        ...item,
        title: typeof item.title === "string" ? item.title : "Conversation",
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
        messages: item.messages.filter((message) => message && typeof message.id === "string"),
      }));
  } catch {
    return [];
  }
}

function appendRunRecord(record: RunRecord) {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const existing = Array.isArray(parsed) ? parsed : [];
    localStorage.setItem(RUNS_KEY, JSON.stringify([record, ...existing].slice(0, 100)));
  } catch {
    // Local telemetry must never block the chat experience.
  }
}

function asFactDetails(value: unknown): FactDetail[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const detail = item as Record<string, unknown>;
    if (typeof detail.fact !== "string" || !detail.fact.trim()) return [];
    return [{
      id: typeof detail.id === "string" ? detail.id : "",
      fact: detail.fact,
      source: typeof detail.source === "string" && detail.source.trim()
        ? detail.source
        : "Source record unavailable",
    }];
  });
}

function factDetailsOrFallback(details: FactDetail[] | undefined, fallback: string[] | undefined): FactDetail[] {
  if (details?.length) return details;
  if (!Array.isArray(fallback)) return [];
  return fallback
    .filter((fact): fact is string => typeof fact === "string" && Boolean(fact.trim()))
    .map((fact) => ({ id: "", fact, source: "Source record unavailable" }));
}

function cleanEvidence(items: EvidenceItem[] | undefined): EvidenceItem[] {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => {
    const text = `${item?.statement ?? ""} ${item?.detail ?? ""}`;
    return !/^(reply with|format:|no other text|one line per claim|copy the claim)/i.test(text.trim());
  });
}

function isQuestion(text: string): boolean {
  return (
    text.endsWith("?") ||
    /^(what|when|where|who|why|how|which|is|are|was|were|do|does|did|can|could|would|should|will|tell me)\b/i.test(
      text
    )
  );
}

function toStageStatus(status?: string): StageStatus {
  if (status === "completed") return "done";
  if (status === "skipped" || status === "unavailable") return "skipped";
  if (status === "running") return "running";
  return "idle";
}

function formatConversationTime(value: string) {
  try {
    return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "Saved";
  }
}

/** Same navigation shell as /compare, /dashboard and /status. */
function Nav() {
  return <BkNav active="chat" />;
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [activeStages, setActiveStages] = useState<StageItem[]>(INITIAL_STAGES);
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const loaded = loadConversations();
    if (loaded.length) {
      setConversations(loaded);
      const storedId = localStorage.getItem(ACTIVE_KEY);
      setActiveId(storedId && loaded.some((item) => item.id === storedId) ? storedId : loaded[0].id);
    } else {
      const created = createConversation();
      setConversations([created]);
      setActiveId(created.id);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
    } catch {
      // Storage can be disabled; the session still works in memory.
    }
  }, [conversations, hydrated]);

  useEffect(() => {
    if (!hydrated || !activeId) return;
    try {
      localStorage.setItem(ACTIVE_KEY, activeId);
    } catch {
      // Ignore private-mode storage failures.
    }
  }, [activeId, hydrated]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? conversations[0],
    [conversations, activeId]
  );
  const messages = activeConversation?.messages ?? [];
  const contextTurnCount = messages.filter((message) => !message.id.startsWith("welcome")).length;

  useEffect(() => {
    const element = threadRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, loading, activeId]);

  function mutateConversation(id: string, update: (conversation: Conversation) => Conversation) {
    setConversations((previous) =>
      previous.map((conversation) => (conversation.id === id ? update(conversation) : conversation))
    );
  }

  function updateMessages(id: string, update: (messages: Message[]) => Message[]) {
    mutateConversation(id, (conversation) => ({
      ...conversation,
      updatedAt: new Date().toISOString(),
      messages: update(conversation.messages),
    }));
  }

  function resetStages() {
    setActiveStages(INITIAL_STAGES.map((stage) => ({ ...stage, ms: undefined, payload: undefined })));
  }

  function applyResultStages(data: Record<string, unknown>, generationMs: number) {
    const serviceStages: ServiceStage[] = Array.isArray(data.stages)
      ? (data.stages as ServiceStage[])
      : [];
    const findStage = (names: string[]) => serviceStages.find((stage) => names.includes(stage.name));
    const resampleStage = findStage(["semantic_resampling", "blackbox_resampling_nli", "gemma_sae_check"]);
    const nliStage = findStage(["nli_entailment"]);
    const correctionStage = findStage(["grounded_correction"]);
    const retrievalStage = findStage(["retrieval"]);
    const signals = (data.signals ?? {}) as Record<string, unknown>;
    const entities = Array.isArray(data.entities) ? data.entities : [];

    setActiveStages(
      INITIAL_STAGES.map((stage, index) => {
        if (index === 0) {
          return {
            ...stage,
            status: "done",
            ms: generationMs,
            payload: { source: data.mode ?? AUTO_SOURCE },
          };
        }
        if (index === 1) {
          return { ...stage, status: "done", payload: { entities: entities.length } };
        }
        if (index === 2) {
          return {
            ...stage,
            status: resampleStage ? toStageStatus(resampleStage.status) : "done",
            ms: resampleStage?.latency_ms,
            payload: {
              consistency: signals.resample_consistency ?? null,
              samples: signals.resample_samples ?? null,
              clusters: signals.meaning_clusters ?? null,
            },
          };
        }
        if (index === 3) {
          return {
            ...stage,
            status: nliStage ? toStageStatus(nliStage.status) : "done",
            ms: nliStage?.latency_ms,
            payload: {
              claims: signals.claims_checked ?? null,
              contradicted: signals.contradicted_claims ?? null,
            },
          };
        }
        if (index === 4) {
          return {
            ...stage,
            status:
              Number(signals.reference_premises ?? 0) > 0 || retrievalStage?.status === "completed"
                ? "done"
                : "skipped",
            ms: retrievalStage?.latency_ms,
            payload: { premises: signals.reference_premises ?? 0 },
          };
        }
        if (index === 5) {
          return {
            ...stage,
            status: "done",
            payload: { verdict: data.verdict ?? null, confidence: data.confidence ?? null },
          };
        }
        return {
          ...stage,
          status: correctionStage ? toStageStatus(correctionStage.status) : "skipped",
          ms: correctionStage?.latency_ms,
          payload: { corrected: Boolean(data.corrected_answer) },
        };
      })
    );
  }

  async function runQuery(raw: string) {
    const question = raw.trim();
    const conversationId = activeConversation?.id;
    if (!question || !conversationId || loading) return;

    const claimMode = !isQuestion(question);
    const startedAt = Date.now();
    const assistantId = uid("answer");
    const contextTurns: ChatTurn[] = messages
      .filter(
        (message) =>
          !message.id.startsWith("welcome") &&
          (message.role === "user" || message.role === "assistant") &&
          Boolean(message.content.trim())
      )
      .slice(-8)
      .map((message) => ({
        role: message.role,
        content: (message.correctedAnswer ?? message.content).slice(0, 1200),
      }));

    setInput("");
    setLoading(true);
    resetStages();

    mutateConversation(conversationId, (conversation) => ({
      ...conversation,
      updatedAt: new Date().toISOString(),
      title:
        conversation.title === "New conversation"
          ? question.length > 46
            ? `${question.slice(0, 46)}…`
            : question
          : conversation.title,
      messages: [
        ...conversation.messages,
        { id: uid("user"), role: "user" as const, content: question },
        {
          id: assistantId,
          role: "assistant" as const,
          content: claimMode ? question : "",
          claimMode,
          verificationStatus: "pending" as const,
        },
      ],
    }));

    let generatedAnswer = question;
    let usageProof: unknown = null;
    let generationMeta: Partial<Message> = {};
    let generationMs = 0;

    setActiveStages((stages) =>
      stages.map((stage, index) => {
        if (index === 0) return { ...stage, status: "running" as const };
        return stage;
      })
    );

    try {
      if (!claimMode) {
        const generationRes = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: question, model: AUTO_SOURCE, history: contextTurns }),
        });
        const generationData = await generationRes.json();
        if (!generationRes.ok) {
          throw new Error(generationData.error || `Generation failed (${generationRes.status}).`);
        }
        if (typeof generationData.answer !== "string" || !generationData.answer.trim()) {
          throw new Error("The model returned an empty response.");
        }

        generatedAnswer = generationData.answer;
        usageProof = generationData.usage_proof ?? null;
        generationMs =
          typeof generationData.latency_ms === "number" ? generationData.latency_ms : Date.now() - startedAt;
        generationMeta = {
          content: generatedAnswer,
          generationProvider: generationData.provider,
          generationModel: generationData.model,
          generationLatencyMs: generationMs,
        };

        updateMessages(conversationId, (previous) =>
          previous.map((message) => (message.id === assistantId ? { ...message, ...generationMeta } : message))
        );
      }

      setActiveStages((stages) =>
        stages.map((stage, index) => {
          if (index === 0) {
            return {
              ...stage,
              status: "done" as const,
              ms: claimMode ? 0 : generationMs,
              payload: claimMode
                ? { mode: "claim_check", source: AUTO_SOURCE }
                : { provider: generationMeta.generationProvider, model: generationMeta.generationModel },
            };
          }
          if (index === 2 || index === 3) return { ...stage, status: "running" as const };
          return stage;
        })
      );

      const checkRes = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: generatedAnswer,
          source: AUTO_SOURCE,
          question: claimMode ? `Is this claim accurate? ${question}` : question,
          context: contextTurns,
          ...(usageProof ? { generation_usage: { proof: usageProof } } : {}),
        }),
      });
      const data = await checkRes.json();
      if (!checkRes.ok) {
        throw new Error(data.message || data.error || `Verification failed (${checkRes.status}).`);
      }

      const verified: Message = {
        id: assistantId,
        role: "assistant",
        content: generatedAnswer,
        claimMode,
        ...generationMeta,
        verdict: data.verdict,
        confidence: data.confidence,
        evidence: Array.isArray(data.evidence) ? data.evidence : [],
        evidenceItems: cleanEvidence(data.evidenceItems),
        signalList: Array.isArray(data.signalList) ? data.signalList : [],
        stages: Array.isArray(data.stages) ? data.stages : [],
        entities: Array.isArray(data.entities) ? data.entities : [],
        referenceFacts: Array.isArray(data.referenceFacts) ? data.referenceFacts : [],
        referenceFactDetails: asFactDetails(data.reference_fact_details),
        correctedAnswer: data.corrected_answer ?? null,
        usedFacts: Array.isArray(data.used_facts)
          ? data.used_facts
          : Array.isArray(data.retrieved_facts)
            ? data.retrieved_facts
            : [],
        usedFactDetails: asFactDetails(data.used_fact_details),
        signals: data.signals ?? {},
        sourceMode: data.mode,
        verificationStatus: "complete",
        verificationNote: data.retrieval_error ?? null,
      };

      updateMessages(conversationId, (previous) =>
        previous.map((message) => (message.id === assistantId ? verified : message))
      );
      applyResultStages(data as Record<string, unknown>, generationMs);

      appendRunRecord({
        id: assistantId,
        conversationId,
        createdAt: new Date().toISOString(),
        question,
        answer: generatedAnswer,
        verdict: typeof data.verdict === "string" ? data.verdict : null,
        confidence: typeof data.confidence === "number" ? data.confidence : null,
        latencyMs: Date.now() - startedAt,
        source: AUTO_SOURCE,
        mode: typeof data.mode === "string" ? data.mode : "inprocess",
        signals: data.signals ?? {},
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed.";
      updateMessages(conversationId, (previous) =>
        previous.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                verificationStatus: "error",
                verificationError: message,
                content: item.content || "The firewall could not finish this request.",
              }
            : item
        )
      );
      setActiveStages((stages) =>
        stages.map((stage) => ({
          ...stage,
          status: stage.status === "running" ? ("error" as const) : stage.status,
        }))
      );
    } finally {
      setLoading(false);
    }
  }

  function newChat() {
    const created = createConversation();
    setConversations((previous) => [created, ...previous]);
    setActiveId(created.id);
    setInput("");
    resetStages();
  }

  function selectConversation(id: string) {
    if (id === activeId) return;
    setActiveId(id);
    setInput("");
    resetStages();
  }

  function deleteConversation(id: string) {
    setConversations((previous) => {
      const remaining = previous.filter((conversation) => conversation.id !== id);
      if (remaining.length === 0) {
        const created = createConversation();
        setActiveId(created.id);
        return [created];
      }
      if (id === activeId) setActiveId(remaining[0].id);
      return remaining;
    });
    resetStages();
  }

  function renderFactList(facts: FactDetail[], emptyLabel: string) {
    if (facts.length === 0) {
      return <p className={styles.muted}>{emptyLabel}</p>;
    }
    return (
      <ul className={styles.factList}>
        {facts.slice(0, 5).map((fact, index) => (
          <li key={`${fact.id || "fact"}-${index}`} className={styles.factItem}>
            <span className={styles.factId}>F{index + 1}</span>
            <span>
              <span className={styles.factSource}>{fact.source}</span>
              {" — "}
              {fact.fact}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  const sortedConversations = [...conversations].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <div className={styles.shell}>
      <Nav />

      <main className="relative z-10 mx-auto w-full max-w-[1600px] px-5 pb-16 pt-8 sm:px-8">
        <header className="rise-in mb-7 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="bk-eyebrow">Protected workspace · chat</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-[var(--bk-ink)] sm:text-4xl">
              Ask a question. Get a verified answer.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--bk-muted)]">
              Real model generation, automatic claim checks, cited corrections, and saved context — in one
              conversation.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/compare" className="bk-btn bk-btn--paper bk-press">
              Compare models →
            </Link>
            <Link href="/dashboard" className="bk-btn bk-btn--paper bk-press">
              Dashboard
            </Link>
            <Link href="/status" className="bk-btn bk-btn--paper bk-press">
              Status
            </Link>
          </div>
        </header>

        <div className="grid items-start gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)_18rem]">
          <aside className={styles.sidebar} aria-label="Chat navigation">
        <div className={styles.brandRow}>
          <div className={styles.brandMark}>
            <img src="/beta-mark.png" alt="" width={36} height={36} aria-hidden="true" />
          </div>
          <div>
            <div className={styles.brandName}>BETA</div>
            <div className={styles.brandSub}>Firewall workspace</div>
          </div>
        </div>

        <button type="button" className={styles.newChat} onClick={newChat}>
          <span aria-hidden="true">＋</span> New chat
        </button>

        <div className={styles.sectionLabel}>Conversations</div>
        <div className={styles.convList}>
          {sortedConversations.map((conversation) => {
            const isActive = conversation.id === activeConversation?.id;
            return (
              <div
                key={conversation.id}
                className={`${styles.convItem} ${isActive ? styles.convActive : ""}`}
              >
                <button
                  type="button"
                  className={styles.convButton}
                  onClick={() => selectConversation(conversation.id)}
                >
                  <span className={styles.convTitle}>{conversation.title}</span>
                  <span className={styles.convMeta}>
                    {conversation.messages.length} messages · {formatConversationTime(conversation.updatedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.convDelete}
                  aria-label={`Delete ${conversation.title}`}
                  title="Delete conversation"
                  onClick={() => deleteConversation(conversation.id)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
          </aside>

          <section className={styles.main}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <button type="button" className={styles.mobileNew} onClick={newChat} aria-label="New chat">
              ＋
            </button>
            <span className={`${styles.liveDot} ${loading ? styles.liveDotBusy : ""}`} />
            <div className={styles.headerLeft}>
              <span className={styles.headerTitle}>Auto Firewall</span>
              <span className={styles.headerHint}>Groq → OpenRouter fallback · context saved locally</span>
            </div>
          </div>
          <div className={styles.headerActions}>
            <span className={styles.pill}>{contextTurnCount} context turns</span>
            <button
              type="button"
              className={`${styles.toggle} ${inspectorOpen ? "" : styles.toggleOff}`}
              onClick={() => setInspectorOpen((value) => !value)}
            >
              Inspector {inspectorOpen ? "on" : "off"}
            </button>
          </div>
        </header>

        <div className={styles.thread} ref={threadRef}>
          <div className={styles.dayLabel}>Protected conversation</div>

          {messages.map((message) => {
            if (message.role === "user") {
              return (
                <div key={message.id} className={styles.rowUser}>
                  <div className={styles.bubbleUser}>{message.content}</div>
                </div>
              );
            }

            const referenceFacts = factDetailsOrFallback(message.referenceFactDetails, message.referenceFacts);
            const usedFacts = factDetailsOrFallback(message.usedFactDetails, message.usedFacts);
            const evidence = cleanEvidence(message.evidenceItems);
            const hasAnalysis = Boolean(
              message.verdict ||
              message.stages?.length ||
              message.entities?.length ||
              evidence.length ||
              message.correctedAnswer
            );
            const engineLabel =
              message.sourceMode === "inprocess"
                ? "LIVE NLI ENGINE"
                : message.sourceMode
                  ? message.sourceMode.toUpperCase()
                  : "VERIFYING";

            return (
              <div key={message.id} className={styles.rowAssistant}>
                <div className={styles.avatar} aria-hidden="true">
                  <img src="/beta-mark.png" alt="" width={32} height={32} aria-hidden="true" />
                </div>
                <div className={styles.assistantBody}>
                  <div className={styles.bubbleAssistant}>
                    <div className={message.content ? "" : styles.draftText}>
                      {message.content || "Drafting a real model answer…"}
                    </div>

                    {message.claimMode && (
                      <div className={styles.metaLine}>CLAIM MODE · checked directly</div>
                    )}

                    {message.generationProvider && (
                      <div className={styles.metaLine}>
                        Generated by {message.generationProvider}
                        {message.generationModel ? ` · ${message.generationModel}` : ""}
                        {message.generationLatencyMs != null ? ` · ${message.generationLatencyMs}ms` : ""}
                      </div>
                    )}

                    {message.verificationStatus === "pending" && (
                      <div className={styles.statusLine} role="status">
                        Running the firewall — extracting entities, resampling, and checking claims…
                      </div>
                    )}
                    {message.verificationStatus === "error" && message.verificationError && (
                      <div className={styles.errorLine} role="alert">
                        Request failed: {message.verificationError}
                      </div>
                    )}
                    {message.verificationNote && (
                      <div className={styles.errorLine} role="status">
                        {message.verificationNote}
                      </div>
                    )}
                  </div>

                  {hasAnalysis && (
                    <div className={styles.analysis}>
                      <div className={styles.analysisHead}>
                        <span className={styles.analysisTitle}>Detector analysis</span>
                        <div className={styles.verdictRow}>
                          {message.verdict ? (
                            <>
                              <VerdictChip verdict={message.verdict} confidence={message.confidence} size="sm" />
                              {message.confidence != null && (
                                <ConfidenceRing value={message.confidence} size={30} strokeWidth={3} />
                              )}
                            </>
                          ) : null}
                          <span className={styles.engineTag}>{engineLabel}</span>
                        </div>
                      </div>

                      <div className={styles.analysisGrid}>
                        {message.entities && message.entities.length > 0 && (
                          <div className={styles.analysisBlock}>
                            <div className={styles.blockLabel}>Entities detected</div>
                            <div className={styles.tagRow}>
                              {message.entities.slice(0, 8).map((entity) => (
                                <span key={entity} className={styles.tag}>{entity}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {evidence.length > 0 ? (
                          <div className={styles.analysisBlock}>
                            <div className={styles.blockLabel}>Claim-level evidence</div>
                            <ul className={styles.evidenceList}>
                              {evidence.slice(0, 5).map((item, index) => (
                                <li key={`${item.statement}-${index}`} className={styles.evidenceItem}>
                                  <span className={item.supports ? styles.evidenceYes : styles.evidenceNo}>
                                    {item.supports ? "✓" : "✗"}
                                  </span>
                                  <span>
                                    {item.statement}
                                    {item.detail && (
                                      <span className={styles.evidenceDetail}>{item.detail}</span>
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : message.evidence && message.evidence.length > 0 ? (
                          <div className={styles.analysisBlock}>
                            <div className={styles.blockLabel}>Evidence</div>
                            <ul className={styles.evidenceList}>
                              {message.evidence.slice(0, 5).map((item, index) => (
                                <li key={index} className={styles.evidenceItem}>· {item}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {referenceFacts.length > 0 && (
                          <div className={styles.analysisBlock}>
                            <div className={styles.blockLabel}>Reference premises</div>
                            {renderFactList(referenceFacts, "")}
                          </div>
                        )}
                      </div>

                      {message.correctedAnswer && (
                        <div className={styles.correction}>
                          <div className={styles.correctionHead}>
                            <span>✓ Grounded correction</span>
                            <span>Verified</span>
                          </div>
                          <div className={styles.correctionText}>{message.correctedAnswer}</div>
                          <div className={styles.correctionSources}>
                            <div className={styles.blockLabel}>Source of correction</div>
                            {renderFactList(
                              usedFacts,
                              "No source record was attached to this correction."
                            )}
                          </div>
                        </div>
                      )}

                      {message.stages && message.stages.length > 0 && (
                        <div className={styles.telemetryWrap}>
                          <FirewallTelemetry
                            stages={message.stages}
                            signalList={message.signalList}
                            mode={message.sourceMode}
                            compact
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {loading && (
            <div className={styles.rowAssistant} aria-live="polite">
              <div className={styles.avatar} aria-hidden="true">
                <img src="/beta-mark.png" alt="" width={32} height={32} aria-hidden="true" />
              </div>
              <div className={styles.bubbleAssistant}>
                <span className={styles.draftText}>Pipeline is running…</span>
              </div>
            </div>
          )}
        </div>

        <div className={styles.composer}>
          <div className={styles.examples}>
            {EXAMPLES.map((example) => (
              <button
                key={example.value}
                type="button"
                className={styles.example}
                disabled={loading}
                onClick={() => void runQuery(example.value)}
              >
                {example.label}: “{example.value}”
              </button>
            ))}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void runQuery(input);
            }}
          >
            <div className={styles.composerBox}>
              <textarea
                className={styles.input}
                value={input}
                rows={1}
                placeholder="Ask a question, or paste a claim to check…"
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void runQuery(input);
                  }
                }}
              />
              <button
                type="submit"
                className={styles.send}
                disabled={loading || !input.trim()}
                aria-label="Send message"
              >
                ↑
              </button>
            </div>
          </form>
          <div className={styles.composerNote}>
            Every answer is generated live and checked automatically. Enter sends · Shift+Enter adds a line.
          </div>
          </div>
        </section>

        {inspectorOpen && (
          <aside className={styles.inspector} aria-label="Live pipeline inspector">
            <div className={styles.inspectorHead}>
              <span className={styles.inspectorTitle}>Live pipeline</span>
              <span className={`${styles.liveDot} ${loading ? styles.liveDotBusy : ""}`} />
            </div>
            <p className={styles.inspectorIntro}>
              Stage timings and detector measurements come from the live response. Nothing is pre-baked, and
              every answer in this conversation keeps its own analysis.
            </p>
            <StageStepper stages={activeStages} />
            <div className={styles.contextCard}>
              Conversation memory: <span className={styles.contextValue}>{contextTurnCount} turns</span>
              <br />
              Follow-up questions are sent with the last eight turns so the model understands “it”, “that”,
              and “what about…”.
            </div>
          </aside>
        )}
        </div>
      </main>
    </div>
  );
}
