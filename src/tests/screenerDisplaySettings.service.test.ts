import { describe, expect, it, vi } from "vitest";
import { fakeUserPreferences } from "@/tests/fakes/userPreferences.js";
import {
  getDisplaySettings,
  updateShowAsOfDate,
  SYSTEM_DEFAULT_DISPLAY_SETTINGS,
} from "@/application/user/screenerDisplaySettings.service.js";

describe("getDisplaySettings", () => {
  it("falls back to the system default (hidden) when the user has no saved row", async () => {
    const userPreferences = fakeUserPreferences();

    const settings = await getDisplaySettings("uid-1", { userPreferences });

    expect(settings).toEqual(SYSTEM_DEFAULT_DISPLAY_SETTINGS);
    expect(userPreferences.getScreenerDisplaySettings).toHaveBeenCalledWith("uid-1");
  });

  it("falls back to the system default when the row exists but the field was never explicitly set", async () => {
    const userPreferences = fakeUserPreferences({
      getScreenerDisplaySettings: vi.fn().mockResolvedValue({ showAsOfDate: null }),
    });

    const settings = await getDisplaySettings("uid-1", { userPreferences });

    expect(settings).toEqual({ showAsOfDate: SYSTEM_DEFAULT_DISPLAY_SETTINGS.showAsOfDate });
  });

  it("returns the user's explicitly saved value", async () => {
    const userPreferences = fakeUserPreferences({
      getScreenerDisplaySettings: vi.fn().mockResolvedValue({ showAsOfDate: true }),
    });

    const settings = await getDisplaySettings("uid-1", { userPreferences });

    expect(settings).toEqual({ showAsOfDate: true });
  });
});

describe("updateShowAsOfDate", () => {
  it("rejects a non-boolean value", async () => {
    const userPreferences = fakeUserPreferences();

    await expect(updateShowAsOfDate("uid-1", "yes", { userPreferences })).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateShowAsOfDate("uid-1", undefined, { userPreferences })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(userPreferences.saveScreenerDisplaySettings).not.toHaveBeenCalled();
  });

  it("persists true and returns it", async () => {
    const userPreferences = fakeUserPreferences({
      saveScreenerDisplaySettings: vi.fn().mockResolvedValue({ showAsOfDate: true }),
    });

    const settings = await updateShowAsOfDate("uid-1", true, { userPreferences });

    expect(userPreferences.saveScreenerDisplaySettings).toHaveBeenCalledWith("uid-1", true);
    expect(settings).toEqual({ showAsOfDate: true });
  });

  it("persists false and returns it (not treated as falsy/missing)", async () => {
    const userPreferences = fakeUserPreferences({
      saveScreenerDisplaySettings: vi.fn().mockResolvedValue({ showAsOfDate: false }),
    });

    const settings = await updateShowAsOfDate("uid-1", false, { userPreferences });

    expect(userPreferences.saveScreenerDisplaySettings).toHaveBeenCalledWith("uid-1", false);
    expect(settings).toEqual({ showAsOfDate: false });
  });
});
