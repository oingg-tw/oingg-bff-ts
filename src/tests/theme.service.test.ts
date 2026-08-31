import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../domains/user/theme.repository.js", () => ({
  findThemePreference: vi.fn(),
  upsertThemePreference: vi.fn(),
}));

import { findThemePreference, upsertThemePreference } from "../domains/user/theme.repository.js";
import { getThemePreference, updateThemePreference, SYSTEM_DEFAULT_THEME } from "../domains/user/theme.service.js";

describe("getThemePreference", () => {
  beforeEach(() => {
    vi.mocked(findThemePreference).mockReset();
  });

  it("falls back to the system default when the user has no saved row", async () => {
    vi.mocked(findThemePreference).mockResolvedValue(null);

    const theme = await getThemePreference("uid-1");

    expect(theme).toEqual(SYSTEM_DEFAULT_THEME);
  });

  // Regression: mode/accentColor/marketColorConvention are independently nullable — a user who only
  // ever set one of them must still fall back to the live system default for the others, not some
  // frozen value.
  it("falls back to the system default per-field when only one field was ever set", async () => {
    vi.mocked(findThemePreference).mockResolvedValue({ mode: "DARK", accentColor: null, marketColorConvention: null });

    const theme = await getThemePreference("uid-1");

    expect(theme).toEqual({
      mode: "DARK",
      accentColor: SYSTEM_DEFAULT_THEME.accentColor,
      marketColorConvention: SYSTEM_DEFAULT_THEME.marketColorConvention,
    });
  });

  it("returns the user's fully-saved preference when every field is set", async () => {
    vi.mocked(findThemePreference).mockResolvedValue({
      mode: "LIGHT",
      accentColor: "PURPLE",
      marketColorConvention: "WESTERN",
    });

    const theme = await getThemePreference("uid-1");

    expect(theme).toEqual({ mode: "LIGHT", accentColor: "PURPLE", marketColorConvention: "WESTERN" });
  });
});

describe("updateThemePreference", () => {
  beforeEach(() => {
    vi.mocked(upsertThemePreference).mockReset();
  });

  it("rejects an update with none of mode/accentColor/marketColorConvention", async () => {
    await expect(updateThemePreference("uid-1", {})).rejects.toMatchObject({ statusCode: 400 });
    expect(upsertThemePreference).not.toHaveBeenCalled();
  });

  it("rejects a mode outside the allowed enum", async () => {
    await expect(updateThemePreference("uid-1", { mode: "NEON" as never })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(upsertThemePreference).not.toHaveBeenCalled();
  });

  it("rejects an accentColor outside the allowed enum", async () => {
    await expect(updateThemePreference("uid-1", { accentColor: "MAGENTA" as never })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(upsertThemePreference).not.toHaveBeenCalled();
  });

  it("rejects a marketColorConvention outside the allowed enum", async () => {
    await expect(
      updateThemePreference("uid-1", { marketColorConvention: "EUROPE" as never }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(upsertThemePreference).not.toHaveBeenCalled();
  });

  it("accepts GOLD as a valid accentColor", async () => {
    vi.mocked(upsertThemePreference).mockResolvedValue({ mode: null, accentColor: "GOLD", marketColorConvention: null });

    const theme = await updateThemePreference("uid-1", { accentColor: "GOLD" });

    expect(upsertThemePreference).toHaveBeenCalledWith("uid-1", { accentColor: "GOLD" });
    expect(theme).toEqual({
      mode: SYSTEM_DEFAULT_THEME.mode,
      accentColor: "GOLD",
      marketColorConvention: SYSTEM_DEFAULT_THEME.marketColorConvention,
    });
  });

  it("accepts WESTERN as a valid marketColorConvention (swaps up/down colors for non-Asian users)", async () => {
    vi.mocked(upsertThemePreference).mockResolvedValue({
      mode: null,
      accentColor: null,
      marketColorConvention: "WESTERN",
    });

    const theme = await updateThemePreference("uid-1", { marketColorConvention: "WESTERN" });

    expect(upsertThemePreference).toHaveBeenCalledWith("uid-1", { marketColorConvention: "WESTERN" });
    expect(theme).toEqual({
      mode: SYSTEM_DEFAULT_THEME.mode,
      accentColor: SYSTEM_DEFAULT_THEME.accentColor,
      marketColorConvention: "WESTERN",
    });
  });

  it("passes a partial update straight through to the repository (only the given field)", async () => {
    vi.mocked(upsertThemePreference).mockResolvedValue({ mode: "DARK", accentColor: null, marketColorConvention: null });

    const theme = await updateThemePreference("uid-1", { mode: "DARK" });

    expect(upsertThemePreference).toHaveBeenCalledWith("uid-1", { mode: "DARK" });
    expect(theme).toEqual({
      mode: "DARK",
      accentColor: SYSTEM_DEFAULT_THEME.accentColor,
      marketColorConvention: SYSTEM_DEFAULT_THEME.marketColorConvention,
    });
  });
});
