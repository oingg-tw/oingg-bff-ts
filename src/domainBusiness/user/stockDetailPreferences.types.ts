export type StockDetailPageMode = "CARD" | "ACCOUNTING";

export interface StockDetailPreferences {
  /** null means no preference saved yet — resolved to the frontend's own local default. */
  mode: StockDetailPageMode | null;
  /** null means no preference saved yet — distinct from [] (user explicitly hid every card). */
  visibleCardIds: string[] | null;
}
