import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../domains/user/theme.repository.js", () => ({
  findThemePreference: vi.fn(),
  upsertThemePreference: vi.fn(),
}));

import { findThemePreference, upsertThemePreference } from "../domains/user/theme.repository.js";
import {
  getThemePreference,
  updateThemeMode,
  updateThemeAccentColor,
  updateMarketColorConvention,
  updateIsFullWidth,
  SYSTEM_DEFAULT_THEME,
} from "../domains/user/theme.service.js";

describe("getThemePreference", () => {
  beforeEach(() => {
    vi.mocked(findThemePreference).mockReset();
  });

  it("falls back to the system default when the user has no saved row", async () => {
    vi.mocked(findThemePreference).mockResolvedValue(null);

    const theme = await getThemePreference("uid-1");

    expect(theme).toEqual(SYSTEM_DEFAULT_THEME);
  });

  // Regression: mode/accentColor/marketColorConvention/isFullWidth are independently nullable — a user
  // who only ever set one of them must still fall back to the live system default for the others, not
  // some frozen value.
  it("falls back to the system default per-field when only one field was ever set", async () => {
    vi.mocked(findThemePreference).mockResolvedValue({
      mode: "DARK",
      accentColor: null,
      marketColorConvention: null,
      isFullWidth: null,
    });

    const theme = await getThemePreference("uid-1");

    expect(theme).toEqual({
      mode: "DARK",
      accentColor: SYSTEM_DEFAULT_THEME.accentColor,
      marketColorConvention: SYSTEM_DEFAULT_THEME.marketColorConvention,
      isFullWidth: SYSTEM_DEFAULT_THEME.isFullWidth,
    });
  });

  it("returns the user's fully-saved preference when every field is set", async () => {
    vi.mocked(findThemePreference).mockResolvedValue({
      mode: "LIGHT",
      accentColor: "PURPLE",
      marketColorConvention: "WESTERN",
      isFullWidth: true,
    });

    const theme = await getThemePreference("uid-1");

    expect(theme).toEqual({ mode: "LIGHT", accentColor: "PURPLE", marketColorConvention: "WESTERN", isFullWidth: true });
  });
});

// Each setting has its own update entrypoint (a separate PUT endpoint) rather than one combined
// partial-update call, so each is tested independently of the others' validation.
describe("updateThemeMode", () => {
  beforeEach(() => {
    vi.mocked(upsertThemePreference).mockReset();
  });

  it("rejects a missing or invalid mode", async () => {
    await expect(updateThemeMode("uid-1", undefined)).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateThemeMode("uid-1", "NEON")).rejects.toMatchObject({ statusCode: 400 });
    expect(upsertThemePreference).not.toHaveBeenCalled();
  });

  it("upserts only the mode field and resolves the rest against defaults", async () => {
    vi.mocked(upsertThemePreference).mockResolvedValue({
      mode: "DARK",
      accentColor: null,
      marketColorConvention: null,
      isFullWidth: null,
    });

    const theme = await updateThemeMode("uid-1", "DARK");

    expect(upsertThemePreference).toHaveBeenCalledWith("uid-1", { mode: "DARK" });
    expect(theme).toEqual({
      mode: "DARK",
      accentColor: SYSTEM_DEFAULT_THEME.accentColor,
      marketColorConvention: SYSTEM_DEFAULT_THEME.marketColorConvention,
      isFullWidth: SYSTEM_DEFAULT_THEME.isFullWidth,
    });
  });
});

describe("updateThemeAccentColor", () => {
  beforeEach(() => {
    vi.mocked(upsertThemePreference).mockReset();
  });

  it("rejects a missing or invalid accentColor", async () => {
    await expect(updateThemeAccentColor("uid-1", undefined)).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateThemeAccentColor("uid-1", "MAGENTA")).rejects.toMatchObject({ statusCode: 400 });
    expect(upsertThemePreference).not.toHaveBeenCalled();
  });

  it("accepts GOLD and upserts only the accentColor field", async () => {
    vi.mocked(upsertThemePreference).mockResolvedValue({
      mode: null,
      accentColor: "GOLD",
      marketColorConvention: null,
      isFullWidth: null,
    });

    const theme = await updateThemeAccentColor("uid-1", "GOLD");

    expect(upsertThemePreference).toHaveBeenCalledWith("uid-1", { accentColor: "GOLD" });
    expect(theme).toEqual({
      mode: SYSTEM_DEFAULT_THEME.mode,
      accentColor: "GOLD",
      marketColorConvention: SYSTEM_DEFAULT_THEME.marketColorConvention,
      isFullWidth: SYSTEM_DEFAULT_THEME.isFullWidth,
    });
  });
});

describe("updateMarketColorConvention", () => {
  beforeEach(() => {
    vi.mocked(upsertThemePreference).mockReset();
  });

  it("rejects a missing or invalid marketColorConvention", async () => {
    await expect(updateMarketColorConvention("uid-1", undefined)).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateMarketColorConvention("uid-1", "EUROPE")).rejects.toMatchObject({ statusCode: 400 });
    expect(upsertThemePreference).not.toHaveBeenCalled();
  });

  it("accepts WESTERN and upserts only the marketColorConvention field", async () => {
    vi.mocked(upsertThemePreference).mockResolvedValue({
      mode: null,
      accentColor: null,
      marketColorConvention: "WESTERN",
      isFullWidth: null,
    });

    const theme = await updateMarketColorConvention("uid-1", "WESTERN");

    expect(upsertThemePreference).toHaveBeenCalledWith("uid-1", { marketColorConvention: "WESTERN" });
    expect(theme).toEqual({
      mode: SYSTEM_DEFAULT_THEME.mode,
      accentColor: SYSTEM_DEFAULT_THEME.accentColor,
      marketColorConvention: "WESTERN",
      isFullWidth: SYSTEM_DEFAULT_THEME.isFullWidth,
    });
  });

  it("accepts ACCESSIBLE (colorblind-safe blue/orange) as a valid marketColorConvention", async () => {
    vi.mocked(upsertThemePreference).mockResolvedValue({
      mode: null,
      accentColor: null,
      marketColorConvention: "ACCESSIBLE",
      isFullWidth: null,
    });

    const theme = await updateMarketColorConvention("uid-1", "ACCESSIBLE");

    expect(upsertThemePreference).toHaveBeenCalledWith("uid-1", { marketColorConvention: "ACCESSIBLE" });
    expect(theme.marketColorConvention).toBe("ACCESSIBLE");
  });
});

describe("updateIsFullWidth", () => {
  beforeEach(() => {
    vi.mocked(upsertThemePreference).mockReset();
  });

  it("rejects a non-boolean value", async () => {
    await expect(updateIsFullWidth("uid-1", undefined)).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateIsFullWidth("uid-1", "yes")).rejects.toMatchObject({ statusCode: 400 });
    expect(upsertThemePreference).not.toHaveBeenCalled();
  });

  it("persists true and upserts only the isFullWidth field", async () => {
    vi.mocked(upsertThemePreference).mockResolvedValue({
      mode: null,
      accentColor: null,
      marketColorConvention: null,
      isFullWidth: true,
    });

    const theme = await updateIsFullWidth("uid-1", true);

    expect(upsertThemePreference).toHaveBeenCalledWith("uid-1", { isFullWidth: true });
    expect(theme).toEqual({
      mode: SYSTEM_DEFAULT_THEME.mode,
      accentColor: SYSTEM_DEFAULT_THEME.accentColor,
      marketColorConvention: SYSTEM_DEFAULT_THEME.marketColorConvention,
      isFullWidth: true,
    });
  });

  it("persists false and returns it (not treated as falsy/missing)", async () => {
    vi.mocked(upsertThemePreference).mockResolvedValue({
      mode: null,
      accentColor: null,
      marketColorConvention: null,
      isFullWidth: false,
    });

    const theme = await updateIsFullWidth("uid-1", false);

    expect(upsertThemePreference).toHaveBeenCalledWith("uid-1", { isFullWidth: false });
    expect(theme.isFullWidth).toBe(false);
  });
});
