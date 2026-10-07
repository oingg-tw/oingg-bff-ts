import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}


export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  isProduction: (process.env.NODE_ENV ?? "development") === "production",
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
 * 全站總上限，**以單一 instance 計**（2026-10-08，使用者依 conductor 的《SaaS 系統架構之全站請求速率限制與
 * 存取日誌留存策略研究報告》選定）。限流器的計數存在各 instance 的記憶體裡，所以「全站」實際上是「每台」——
 * 而這正好對應保護的對象：每台自己的 10 條 DB 連線。Cloud Run 會分流，4 台（max-instances）合計約 15,000 RPM，
 * 落在報告建議的初創期 6,000～18,000 RPM 區間。不需要 Redis 這類共用計數器。
 *
 * 推導：報告的 Limit = Capacity × α × 60。2026-10-05 壓測量到「驗證＋一次 DB 查詢」單台約 92 req/s（瓶頸是
 * pg pool 的 10 條連線，CPU 只到 27%），α 取 0.70 → 92 × 0.70 × 60 ≈ 3,800。
 *
 * **這是校正旋鈕，不是常數**：92 req/s 是在本機量的（到新加坡的 Neon 有 ~60ms 往返），部署端與 Neon 同城，
 * 實際容量只會更高。在 DEV 實測後用 GLOBAL_RATE_LIMIT_PER_INSTANCE 調整，不必改程式。
 */
export const GLOBAL_RATE_LIMIT_PER_INSTANCE = Number(process.env.GLOBAL_RATE_LIMIT_PER_INSTANCE ?? 3_800);

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
