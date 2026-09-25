/**
 * One distribution event within a fiscal year (a fiscal year can pay out over multiple quarters — see
 * DividendHistoryEntry.distributionCount). `fiscalQuarter` is null when the year only had a single,
 * whole-year distribution (distributionCount === 1). `closeAtExDate`/`yieldAtExDate` are null until the
 * ex-dividend date's own closing price is known (e.g. a future/just-announced ex-date).
 */
export interface DividendEvent {
  fiscalQuarter: number | null;
  cashDividend: number;
  /**
   * The two sources `cashDividend` is made of, added upstream 2026-09-25. Both are plain numbers,
   * never null — a company with no capital-reserve component gets 0, not null.
   *
   * **`fromEarnings` is not necessarily *this* year's earnings.** The announcement only splits
   * 盈餘 from 資本公積; it does not say which year's earnings. So `cashDividendFromEarnings` above
   * the year's `eps` means the excess came from accumulated prior-year earnings — upstream measured
   * 498 such company-years in 110–113, plus 164 that paid while loss-making (80 of those using
   * capital reserve). Comparing the two is the only way to see it; there is no field for it.
   */
  cashDividendFromEarnings: number;
  cashDividendFromCapitalReserve: number;
  stockDividend: number;
  exDividendDate: string | null;
  exRightsDate: string | null;
  paymentDate: string | null;
  announcementDate: string;
  closeAtExDate: number | null;
  yieldAtExDate: number | null;
}

/**
 * One fiscal year's dividend summary — cashDividend/stockDividend/totalDividend/exDividendDate/
 * exRightsDate/paymentDate are the year's totals/last-event dates, `events` breaks the same year down by
 * distribution (see DividendEvent).
 *
 * `eps` is **the annual report's basic EPS (eps.FY), not four quarterly EPS summed** — changed upstream
 * 2026-09-25, and `payoutRatio` follows it. That matters because the two differ: the annual report uses
 * the full year's weighted-average share count while the quarterly series uses period-end shares, and
 * only about 65% of companies agree to within NT$0.01. Both are null when no annual report exists yet
 * (2026 for a normal filer), and also for the 757 companies whose 114 annual report upstream has no EPS
 * line at all. `yieldAtExDate` at the year level is null under the same condition as at the event level.
 *
 * `payoutRatio` here is **not** the same quantity as the `dividendPayoutRatio` metric: this one divides a
 * fiscal year's declared dividend by that same year's annual EPS, whereas the metric divides trailing
 * four quarters of *paid* dividend by trailing four quarters of earnings — two different windows, so the
 * metric moves when earnings move even if policy does not. See that metric's own limitations text.
 */
export interface DividendHistoryEntry {
  fiscalYear: number;
  rocFiscalYear: number;
  cashDividend: number;
  /**
   * Same split as on DividendEvent, at the year level. `cashDividend` remains the total and
   * `payoutRatio` is still computed from the total, so nothing here changes an existing number.
   *
   * **The two rounded parts can sum to 0.01 away from `cashDividend`** — upstream rounds each
   * source independently. Do not use their sum as a cross-check on the total; use the total.
   */
  cashDividendFromEarnings: number;
  cashDividendFromCapitalReserve: number;
  stockDividend: number;
  totalDividend: number;
  distributionCount: number;
  exDividendDate: string | null;
  exRightsDate: string | null;
  paymentDate: string | null;
  eps: number | null;
  payoutRatio: number | null;
  yieldAtExDate: number | null;
  knowledgeDate: string;
  events: DividendEvent[];
}

export interface DividendHistoryResult {
  symbol: string;
  /** Oldest to newest, same order as analysis-ts's response. */
  entries: DividendHistoryEntry[];
}
