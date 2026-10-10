/**
 * 回應欄位改名的並存期（2026-10-10 起，跟著 analysis-ts 批次 2a 的統一用語改名；使用者核准、對 web-nuxt 並存 14 天）。
 *
 * 業務中台的型別、normalizer 與 OpenAPI 已經只用新名；這裡在送出前把**舊名當別名補回去**（值相同），讓 web-nuxt
 * 在改完之前不會讀到 undefined。集中在一張表、一個地方，而不是在十幾個型別裡各自複製欄位——web-nuxt 確認改完後，
 * 刪掉這個檔案與 routes.ts 裡掛它的那幾行即可。
 *
 * 只在物件**有新名、沒有舊名**時補；遞迴走整個回應（包括 /metrics 徽章門檻裡的 topPct）。新名清單 2026-10-10 掃過，
 * 業務中台沒有任何同名但意思不同的欄位。
 */
const LEGACY_NAME_BY_NEW_NAME: Readonly<Record<string, string>> = {
  yoyChangePct: "yoyChangePercent",
  momChangePct: "momChangePercent",
  cumulativeChangePct: "cumulativeChangePercent",
  changePct: "changePercent",
  sixDayChangePct: "sixDayChangePercent",
  topPct: "topPercent",
  sharesHeldPct: "sharesHeldPercent",
  foreignLimitPct: "foreignLimitPercent",
  availableInvestPct: "availableInvestPercent",
  sharesChangePct: "sharesChangePercent",
  m1aYoyPct: "m1aYoyPercent",
  m1bYoyPct: "m1bYoyPercent",
  m2YoyPct: "m2YoyPercent",
  avgTaiexYoyPct: "avgTaiexYoyPercent",
  numberOfSharesIssued: "paidInShares",
};

export function withLegacyResponseKeys(body: unknown): unknown {
  if (Array.isArray(body)) {
    return body.map(withLegacyResponseKeys);
  }
  if (body === null || typeof body !== "object" || body instanceof Date) {
    return body;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    out[key] = withLegacyResponseKeys(value);
  }
  for (const [current, legacy] of Object.entries(LEGACY_NAME_BY_NEW_NAME)) {
    if (current in out && !(legacy in out)) {
      out[legacy] = out[current];
    }
  }
  return out;
}
