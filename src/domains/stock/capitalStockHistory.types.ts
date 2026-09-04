/**
 * Breakdown of what caused a paid-in-capital change (現金增資/公積轉增資/盈餘轉增資/合併增資/減資/其他).
 * analysis-ts confirmed (2026-09-04): the first five are bigint-serialized strings, practically never
 * null (unrelated sources come back as "0", not absent) — `capitalReduction` can be negative (e.g.
 * "-1500000000"), never take its absolute value. More than one source can be non-zero on the same entry
 * (~9% of real rows) — never assume a single dominant source. `other` is free text and the one field
 * that's actually commonly null (only set when the change falls outside the other five categories).
 */
export interface CapitalStockChangeSource {
  cashIncrease: string | null;
  capitalReserveTransfer: string | null;
  retainedEarningsTransfer: string | null;
  mergerIncrease: string | null;
  capitalReduction: string | null;
  other: string | null;
}

export interface CapitalStockHistoryEntry {
  /** "YYYY-MM" */
  effectiveDate: string;
  paidInShares: string;
  paidInCapital: string;
  changeSource: CapitalStockChangeSource;
  remarks: string | null;
}

export interface CapitalStockHistoryResult {
  symbol: string;
  /** Newest to oldest, same order as analysis-ts's response. */
  entries: CapitalStockHistoryEntry[];
}
