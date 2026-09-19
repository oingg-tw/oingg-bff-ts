/**
 * One distribution event within a fiscal year (a fiscal year can pay out over multiple quarters — see
 * DividendHistoryEntry.distributionCount). `fiscalQuarter` is null when the year only had a single,
 * whole-year distribution (distributionCount === 1). `closeAtExDate`/`yieldAtExDate` are null until the
 * ex-dividend date's own closing price is known (e.g. a future/just-announced ex-date).
 */
export interface DividendEvent {
  fiscalQuarter: number | null;
  cashDividend: number;
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
 * distribution (see DividendEvent). `eps`/`payoutRatio` are null until the year's full-year financial
 * statement is filed (confirmed live: still null on 2026 while EPS/payoutRatio are populated back through
 * 2021). `yieldAtExDate` at the year level is null under the same condition as at the event level.
 */
export interface DividendHistoryEntry {
  fiscalYear: number;
  rocFiscalYear: number;
  cashDividend: number;
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
