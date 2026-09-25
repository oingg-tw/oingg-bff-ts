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
   * The two sources `cashDividend` is made of, added upstream 2026-09-25.
   *
   * **`0` and `null` mean different things and must stay distinguishable.** `0` is upstream saying
   * this component is genuinely absent for this company-year; `null` is upstream not sending the
   * field at all. analysis-ts's contract says these are always numbers, but observed reality on
   * 2026-09-25 was both fields disappearing from every year of every company for a while (probably a
   * deploy window, reported). The old code declared them `number` and ran `Number(undefined)`, which
   * is `NaN`, which JSON serialises to `null` — so it emitted null anyway while promising it could
   * not. Declaring the null makes the type honest instead of accidentally right.
   *
   * The second one was renamed twice on 2026-09-25, so do not be surprised by the old names in any
   * older notes: `cashDividendFromCapitalReserve`, then `cashDividendFromLegalAndCapitalReserve`, now
   * this. The first was semantically wrong and the second ambiguous — the MOPS column reads
   * 「法定盈餘公積、資本公積發放之現金」, and in the TIFRS taxonomy Taiwan's 資本公積 is
   * `CapitalSurplus` (`tifrs-es:CashDividendsFromCapitalSurplus`), while `CapitalReserve` is a
   * different IFRS concept entirely.
   *
   * The two sources are merged in the announcement and cannot be separated, which matters because
   * they are opposite in kind: **資本公積 returns paid-in capital, while 法定盈餘公積 is prior-year
   * *earnings* set aside by statute.** So this field must never be described as "returned share
   * capital" — part of it is retained profit.
   *
   * **`fromEarnings` is not necessarily *this* year's earnings.** The announcement only splits
   * 盈餘 from 資本公積; it does not say which year's earnings.
   *
   * That makes the comparison against `eps` **one-directional, and it fires rarely**. If
   * `cashDividendFromEarnings` exceeds the year's `eps`, the excess must have come from accumulated
   * prior-year earnings. If it does not exceed `eps`, **nothing follows** — 3045 台灣大 112 paid 3.63
   * from earnings against an EPS of 4.33, and that 3.63 may still be partly prior-year; the
   * announcement cannot tell you. Measured on a 100-company sample, only 11.8% of dividend-paying
   * company-years are provable this way, so do not describe the split as generally visible.
   *
   * The data is not absent everywhere, only from this source: mops-ts confirmed the dividend
   * announcement carries no year attribution, but the **actual** amounts appropriated to statutory and
   * special reserves and paid as cash dividends do exist in the XBRL statement of changes in equity,
   * which mops-ts already collects and analysis-ts has not wired up. The resolution basis (what the AGM
   * decided, rather than what the books recorded) would be MOPS t05st09, which nobody has scraped. So
   * "there is no such data" is wrong; "this endpoint cannot tell you" is right.
   *
   * Also do not read `cashDividendFromEarnings > eps` as a data error: upstream counted 498 such
   * company-years in 110–113, plus 164 that paid while loss-making (80 of those using reserves).
   */
  cashDividendFromEarnings: number | null;
  cashDividendFromLegalReserveAndCapitalSurplus: number | null;
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
   * Same split as on DividendEvent, at the year level. `cashDividend` remains the total.
   *
   * **`payoutRatio`'s numerator changed to this field on 2026-09-25** — it was the total, it is now
   * `cashDividendFromEarnings` alone. Same field name, different values: 2882 國泰金 111 went from
   * 34.88 to 0 because every cent of its NT$0.90 came from reserves. Anyone needing the old quantity
   * computes `cashDividend / eps` themselves. See `payoutRatio` below.
   *
   * **The two rounded parts can sum to 0.01 away from `cashDividend`** — upstream rounds each
   * source independently. Do not use their sum as a cross-check on the total; use the total.
   */
  cashDividendFromEarnings: number | null;
  cashDividendFromLegalReserveAndCapitalSurplus: number | null;
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
