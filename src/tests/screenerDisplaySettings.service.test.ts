import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../domains/user/screenerDisplaySettings.repository.js", () => ({
  findDisplaySettings: vi.fn(),
  upsertDisplaySettings: vi.fn(),
}));

import { findDisplaySettings, upsertDisplaySettings } from "../domains/user/screenerDisplaySettings.repository.js";
import {
  getDisplaySettings,
  updateShowAsOfDate,
  SYSTEM_DEFAULT_DISPLAY_SETTINGS,
} from "../domains/user/screenerDisplaySettings.service.js";

describe("getDisplaySettings", () => {
  beforeEach(() => {
    vi.mocked(findDisplaySettings).mockReset();
  });

  it("falls back to the system default (hidden) when the user has no saved row", async () => {
    vi.mocked(findDisplaySettings).mockResolvedValue(null);

    const settings = await getDisplaySettings("uid-1");

    expect(settings).toEqual(SYSTEM_DEFAULT_DISPLAY_SETTINGS);
  });

  it("falls back to the system default when the row exists but the field was never explicitly set", async () => {
    vi.mocked(findDisplaySettings).mockResolvedValue({ showAsOfDate: null });

    const settings = await getDisplaySettings("uid-1");

    expect(settings).toEqual({ showAsOfDate: SYSTEM_DEFAULT_DISPLAY_SETTINGS.showAsOfDate });
  });

  it("returns the user's explicitly saved value", async () => {
    vi.mocked(findDisplaySettings).mockResolvedValue({ showAsOfDate: true });

    const settings = await getDisplaySettings("uid-1");

    expect(settings).toEqual({ showAsOfDate: true });
  });
});

describe("updateShowAsOfDate", () => {
  beforeEach(() => {
    vi.mocked(upsertDisplaySettings).mockReset();
  });

  it("rejects a non-boolean value", async () => {
    await expect(updateShowAsOfDate("uid-1", "yes")).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateShowAsOfDate("uid-1", undefined)).rejects.toMatchObject({ statusCode: 400 });
    expect(upsertDisplaySettings).not.toHaveBeenCalled();
  });

  it("persists true and returns it", async () => {
    vi.mocked(upsertDisplaySettings).mockResolvedValue({ showAsOfDate: true });

    const settings = await updateShowAsOfDate("uid-1", true);

    expect(upsertDisplaySettings).toHaveBeenCalledWith("uid-1", true);
    expect(settings).toEqual({ showAsOfDate: true });
  });

  it("persists false and returns it (not treated as falsy/missing)", async () => {
    vi.mocked(upsertDisplaySettings).mockResolvedValue({ showAsOfDate: false });

    const settings = await updateShowAsOfDate("uid-1", false);

    expect(upsertDisplaySettings).toHaveBeenCalledWith("uid-1", false);
    expect(settings).toEqual({ showAsOfDate: false });
  });
});
