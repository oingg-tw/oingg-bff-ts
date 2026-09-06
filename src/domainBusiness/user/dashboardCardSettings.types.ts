export interface DashboardCardSettings {
  /** null means no preference saved yet — distinct from [] (user explicitly hid every card). */
  visibleCardIds: string[] | null;
}
