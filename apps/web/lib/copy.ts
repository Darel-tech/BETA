/**
 * Centralized UX copy strings for BETA
 * Section 10.8 in ANTIGRAVITY_BRIEF.md
 * No hardcoded strings in components.
 */

export const COPY = {
  brand: {
    name: "BETA",
    tagline: "A Hallucination Firewall",
    subtitle: "SAE Interpretability & Semantic Entropy",
  },
  landing: {
    h1: "Know when your AI is making things up.",
    sub: "BETA checks every answer as it is written, using the model's own internals or its behaviour, and shows you the proof.",
    primaryCta: "Start checking free",
    secondaryCta: "See how it works",
    demoBadge: "Demo data. Connect a service to see live results.",
    metricsHeading: "Real Evaluation Metrics",
    howItWorksHeading: "How BETA Works",
  },
  auth: {
    welcomeBack: "Welcome back",
    signInSubtitle: "Sign in to continue to BETA",
    createAccount: "Create your account",
    createAccountSubtitle: "Start monitoring LLM truthfulness",
    emailLabel: "Email address",
    emailPlaceholder: "name@example.com",
    passwordLabel: "Password",
    passwordPlaceholder: "Enter your password",
    forgotPassword: "Forgot password?",
    rememberMe: "Remember me for 30 days",
    signInButton: "Sign in",
    signUpButton: "Create account",
    continueWithGoogle: "Continue with Google",
    dividerText: "or continue with",
    invalidCredentials: "That email or password doesn't match. Check them and try again, or reset your password.",
    consentTitle: "Before you start",
    consentBody: "We record your email and how you use BETA (which checks you run, and when) so admins can keep the service running and fair. Closed-model answers are processed by Google and external inference providers. Your chat text stays private unless an admin reviews it for a stated reason, and every review is logged. You can export or delete your data in Settings.",
    consentAgree: "Agree and continue",
    consentDecline: "Not now",
  },
  chat: {
    composerPlaceholder: "Ask anything. BETA will check the answer.",
    emptyState: "No messages yet. Ask a question to see BETA check the answer live.",
    checkingState: "Checking this answer…",
    correctButton: "Correct with sources",
    correctionSuccess: (count: number) => `Answer updated using ${count} verified sources. See what changed.`,
    rateLimit: "You've reached today's check limit. It resets at midnight, or ask an admin to raise it.",
    suspended: "This account is paused. Contact an admin to restore access.",
  },
  verdict: {
    trustworthy: "Trustworthy",
    uncertain: "Uncertain",
    needsCorrection: "Needs correction",
    tooltips: {
      trustworthy: "Internal SAE features and consistency agree the factual claims are grounded.",
      uncertain: "High semantic entropy or ambiguous latent state detected. Claims may be unverified.",
      needsCorrection: "Retrieved authoritative evidence directly contradicts the generated claim.",
    },
  },
  errors: {
    serviceDown: "The detection service isn't responding. Other checks still work. Retry or see status.",
    generic: "An unexpected error occurred. Please try again.",
  },
} as const;
