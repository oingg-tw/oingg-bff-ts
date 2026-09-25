import { describe, expect, it, vi } from "vitest";
import { fakeUserPreferences } from "@/tests/fakes/userPreferences.js";
import {
  getStockDetailPreferences,
  updateStockDetailPreferences,
} from "@/application/user/stockDetailPreferences.service.js";

describe("getStockDetailPreferences", () => {
  // null (not a default-filled object) signals "no preference saved yet" for both fields — the frontend
  // applies its own local default, this service never materializes one.
  it("returns null mode/visibleCardIds when the user has no saved row", async () => {
    const userPreferences = fakeUserPreferences();

    const preferences = await getStockDetailPreferences("uid-1", { userPreferences });

    expect(preferences).toEqual({ mode: null, visibleCardIds: null, pinnedMetricSlugs: null });
    expect(userPreferences.getStockDetailPreferences).toHaveBeenCalledWith("uid-1");
  });

  it("returns the user's explicitly saved list, including an intentionally empty one", async () => {
    const userPreferences = fakeUserPreferences({
      getStockDetailPreferences: vi.fn().mockResolvedValue({ mode: "CARD", visibleCardIds: [], pinnedMetricSlugs: [] }),
    });

    const preferences = await getStockDetailPreferences("uid-1", { userPreferences });

    expect(preferences).toEqual({ mode: "CARD", visibleCardIds: [], pinnedMetricSlugs: [] });
  });

  it("returns the user's saved mode and card ids", async () => {
    const userPreferences = fakeUserPreferences({
      getStockDetailPreferences: vi
        .fn()
        .mockResolvedValue({ mode: "ACCOUNTING", visibleCardIds: ["profile", "revenue"], pinnedMetricSlugs: ["roe"] }),
    });

    const preferences = await getStockDetailPreferences("uid-1", { userPreferences });

    expect(preferences).toEqual({ mode: "ACCOUNTING", visibleCardIds: ["profile", "revenue"], pinnedMetricSlugs: ["roe"] });
  });
});

describe("updateStockDetailPreferences", () => {
  it("rejects a mode outside CARD/ACCOUNTING", async () => {
    const userPreferences = fakeUserPreferences();

    await expect(
      updateStockDetailPreferences("uid-1", "EXPERT", ["profile"], undefined, { userPreferences }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      updateStockDetailPreferences("uid-1", undefined, ["profile"], undefined, { userPreferences }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(userPreferences.saveStockDetailPreferences).not.toHaveBeenCalled();
  });

  it("rejects a non-array visibleCardIds", async () => {
    const userPreferences = fakeUserPreferences();

    await expect(
      updateStockDetailPreferences("uid-1", "CARD", "profile", undefined, { userPreferences }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(userPreferences.saveStockDetailPreferences).not.toHaveBeenCalled();
  });

  it("rejects an array containing a non-string element", async () => {
    const userPreferences = fakeUserPreferences();

    await expect(
      updateStockDetailPreferences("uid-1", "CARD", ["profile", 123], undefined, { userPreferences }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(userPreferences.saveStockDetailPreferences).not.toHaveBeenCalled();
  });

  it("persists a valid mode and list together, without validating card id membership", async () => {
    const userPreferences = fakeUserPreferences({
      saveStockDetailPreferences: vi
        .fn()
        .mockResolvedValue({
          mode: "ACCOUNTING",
          visibleCardIds: ["profile", "some-brand-new-card-id"],
          pinnedMetricSlugs: ["roe", "some-brand-new-slug"],
        }),
    });

    const preferences = await updateStockDetailPreferences(
      "uid-1",
      "ACCOUNTING",
      ["profile", "some-brand-new-card-id"],
      ["roe", "some-brand-new-slug"],
      { userPreferences },
    );

    expect(userPreferences.saveStockDetailPreferences).toHaveBeenCalledWith(
      "uid-1",
      "ACCOUNTING",
      ["profile", "some-brand-new-card-id"],
      ["roe", "some-brand-new-slug"],
    );
    expect(preferences).toEqual({
      mode: "ACCOUNTING",
      visibleCardIds: ["profile", "some-brand-new-card-id"],
      pinnedMetricSlugs: ["roe", "some-brand-new-slug"],
    });
  });

  // An intentionally empty list (user hid every card) must persist as [], not be rejected or coerced.
  it("persists an intentionally empty list", async () => {
    const userPreferences = fakeUserPreferences({
      saveStockDetailPreferences: vi.fn().mockResolvedValue({ mode: "CARD", visibleCardIds: [], pinnedMetricSlugs: [] }),
    });

    const preferences = await updateStockDetailPreferences("uid-1", "CARD", [], [], { userPreferences });

    expect(userPreferences.saveStockDetailPreferences).toHaveBeenCalledWith("uid-1", "CARD", [], []);
    expect(preferences).toEqual({ mode: "CARD", visibleCardIds: [], pinnedMetricSlugs: [] });
  });

  /**
   * **這三條是 pinnedMetricSlugs 三態語意的回歸測試。** 它們守的不是格式而是意思：
   * `undefined` = 不要動、`[]` = 使用者取消了所有釘選、有值 = 釘了這些。任何把 undefined 併成 []
   * 的「簡化」都會讓 web-nuxt 每存一次設定就清空使用者的釘選，而那在測試以外的地方看不出來。
   */
  it("pinnedMetricSlugs 為 undefined 時原樣傳下去，不轉成空陣列", async () => {
    const userPreferences = fakeUserPreferences({
      saveStockDetailPreferences: vi
        .fn()
        .mockResolvedValue({ mode: "CARD", visibleCardIds: ["profile"], pinnedMetricSlugs: ["roe"] }),
    });

    const preferences = await updateStockDetailPreferences("uid-1", "CARD", ["profile"], undefined, { userPreferences });

    // 第四個參數必須是 undefined 而不是 []——後者會清空既有釘選
    expect(userPreferences.saveStockDetailPreferences).toHaveBeenCalledWith("uid-1", "CARD", ["profile"], undefined);
    // 回傳的是 port 讀到的既有值，不是我們憑空補的預設
    expect(preferences.pinnedMetricSlugs).toEqual(["roe"]);
  });

  it("順序原樣保留，不排序也不去重", async () => {
    const order = ["pe-ratio", "roe", "current-ratio", "roe"];
    const userPreferences = fakeUserPreferences({
      saveStockDetailPreferences: vi.fn().mockResolvedValue({ mode: "CARD", visibleCardIds: [], pinnedMetricSlugs: order }),
    });

    const preferences = await updateStockDetailPreferences("uid-1", "CARD", [], order, { userPreferences });

    expect(userPreferences.saveStockDetailPreferences).toHaveBeenCalledWith("uid-1", "CARD", [], order);
    expect(preferences.pinnedMetricSlugs).toEqual(order);
  });

  it("既有列沒有 pinnedMetricSlugs 時讀成 null，不是空陣列", async () => {
    // 2026-09-25 之前存過偏好的使用者：列存在，但那一欄是 null
    const userPreferences = fakeUserPreferences({
      getStockDetailPreferences: vi
        .fn()
        .mockResolvedValue({ mode: "CARD", visibleCardIds: ["profile"], pinnedMetricSlugs: null }),
    });

    const preferences = await getStockDetailPreferences("uid-1", { userPreferences });

    expect(preferences.pinnedMetricSlugs).toBeNull();
    expect(preferences.visibleCardIds).toEqual(["profile"]);
  });
});
