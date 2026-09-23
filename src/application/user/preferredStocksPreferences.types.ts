export type PreferredStocksColumnPreset = "ALL" | "CONTRACT_TERMS" | "VALUATION" | "CALL_RISK";

export interface PreferredStocksPreferences {
  /** null means no preference saved yet — resolved to the frontend's own local default. */
  columnPresetId: PreferredStocksColumnPreset | null;
  /** null means no preference saved yet — distinct from [] (an intentionally empty order, if that's ever meaningful). */
  columnOrder: string[] | null;
}
