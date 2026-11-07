/**
 * In-memory prompt cache and daily limit tracker.
 * Avoids duplicate external calls and keeps samples <= 5.
 */

interface CacheEntry {
  result: string;
  timestamp: number;
}

const promptCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Daily limit tracker per provider
const dailyUsage = new Map<string, { count: number; date: string }>();
const MAX_DAILY_CALLS = 200; // safe free limit

function getTodayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getCachedPrompt(provider: string, model: string, prompt: string): string | null {
  const key = `${provider}:${model}:${prompt.trim()}`;
  const entry = promptCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    promptCache.delete(key);
    return null;
  }
  return entry.result;
}

export function setCachedPrompt(provider: string, model: string, prompt: string, result: string): void {
  const key = `${provider}:${model}:${prompt.trim()}`;
  promptCache.set(key, { result, timestamp: Date.now() });
}

export function checkAndIncrementDailyLimit(provider: string): { allowed: boolean; remaining: number } {
  const today = getTodayString();
  const current = dailyUsage.get(provider);

  if (!current || current.date !== today) {
    dailyUsage.set(provider, { count: 1, date: today });
    return { allowed: true, remaining: MAX_DAILY_CALLS - 1 };
  }

  if (current.count >= MAX_DAILY_CALLS) {
    return { allowed: false, remaining: 0 };
  }

  current.count += 1;
  return { allowed: true, remaining: MAX_DAILY_CALLS - current.count };
}

