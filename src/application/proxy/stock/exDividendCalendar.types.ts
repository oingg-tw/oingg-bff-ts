import type { ExDividendNoticeEntry } from "@/application/proxy/stock/exDividendNotices.types.js";

/**
 * "announced" = a TWSE/TPEx advance notice for an ex-date >= today; "realized" = an actual MOPS dividend
 * distribution for an ex-date < today. Added by analysis-ts 2026-09-22 (cf1b752e) when the calendar
 * gained past-month coverage — before that every entry was implicitly an announcement.
 */
export type ExDividendCalendarStatus = "announced" | "realized";

/**
 * Same fields as ExDividendNoticeEntry (one entry = one company's one ex-dividend/ex-rights event), plus
 * `symbol`/`companyName` since this is a flat market-wide list, not grouped per symbol like
 * GET /stocks/ex-dividend-notices. `companyName` stays nullable for safety, but upstream now fills it for
 * ETFs too — 2026-09-30 re-measured 396/396 ETF rows across 2026-06~09 all have a name. (The old note here
 * said analysis-ts's company reference table didn't cover ETFs, measured 2026-09-10 on 00939/00984D; that
 * stopped being true at some point in between and nobody noticed, because a stale "this is always null"
 * note costs nothing until someone builds on it.)
 *
 * `status`/`paymentDate`/`fiscalYear` (2026-09-22): the two statuses come from different upstream sources
 * and carry different fields — `paymentDate`/`fiscalYear` are only populated on "realized" rows, and on
 * those rows the rights-offering fields inherited from ExDividendNoticeEntry (subscriptionRatio,
 * subscriptionPricePerShare, sharesOffered, sharesEmpOwner, sharesholderOwner, stockHoldingRatio) are
 * always null (MOPS distribution records don't carry them). Confirmed live on 2026-08 (268 realized rows)
 * vs. 2026-10 (17 announced rows).
 */
export interface ExDividendCalendarEntry extends ExDividendNoticeEntry {
  symbol: string;
  companyName: string | null;
  status: ExDividendCalendarStatus;
  /** "YYYY-MM-DD" — realized rows only, null on announced. */
  paymentDate: string | null;
  /** Fiscal year (西元) the dividend belongs to — realized rows only, null on announced. */
  fiscalYear: number | null;
  /**
   * "ETF" or "COMMON". 2026-09-30: the three fields below are populated for ETF rows and null for every
   * COMMON row (measured 110/110 COMMON rows null, 96/96 ETF rows populated, 2026-09).
   */
  securityType: ExDividendCalendarSecurityType | null;
  /** "YYYY-MM-DD" 基準日 — ETF rows only. */
  recordDate: string | null;
  /**
   * 每單位分配金額. **This is the ONLY amount an ETF row carries** — an ETF's `cashDividend` is always null
   * (96/96 in 2026-09), so a calendar that reads `cashDividend` alone shows no amount for roughly half the
   * month's rows (ETFs were 96 of 206). Null on announced rows: the amount genuinely isn't published yet
   * (0/14 populated on 2026-10, all announced), which is different from "we dropped it".
   */
  distributionPerUnit: number | null;
  composition: ExDividendCompositionBreakdown | null;
}

/**
 * ETF 配息組成，百分比. `null` on a field means 未揭露; `0` means 揭露了而且是零 — **not the same thing**, and
 * 0 is common rather than exceptional (incomeEqualizationPct was 0 in 90 of 96 rows, 2026-09), so a falsy
 * check here silently turns "this distribution used no 收益平準金" into "we don't know".
 *
 * **The parts do not always sum to 100, and which rows fall short is not random.** Measured across
 * 2026-06~09 (396 ETF rows): all 347 passive-ETF rows sum to 100, while 8 of 49 主動型 rows do not — 6 sum
 * to less (99.2, 72.13, 31.67 …) and 2 have all five fields null. So a breakdown rendered as a whole
 * cannot assume a remainder of zero; 00404A 主動聯博動能50 discloses 31.67% and leaves 68% unaccounted for.
 * Also with sitca as of 2026-09-30 (a parse gap or a different disclosure format for active ETFs) — treat
 * the shortfall as unattributed, never as "other".
 *
 * **On an announced (future) row this is the PREVIOUS distribution's composition, not a forecast.**
 * 00939's values changed every event (100/0 → 35.87/64.13 → 41.06/58.94 → 42.4/57.6) and its 2026-10-05
 * announced row carries 2026-09-01's 42.4/57.6 verbatim. The row looks entirely valid — the parts sum to
 * 100 — so nothing downstream can detect it from the payload alone. Pair it with `status`: treat the
 * breakdown as meaningful only on "realized".
 *
 * Cause located 2026-09-30, **not** in analysis-ts: their endpoint reads sitca's
 * `export.fundclear_etf_dividend` row by row with no join at all (I had guessed a join missing a date
 * predicate — wrong). Both of 00939's rows sit in that table with identical composition, written in the same
 * second, so it comes from sitca's ingest or from FundClear itself. sitca is investigating; analysis-ts
 * deliberately will not null it on announced rows before the cause is known, since that would overwrite an
 * upstream value on a guess. bff-ts forwards it as-is either way (代理端點零轉換). If it turns out FundClear
 * publishes the latest known breakdown on a notice on purpose, the wording here becomes the semantics rather
 * than a caveat — analysis-ts will say which.
 */
export interface ExDividendCompositionBreakdown {
  dividendIncomePct: number | null;
  interestIncomePct: number | null;
  incomeEqualizationPct: number | null;
  realizedCapitalGainPct: number | null;
  otherIncomePct: number | null;
}

export type ExDividendCalendarSecurityType = "ETF" | "COMMON";

export interface ExDividendCalendarResult {
  entries: ExDividendCalendarEntry[];
}
