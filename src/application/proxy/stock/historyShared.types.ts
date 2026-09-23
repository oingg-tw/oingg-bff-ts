/**
 * The entry/page shapes shared by analysis-ts's family of quarterly-history endpoints.
 *
 * These used to sit in metricHistoryShared.ts next to the fetch+normalize helper that produces them,
 * but that file also imported analysisServiceClient, which put an outbound HTTP client inside the
 * application layer. Only the helper needed to be down there: the shapes are part of this slice's own
 * outward contract (metricHistory.types.ts and roeRoaHistory.types.ts build their results out of them,
 * and those are what the routes serialize), so the file was split rather than moved wholesale — types
 * stay here, the fetching moved to infrastructure/analysisApi/stock/historyShared.client.ts.
 */

export interface FlatHistoryEntry {
  fiscalYear: number;
  fiscalQuarter: number;
  /** Null when the underlying figure couldn't be computed for this quarter — see nullReason. */
  value: number | null;
  /** Why `value` is null (e.g. a missing trailing quarter of data) — null when `value` is present. */
  nullReason: string | null;
  /**
   * The financial-report announcement date this figure is aligned to — not a daily market-data date, and
   * **not a "last modified" stamp**. It says when the market learned the underlying report, so it does not
   * move when analysis-ts recomputes the figure under a new formula: 2330's 2022Q4 dupont ROE was rewritten
   * 34.91 → 40.14 on 2026-09-23 while its knowledgeDate stayed 2023-02-14 (verified live). Never use it as
   * a cache-invalidation key — a cache holding a pre-recompute value will look current forever.
   */
  knowledgeDate: string;
  /** True when knowledgeDate is a fallback estimate rather than the real announcement date. */
  knowledgeDateIsFallback: boolean;
}

/**
 * Pagination metadata analysis-ts added to every history endpoint in this domain (2026-09-07, same day
 * as the endpoints themselves — not present in the very first responses this codebase saw, which is why
 * it was initially missed on 3 of the 5 endpoints until web-nuxt's tenYearDisabled UI logic surfaced the
 * gap). `total` is the full count available (not just what this page returned); `hasMore` is whether a
 * higher `limit` would return more entries than this call did.
 */
export interface HistoryPageMeta {
  total: number;
  hasMore: boolean;
}

export type FlatHistoryPage = HistoryPageMeta & { entries: FlatHistoryEntry[] };
