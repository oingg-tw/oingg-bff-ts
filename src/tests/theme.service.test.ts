import { describe, expect, it, vi } from "vitest";
import { fakeUserPreferences } from "@/tests/fakes/userPreferences.js";
import {
  getThemePreference,
  updateThemeMode,
  updateThemeAccentColor,
  updateMarketColorConvention,
  updateIsFullWidth,
  SYSTEM_DEFAULT_THEME,
} from "@/application/user/theme.service.js";

describe("getThemePreference", () => {
  it("falls back to the system default when the user has no saved row", async () => {
    const userPreferences = fakeUserPreferences();

    const theme = await getThemePreference("uid-1", { userPreferences });

    expect(theme).toEqual(SYSTEM_DEFAULT_THEME);
    expect(userPreferences.getTheme).toHaveBeenCalledWith("uid-1");
  });

  // Regression: mode/accentColor/marketColorConvention/isFullWidth are independently nullable — a user
  // who only ever set one of them must still fall back to the live system default for the others, not
  // some frozen value.
  it("falls back to the system default per-field when only one field was ever set", async () => {
    const userPreferences = fakeUserPreferences({
      getTheme: vi.fn().mockResolvedValue({
        mode: "DARK",
        accentColor: null,
        marketColorConvention: null,
        isFullWidth: null,
      }),
    });

    const theme = await getThemePreference("uid-1", { userPreferences });

    expect(theme).toEqual({
      mode: "DARK",
      accentColor: SYSTEM_DEFAULT_THEME.accentColor,
      marketColorConvention: SYSTEM_DEFAULT_THEME.marketColorConvention,
      isFullWidth: SYSTEM_DEFAULT_THEME.isFullWidth,
    });
  });

  it("returns the user's fully-saved preference when every field is set", async () => {
    const userPreferences = fakeUserPreferences({
      getTheme: vi.fn().mockResolvedValue({
        mode: "LIGHT",
        accentColor: "PURPLE",
        marketColorConvention: "WESTERN",
        isFullWidth: true,
      }),
    });

    const theme = await getThemePreference("uid-1", { userPreferences });

    expect(theme).toEqual({ mode: "LIGHT", accentColor: "PURPLE", marketColorConvention: "WESTERN", isFullWidth: true });
  });
});

// Each setting has its own update entrypoint (a separate PUT endpoint) rather than one combined
// partial-update call, so each is tested independently of the others' validation.
describe("updateThemeMode", () => {
  it("rejects a missing or invalid mode", async () => {
    const userPreferences = fakeUserPreferences();

    await expect(updateThemeMode("uid-1", undefined, { userPreferences })).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateThemeMode("uid-1", "NEON", { userPreferences })).rejects.toMatchObject({ statusCode: 400 });
    expect(userPreferences.saveTheme).not.toHaveBeenCalled();
  });

  it("upserts only the mode field and resolves the rest against defaults", async () => {
    const userPreferences = fakeUserPreferences({
      saveTheme: vi.fn().mockResolvedValue({
        mode: "DARK",
        accentColor: null,
        marketColorConvention: null,
        isFullWidth: null,
      }),
    });

    const theme = await updateThemeMode("uid-1", "DARK", { userPreferences });

    expect(userPreferences.saveTheme).toHaveBeenCalledWith("uid-1", { mode: "DARK" });
    expect(theme).toEqual({
      mode: "DARK",
      accentColor: SYSTEM_DEFAULT_THEME.accentColor,
      marketColorConvention: SYSTEM_DEFAULT_THEME.marketColorConvention,
      isFullWidth: SYSTEM_DEFAULT_THEME.isFullWidth,
    });
  });
});

describe("updateThemeAccentColor", () => {
  it("rejects a missing or invalid accentColor", async () => {
    const userPreferences = fakeUserPreferences();

    await expect(updateThemeAccentColor("uid-1", undefined, { userPreferences })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(updateThemeAccentColor("uid-1", "MAGENTA", { userPreferences })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(userPreferences.saveTheme).not.toHaveBeenCalled();
  });

  it("accepts GOLD and upserts only the accentColor field", async () => {
    const userPreferences = fakeUserPreferences({
      saveTheme: vi.fn().mockResolvedValue({
        mode: null,
        accentColor: "GOLD",
        marketColorConvention: null,
        isFullWidth: null,
      }),
    });

    const theme = await updateThemeAccentColor("uid-1", "GOLD", { userPreferences });

    expect(userPreferences.saveTheme).toHaveBeenCalledWith("uid-1", { accentColor: "GOLD" });
    expect(theme).toEqual({
      mode: SYSTEM_DEFAULT_THEME.mode,
      accentColor: "GOLD",
      marketColorConvention: SYSTEM_DEFAULT_THEME.marketColorConvention,
      isFullWidth: SYSTEM_DEFAULT_THEME.isFullWidth,
    });
  });
});

describe("updateMarketColorConvention", () => {
  it("rejects a missing or invalid marketColorConvention", async () => {
    const userPreferences = fakeUserPreferences();

    await expect(updateMarketColorConvention("uid-1", undefined, { userPreferences })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(updateMarketColorConvention("uid-1", "EUROPE", { userPreferences })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(userPreferences.saveTheme).not.toHaveBeenCalled();
  });

  it("accepts WESTERN and upserts only the marketColorConvention field", async () => {
    const userPreferences = fakeUserPreferences({
      saveTheme: vi.fn().mockResolvedValue({
        mode: null,
        accentColor: null,
        marketColorConvention: "WESTERN",
        isFullWidth: null,
      }),
    });

    const theme = await updateMarketColorConvention("uid-1", "WESTERN", { userPreferences });

    expect(userPreferences.saveTheme).toHaveBeenCalledWith("uid-1", { marketColorConvention: "WESTERN" });
    expect(theme).toEqual({
      mode: SYSTEM_DEFAULT_THEME.mode,
      accentColor: SYSTEM_DEFAULT_THEME.accentColor,
      marketColorConvention: "WESTERN",
      isFullWidth: SYSTEM_DEFAULT_THEME.isFullWidth,
    });
  });

  it("accepts ACCESSIBLE (colorblind-safe blue/orange) as a valid marketColorConvention", async () => {
    const userPreferences = fakeUserPreferences({
      saveTheme: vi.fn().mockResolvedValue({
        mode: null,
        accentColor: null,
        marketColorConvention: "ACCESSIBLE",
        isFullWidth: null,
      }),
    });

    const theme = await updateMarketColorConvention("uid-1", "ACCESSIBLE", { userPreferences });

    expect(userPreferences.saveTheme).toHaveBeenCalledWith("uid-1", { marketColorConvention: "ACCESSIBLE" });
    expect(theme.marketColorConvention).toBe("ACCESSIBLE");
  });
});

describe("updateIsFullWidth", () => {
  it("rejects a non-boolean value", async () => {
    const userPreferences = fakeUserPreferences();

    await expect(updateIsFullWidth("uid-1", undefined, { userPreferences })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(updateIsFullWidth("uid-1", "yes", { userPreferences })).rejects.toMatchObject({ statusCode: 400 });
    expect(userPreferences.saveTheme).not.toHaveBeenCalled();
  });

  it("persists true and upserts only the isFullWidth field", async () => {
    const userPreferences = fakeUserPreferences({
      saveTheme: vi.fn().mockResolvedValue({
        mode: null,
        accentColor: null,
        marketColorConvention: null,
        isFullWidth: true,
      }),
    });

    const theme = await updateIsFullWidth("uid-1", true, { userPreferences });

    expect(userPreferences.saveTheme).toHaveBeenCalledWith("uid-1", { isFullWidth: true });
    expect(theme).toEqual({
      mode: SYSTEM_DEFAULT_THEME.mode,
      accentColor: SYSTEM_DEFAULT_THEME.accentColor,
      marketColorConvention: SYSTEM_DEFAULT_THEME.marketColorConvention,
      isFullWidth: true,
    });
  });

  it("persists false and returns it (not treated as falsy/missing)", async () => {
    const userPreferences = fakeUserPreferences({
      saveTheme: vi.fn().mockResolvedValue({
        mode: null,
        accentColor: null,
        marketColorConvention: null,
        isFullWidth: false,
      }),
    });

    const theme = await updateIsFullWidth("uid-1", false, { userPreferences });

    expect(userPreferences.saveTheme).toHaveBeenCalledWith("uid-1", { isFullWidth: false });
    expect(theme.isFullWidth).toBe(false);
  });
});
