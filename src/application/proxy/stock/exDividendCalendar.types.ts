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
 * GET /stocks/ex-dividend-notices. `companyName` is nullable — analysis-ts's company reference table
 * doesn't cover ETFs (confirmed live, 2026-09-10: e.g. 00939/00984D have null companyName).
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
}

export interface ExDividendCalendarResult {
  entries: ExDividendCalendarEntry[];
}
