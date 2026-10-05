import { describe, expect, it, vi } from "vitest";
import { fakeUserPreferences } from "@/tests/fakes/userPreferences.js";
import { fakeSubscriptions, fakeUserPort } from "@/tests/fakes/billing.js";
import { wouldGrowPastQuota } from "@/application/billing/quota.js";
import { getHoldingColumns, updateHoldingColumns } from "@/application/user/holdingColumns.service.js";
import type { HoldingColumn } from "@/application/user/holdingColumns.types.js";

function column(id: string, formula = "=D/A"): HoldingColumn {
  return { id, label: `欄位 ${id}`, formula, format: "number", decimals: 2 };
}

function deps(stored: HoldingColumn[] | null = null) {
  return {
    userPreferences: fakeUserPreferences({ getHoldingColumns: vi.fn().mockResolvedValue(stored) }),
    subscriptions: fakeSubscriptions(),
    user: fakeUserPort(),
  };
}

describe("wouldGrowPastQuota", () => {
  /**
   * 整份覆蓋的額度規則。只看「新長度 > 上限」的話，降級後存著 5 欄、上限 3 的使用者連重排都會被擋——
   * 違反「降級只變唯讀、永不刪除」。
   */
  it.each<[number, number, number | null, boolean, string]>([
    [4, 0, 3, true, "a fresh list over the limit"],
    [3, 0, 3, false, "exactly at the limit"],
    [5, 5, 3, false, "editing or reordering while already over (downgraded user)"],
    [4, 5, 3, false, "shrinking while still over"],
    [6, 5, 3, true, "growing further while over"],
    [500, 0, null, false, "unlimited"],
  ])("next %i, current %i, limit %s → %s (%s)", (next, current, limit, expected) => {
    expect(wouldGrowPastQuota(next, current, limit)).toBe(expected);
  });
});

describe("holding columns service", () => {
  it("returns null, not [], when nothing was ever saved", async () => {
    await expect(getHoldingColumns("uid1", deps(null))).resolves.toEqual({ columns: null });
  });

  it("rejects a duplicate id within the list", async () => {
    const d = deps();

    await expect(updateHoldingColumns("uid1", [column("a"), column("a")], d)).rejects.toMatchObject({ statusCode: 400 });
    expect(d.userPreferences.saveHoldingColumns).not.toHaveBeenCalled();
  });

  it("saves the whole list in order", async () => {
    const d = deps();
    const columns = [column("h", "=D/A"), column("i", "=ROUND(H*100, 2)")];

    await expect(updateHoldingColumns("uid1", columns, d)).resolves.toEqual({ columns });
    expect(d.userPreferences.saveHoldingColumns).toHaveBeenCalledWith("uid1", columns);
  });

  /**
   * 使用者 2026-10-05：「免費 3 個、付費無上限」。額度是 10，因為清單裡含 web-nuxt 的 7 欄預設欄
   * （見 quota.ts）。fakeUserPort 預設是試用期早已結束的使用者，也就是 FREE。
   */
  const many = (n: number) => Array.from({ length: n }, (_, i) => column(`c${i}`));

  it("lets a free user save 7 built-in + 3 custom columns, and blocks the 11th", async () => {
    await expect(updateHoldingColumns("uid1", many(10), deps())).resolves.toBeDefined();
    await expect(updateHoldingColumns("uid1", many(11), deps())).rejects.toMatchObject({ statusCode: 403, code: "quota_exceeded" });
  });

  // 降級只變唯讀、永不刪除：已經存了 12 欄的人可以重排或編輯，只是不能再變多。
  it("lets a downgraded user over the cap keep editing, but not grow", async () => {
    await expect(updateHoldingColumns("uid1", many(12), deps(many(12)))).resolves.toBeDefined();
    await expect(updateHoldingColumns("uid1", many(11), deps(many(12)))).resolves.toBeDefined();
    await expect(updateHoldingColumns("uid1", many(13), deps(many(12)))).rejects.toMatchObject({ statusCode: 403 });
  });
});
