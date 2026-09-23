import type { BillingTier, QuotaResource } from "@/application/billing/billing.types.js";

/**
 * Per-tier limits, hardcoded as live constants rather than stored per user — a limit change should take
 * effect for everyone at once instead of requiring a backfill (same rule as SYSTEM_DEFAULT_THEME).
 * `null` means unlimited.
 *
 * Free's watchlist cap of 10 comes from the subscription spec; the two preset caps are provisional
 * placeholders. Prices live nowhere in this repo on purpose (they're still being validated) — only the
 * shape of what a tier may limit lives here.
 *
 * **What may appear in this table is constrained by 投信投顧法, not by product taste.** Only three
 * dimensions may ever differ between tiers:
 *   1. 查詢廣度   — how many things a user may save or track (this table)
 *   2. 歷史深度   — whether an extra data dimension exists at all (not the precision of a shown number).
 *                   **目前這個維度幾乎無貨可賣，訂方案前先看這裡**（2026-09-24 實測）：季度指標
 *                   （metric-history／roe／roa／dupont）上游一律只有 24 季（2020Q3→2026Q2），
 *                   月營收 60 個月，對免費與付費是同一個天花板——沒有「更深的歷史」可以解鎖。
 *                   股利歷史更不平均：大型股 7–9 年，但全市場隨機抽 20 家平均只有 1.9 年、多數 0–1 年。
 *                   **深度逐檔不同，而且大部分不是任何人的 bug**（2026-09-24 由 analysis-ts 逐季對帳）：
 *                   約 23% 的公司連 24 季都沒有（9910 豐泰上市 34 年卻只有 9 季），但其中 97% 是
 *                   **mops 上游那幾季根本沒有損益表**——上市年齡跟 mops 的 XBRL 收錄深度是兩件事。
 *                   隨 mops 持續補收錄會自己變好，不需要我們做什麼。
 *                   剩下約 3%（全市場約 90 家）是「某幾季只申報個體報表」，而 resolveDataType 一家
 *                   公司只給一個口徑，所以那幾季沒有值；修不修是語意問題（同一條曲線混個體與合併
 *                   會出現無法解釋的跳動），使用者未定案。
 *                   結論對定價不變：**深度無法承諾、只能逐檔標示實際季數**，而且短的那些多半補不了。
 *                   所以「解鎖更長歷史」這種賣點目前對多數個股是空的，硬寫進結帳頁等於不實陳述
 *                   （web-nuxt 的 persona 訪談裡，retiree-03 明說若實際深度不符會七天內退費並公開講，
 *                   而七天無條件退費是我們已經承諾的）。要賣這個維度，得先等上游把歷史補深。
 *   3. 匯出/推播  — CSV/Excel/PDF export, alerts, scheduled reports
 *
 * Anything that changes the *analysis a user sees about a company they already chose* is forbidden:
 * gating badge pass counts, valuation-river percentiles, the DuPont breakdown, provenance panels or
 * raw statements would make the price list itself evidence that what's sold is 分析意見 rather than
 * data access (第4條's 報酬 element; 第107條 is criminal). The 四方力道 first-instance judgment treated
 * "價金是否與分析功能掛鉤" as exactly that evidence.
 *
 * Two consequences that are easy to re-introduce by accident, so they're written down here:
 * - **Screener result lists are never truncated by tier.** The old "visible top rows" idea was killed
 *   on 2026-09-13: showing a free user only the top N reads as a platform-curated recommendation list,
 *   which is worse than the conversion it would buy. Same for the KY-stock section — a disclosure list
 *   must always be complete.
 * - **Downgrade makes things read-only, never deleted.** A user who drops to FREE with 30 watchlist
 *   items keeps all 30 visible; they simply can't add more. Destroying what a user built would both
 *   break the endowment effect the funnel relies on and look like punishment.
 */
const TIER_QUOTAS: Readonly<Record<BillingTier, Readonly<Record<QuotaResource, number | null>>>> = {
  FREE: {
    /**
     * **這條線是承重牆，改之前先問。** 原本它只是規格裡的一個數字，2026-09-24 的 persona 訪談把它變成
     * 付費牆的主要支柱：歷史深度（見上面）實測幾乎無貨可賣，三個可鎖維度只剩兩個，而「匯出推播」那支
     * 功能還沒實作——所以現在真正在驅動付費的就是這一條。
     * 訪談裡 ext-03（替母親付費的兒子，母親持股 17 檔）明說放寬到 20 檔他的付費理由就消失。
     * 也就是說 10 與 20 之間不是「寬鬆一點」的差別，是「有沒有人要付錢」的差別。
     */
    watchlistItems: 10,
    screenerPresets: 3,
    columnPresets: 3,
  },
  PRO: {
    watchlistItems: null,
    screenerPresets: null,
    columnPresets: null,
  },
  ADVISOR: {
    watchlistItems: null,
    screenerPresets: null,
    columnPresets: null,
  },
};

/** Human-readable resource names for the 403 message — the frontend keys off `code`/`details`, not this. */
export const QUOTA_RESOURCE_LABELS: Readonly<Record<QuotaResource, string>> = {
  watchlistItems: "watchlist items",
  screenerPresets: "saved screener presets",
  columnPresets: "saved column presets",
};

export function quotaLimitFor(resource: QuotaResource, tier: BillingTier): number | null {
  return TIER_QUOTAS[tier][resource];
}
