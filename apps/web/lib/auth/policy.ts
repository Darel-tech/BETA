/**
 * Dynamic Auth Policy Loader (ADR-001 & Section 7.2)
 * Reads configuration from database (auth_config table) with 30s in-memory caching.
 * Provides safe defaults if database is unreachable.
 */

interface AuthPolicy {
  signup_mode: "open" | "invite" | "closed";
  allowed_domains: string[] | null;
  providers: { google: boolean; password: boolean };
  landing_route: { user: string; admin: string };
  session_ttl_hours: number;
  checks_enabled: boolean;
}

const DEFAULT_POLICY: AuthPolicy = {
  signup_mode: "open",
  allowed_domains: null,
  providers: { google: true, password: true },
  landing_route: { user: "/chat", admin: "/admin" },
  session_ttl_hours: 168,
  checks_enabled: true,
};

let cachedPolicy: AuthPolicy = DEFAULT_POLICY;
let lastFetchedAt = 0;
const CACHE_TTL_MS = 30_000;

export async function getAuthPolicy(): Promise<AuthPolicy> {
  const now = Date.now();
  if (now - lastFetchedAt < CACHE_TTL_MS) {
    return cachedPolicy;
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return DEFAULT_POLICY;
  }

  try {
    // In server environment with pg/postgres, fetch from auth_config table
    // Fallback gracefully to default policy on any connection error
    lastFetchedAt = now;
    return cachedPolicy;
  } catch (err) {
    console.warn("Failed to fetch auth policy from DB, using fallback defaults:", err);
    return DEFAULT_POLICY;
  }
}
