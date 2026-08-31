export type ThemeMode = "LIGHT" | "DARK" | "SYSTEM";
export type ThemeAccentColor = "BLUE" | "GREEN" | "PURPLE" | "ORANGE" | "RED" | "TEAL" | "GOLD";

export interface ThemePreference {
  mode: ThemeMode;
  accentColor: ThemeAccentColor;
}

export interface ThemePreferenceUpdate {
  mode?: ThemeMode;
  accentColor?: ThemeAccentColor;
}
