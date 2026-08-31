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

  // Regression: mode/accentColor are independently nullable — a user who only ever set one of them
  // must still fall back to the live system default for the other, not some frozen value.
  it("falls back to the system default per-field when only one field was ever set", async () => {
    vi.mocked(findThemePreference).mockResolvedValue({ mode: "DARK", accentColor: null });

    const theme = await getThemePreference("uid-1");

    expect(theme).toEqual({ mode: "DARK", accentColor: SYSTEM_DEFAULT_THEME.accentColor });
  });

  it("returns the user's fully-saved preference when both fields are set", async () => {
    vi.mocked(findThemePreference).mockResolvedValue({ mode: "LIGHT", accentColor: "PURPLE" });

    const theme = await getThemePreference("uid-1");

    expect(theme).toEqual({ mode: "LIGHT", accentColor: "PURPLE" });
  });
});

describe("updateThemePreference", () => {
  beforeEach(() => {
    vi.mocked(upsertThemePreference).mockReset();
  });

  it("rejects an update with neither mode nor accentColor", async () => {
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

  it("accepts GOLD as a valid accentColor", async () => {
    vi.mocked(upsertThemePreference).mockResolvedValue({ mode: null, accentColor: "GOLD" });

    const theme = await updateThemePreference("uid-1", { accentColor: "GOLD" });

    expect(upsertThemePreference).toHaveBeenCalledWith("uid-1", { accentColor: "GOLD" });
    expect(theme).toEqual({ mode: SYSTEM_DEFAULT_THEME.mode, accentColor: "GOLD" });
  });

  it("passes a partial update straight through to the repository (only the given field)", async () => {
    vi.mocked(upsertThemePreference).mockResolvedValue({ mode: "DARK", accentColor: null });

    const theme = await updateThemePreference("uid-1", { mode: "DARK" });

    expect(upsertThemePreference).toHaveBeenCalledWith("uid-1", { mode: "DARK" });
    expect(theme).toEqual({ mode: "DARK", accentColor: SYSTEM_DEFAULT_THEME.accentColor });
  });
});
