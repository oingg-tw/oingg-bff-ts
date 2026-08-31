export type ThemeMode = "LIGHT" | "DARK" | "SYSTEM";
export type ThemeAccentColor = "BLUE" | "GREEN" | "PURPLE" | "ORANGE" | "RED" | "TEAL" | "GOLD";
/** ASIA = red is up/gain, green is down/loss (台股/亞洲慣例); WESTERN = the reverse (歐美慣例). */
export type MarketColorConvention = "ASIA" | "WESTERN";

export interface ThemePreference {
  mode: ThemeMode;
  accentColor: ThemeAccentColor;
  marketColorConvention: MarketColorConvention;
}

export interface ThemePreferenceUpdate {
  mode?: ThemeMode;
  accentColor?: ThemeAccentColor;
  marketColorConvention?: MarketColorConvention;
}
