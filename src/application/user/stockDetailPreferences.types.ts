export type StockDetailPageMode = "CARD" | "ACCOUNTING";

export interface StockDetailPreferences {
  /** null means no preference saved yet — resolved to the frontend's own local default. */
  mode: StockDetailPageMode | null;
  /** null means no preference saved yet — distinct from [] (user explicitly hid every card). */
  visibleCardIds: string[] | null;
  /**
   * Metric-page slugs the user pinned to the stock page's sidebar, in sidebar order. Added 2026-09-25
   * for web-nuxt's /stock/{code}/metrics directory page, where the sidebar is four fixed rows plus
   * however many the user pins.
   *
   * Same three-state contract as `visibleCardIds`: null = never saved (frontend applies its default),
   * [] = the user unpinned everything. **Order is meaningful and is stored verbatim** — the array is
   * the sidebar order, so nothing here sorts or dedupes it.
   *
   * The values are opaque to this service on purpose: they are web-nuxt's own page slugs (`roe`,
   * `current-ratio`, …) whose vocabulary lives in their `shared/utils/hub-slugs.ts` and changes
   * whenever they add a page. Validating against a list here would mean a bff-ts deploy for every
   * page they add, and a stale list would reject a slug that works.
   */
  pinnedMetricSlugs: string[] | null;
}
