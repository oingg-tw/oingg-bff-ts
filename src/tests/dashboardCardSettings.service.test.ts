import { describe, expect, it, vi } from "vitest";
import { fakeUserPreferences } from "@/tests/fakes/userPreferences.js";
import {
  getDashboardCardSettings,
  updateDashboardCardSettings,
} from "@/application/user/dashboardCardSettings.service.js";

describe("getDashboardCardSettings", () => {
  // null (not []) signals "no preference saved yet" — the frontend owns what "show everything" means,
  // this service never materializes a default list of its own.
  it("returns null visibleCardIds when the user has no saved row", async () => {
    const userPreferences = fakeUserPreferences();

    const settings = await getDashboardCardSettings("uid-1", { userPreferences });

    expect(settings).toEqual({ visibleCardIds: null });
    expect(userPreferences.getDashboardCards).toHaveBeenCalledWith("uid-1");
  });

  it("returns the user's explicitly saved list, including an intentionally empty one", async () => {
    const userPreferences = fakeUserPreferences({
      getDashboardCards: vi.fn().mockResolvedValue({ visibleCardIds: [] }),
    });

    const settings = await getDashboardCardSettings("uid-1", { userPreferences });

    expect(settings).toEqual({ visibleCardIds: [] });
  });

  it("returns the user's saved list of card ids", async () => {
    const userPreferences = fakeUserPreferences({
      getDashboardCards: vi.fn().mockResolvedValue({ visibleCardIds: ["margin-short-ratio", "revenue-ranking"] }),
    });

    const settings = await getDashboardCardSettings("uid-1", { userPreferences });

    expect(settings).toEqual({ visibleCardIds: ["margin-short-ratio", "revenue-ranking"] });
  });
});

describe("updateDashboardCardSettings", () => {
  it("rejects a non-array value", async () => {
    const userPreferences = fakeUserPreferences();

    await expect(updateDashboardCardSettings("uid-1", "margin-short-ratio", { userPreferences })).rejects.toMatchObject(
      { statusCode: 400 },
    );
    await expect(updateDashboardCardSettings("uid-1", undefined, { userPreferences })).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(updateDashboardCardSettings("uid-1", null, { userPreferences })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(userPreferences.saveDashboardCards).not.toHaveBeenCalled();
  });

  it("rejects an array containing a non-string element", async () => {
    const userPreferences = fakeUserPreferences();

    await expect(
      updateDashboardCardSettings("uid-1", ["margin-short-ratio", 123], { userPreferences }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(userPreferences.saveDashboardCards).not.toHaveBeenCalled();
  });

  it("persists a valid list and returns it, without validating membership against a known card id list", async () => {
    const userPreferences = fakeUserPreferences({
      saveDashboardCards: vi
        .fn()
        .mockResolvedValue({ visibleCardIds: ["margin-short-ratio", "some-brand-new-card-id"] }),
    });

    const settings = await updateDashboardCardSettings(
      "uid-1",
      ["margin-short-ratio", "some-brand-new-card-id"],
      { userPreferences },
    );

    expect(userPreferences.saveDashboardCards).toHaveBeenCalledWith("uid-1", [
      "margin-short-ratio",
      "some-brand-new-card-id",
    ]);
    expect(settings).toEqual({ visibleCardIds: ["margin-short-ratio", "some-brand-new-card-id"] });
  });

  // An intentionally empty list (user hid every card) must persist as [], not be rejected or coerced.
  it("persists an intentionally empty list", async () => {
    const userPreferences = fakeUserPreferences({
      saveDashboardCards: vi.fn().mockResolvedValue({ visibleCardIds: [] }),
    });

    const settings = await updateDashboardCardSettings("uid-1", [], { userPreferences });

    expect(userPreferences.saveDashboardCards).toHaveBeenCalledWith("uid-1", []);
    expect(settings).toEqual({ visibleCardIds: [] });
  });
});
