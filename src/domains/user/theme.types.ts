export type ThemeMode = "LIGHT" | "DARK" | "SYSTEM";
export type ThemeAccentColor = "BLUE" | "GREEN" | "PURPLE" | "ORANGE" | "RED" | "TEAL" | "GOLD";
/**
 * ASIA = red is up/gain, green is down/loss (台股/亞洲慣例); WESTERN = the reverse (歐美慣例); ACCESSIBLE =
 * colorblind-safe blue/orange instead of red/green (frontend-defined hex values, not this service's concern).
 */
export type MarketColorConvention = "ASIA" | "WESTERN" | "ACCESSIBLE";

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
