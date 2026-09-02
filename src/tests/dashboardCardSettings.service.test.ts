import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/domains/user/dashboardCardSettings.repository.js", () => ({
  findDashboardCardSettings: vi.fn(),
  upsertDashboardCardSettings: vi.fn(),
}));

import {
  findDashboardCardSettings,
  upsertDashboardCardSettings,
} from "@/domains/user/dashboardCardSettings.repository.js";
import {
  getDashboardCardSettings,
  updateDashboardCardSettings,
} from "@/domains/user/dashboardCardSettings.service.js";

describe("getDashboardCardSettings", () => {
  beforeEach(() => {
    vi.mocked(findDashboardCardSettings).mockReset();
  });

  // null (not []) signals "no preference saved yet" — the frontend owns what "show everything" means,
  // this service never materializes a default list of its own.
  it("returns null visibleCardIds when the user has no saved row", async () => {
    vi.mocked(findDashboardCardSettings).mockResolvedValue(null);

    const settings = await getDashboardCardSettings("uid-1");

    expect(settings).toEqual({ visibleCardIds: null });
  });

  it("returns the user's explicitly saved list, including an intentionally empty one", async () => {
    vi.mocked(findDashboardCardSettings).mockResolvedValue({ visibleCardIds: [] });

    const settings = await getDashboardCardSettings("uid-1");

    expect(settings).toEqual({ visibleCardIds: [] });
  });

  it("returns the user's saved list of card ids", async () => {
    vi.mocked(findDashboardCardSettings).mockResolvedValue({
      visibleCardIds: ["margin-short-ratio", "revenue-ranking"],
    });

    const settings = await getDashboardCardSettings("uid-1");

    expect(settings).toEqual({ visibleCardIds: ["margin-short-ratio", "revenue-ranking"] });
  });
});

describe("updateDashboardCardSettings", () => {
  beforeEach(() => {
    vi.mocked(upsertDashboardCardSettings).mockReset();
  });

  it("rejects a non-array value", async () => {
    await expect(updateDashboardCardSettings("uid-1", "margin-short-ratio")).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(updateDashboardCardSettings("uid-1", undefined)).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateDashboardCardSettings("uid-1", null)).rejects.toMatchObject({ statusCode: 400 });
    expect(upsertDashboardCardSettings).not.toHaveBeenCalled();
  });

  it("rejects an array containing a non-string element", async () => {
    await expect(updateDashboardCardSettings("uid-1", ["margin-short-ratio", 123])).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(upsertDashboardCardSettings).not.toHaveBeenCalled();
  });

  it("persists a valid list and returns it, without validating membership against a known card id list", async () => {
    vi.mocked(upsertDashboardCardSettings).mockResolvedValue({
      visibleCardIds: ["margin-short-ratio", "some-brand-new-card-id"],
    });

    const settings = await updateDashboardCardSettings("uid-1", ["margin-short-ratio", "some-brand-new-card-id"]);

    expect(upsertDashboardCardSettings).toHaveBeenCalledWith("uid-1", [
      "margin-short-ratio",
      "some-brand-new-card-id",
    ]);
    expect(settings).toEqual({ visibleCardIds: ["margin-short-ratio", "some-brand-new-card-id"] });
  });

  // An intentionally empty list (user hid every card) must persist as [], not be rejected or coerced.
  it("persists an intentionally empty list", async () => {
    vi.mocked(upsertDashboardCardSettings).mockResolvedValue({ visibleCardIds: [] });

    const settings = await updateDashboardCardSettings("uid-1", []);

    expect(upsertDashboardCardSettings).toHaveBeenCalledWith("uid-1", []);
    expect(settings).toEqual({ visibleCardIds: [] });
  });
});
