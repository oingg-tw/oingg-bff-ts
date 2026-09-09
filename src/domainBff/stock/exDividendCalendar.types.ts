import type { ExDividendNoticeEntry } from "@/domainBff/stock/exDividendNotices.types.js";

/**
 * Same fields as ExDividendNoticeEntry (one entry = one company's one ex-dividend/ex-rights event), plus
 * `symbol`/`companyName` since this is a flat market-wide list, not grouped per symbol like
 * GET /stocks/ex-dividend-notices. `companyName` is nullable — analysis-ts's company reference table
 * doesn't cover ETFs (confirmed live, 2026-09-10: e.g. 00939/00984D have null companyName).
 */
export interface ExDividendCalendarEntry extends ExDividendNoticeEntry {
  symbol: string;
  companyName: string | null;
}

export interface ExDividendCalendarResult {
  entries: ExDividendCalendarEntry[];
}
