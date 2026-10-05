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

  it("saves the whole list in order (no tier limit set yet)", async () => {
    const d = deps();
    const columns = [column("h", "=D/A"), column("i", "=ROUND(H*100, 2)")];

    await expect(updateHoldingColumns("uid1", columns, d)).resolves.toEqual({ columns });
    expect(d.userPreferences.saveHoldingColumns).toHaveBeenCalledWith("uid1", columns);
  });
});
