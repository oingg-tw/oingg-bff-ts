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
  /** Whether the app's main content area spans the full page width instead of a constrained/centered layout (視覺滿版). App-wide, not tied to any one feature. */
  isFullWidth: boolean;
}

export interface ThemePreferenceUpdate {
  mode?: ThemeMode;
  accentColor?: ThemeAccentColor;
  marketColorConvention?: MarketColorConvention;
  isFullWidth?: boolean;
}
