import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Frontend dev server default. Add more with a comma-separated CORS_ORIGINS env var.
const DEFAULT_CORS_ORIGINS = "http://localhost:3000";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  isProduction: (process.env.NODE_ENV ?? "development") === "production",
  corsOrigins: (process.env.CORS_ORIGINS ?? DEFAULT_CORS_ORIGINS)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};

/**
 * bff-ts's entire purpose is fronting exactly one upstream dependency (analysis-ts) — every outbound
 * `fetch()` to it must be bounded, or a single stalled analysis-ts request hangs indefinitely and takes
 * the corresponding bff-ts request down with it (no isolation, since there's nothing else in the way).
 * Applied via `signal: AbortSignal.timeout(ANALYSIS_SERVICE_TIMEOUT_MS)` in each *.client.ts file that
 * calls analysis-ts. 10s is generous for a same-region HTTP call but still a real bound.
 */
export const ANALYSIS_SERVICE_TIMEOUT_MS = 10_000;

/**
 * Applied globally (see routes.ts) as a first, IP-based line of defense — bff-ts has no rate limiting
 * at all otherwise. 300 req/min is generous enough not to bother a real user or the screener's normal
 * polling, but bounds worst-case load on analysis-ts (bff-ts's only upstream) from any single source.
 */
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 300;

/**
 * 寄信的對外呼叫也要有界限，理由跟 ANALYSIS_SERVICE_TIMEOUT_MS 一樣：沒有上限的話，供應商一次卡住就
 * 把對應的 bff-ts 請求一起拖死。寄信比讀取更該短——它會掛在排程任務或使用者操作的後面，而一封提醒信
 * 晚幾秒送出沒有任何代價，卡住 30 秒卻會讓整批提醒逾時。
 */
export const EMAIL_TIMEOUT_MS = 8_000;

/**
 * Reverse trial: every user gets the full paid experience for their first 14 days, with no card. It's
 * measured from the User row's `createdAt`, so nothing is stored per trial and nothing can expire
 * halfway through a session. A live constant rather than an env var — changing it should move everyone
 * at once, and a per-environment trial length would make support tickets unreproducible.
 */
export const REVERSE_TRIAL_DAYS = 14;
export const REVERSE_TRIAL_TIER = "PRO" as const;

/**
 * **Temporary Phase 0 scaffolding — delete when NewebPay is wired.** Comma-separated Firebase uids that
 * get PRO without a Subscription row, so the paywall's behaviour can be built and tested before a
 * payment provider exists. Absent/empty means nobody, which is the safe default: a typo grants nothing
 * rather than everything. The resulting entitlement reports `source: "allowlist"` so an entry left in a
 * production env is visible in the API response instead of silently handing out access.
 */
export const BILLING_PAID_UID_ALLOWLIST: readonly string[] = (process.env.BILLING_PAID_UIDS ?? "")
  .split(",")
  .map((uid) => uid.trim())
  .filter(Boolean);

export { requireEnv };
