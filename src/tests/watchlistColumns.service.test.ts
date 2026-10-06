import { describe, expect, it, vi } from "vitest";
import { fakeUserPreferences } from "@/tests/fakes/userPreferences.js";
import { fakeSubscriptions, fakeUserPort } from "@/tests/fakes/billing.js";
import { fakeCatalogLookup, fakeMetricCatalog } from "@/tests/fakes/metricCatalog.js";
import { updateWatchlistColumns } from "@/application/user/watchlistColumns.service.js";
import type { WatchlistColumn } from "@/application/user/watchlistColumns.types.js";

/** web-nuxt 2026-10-06 的 5 欄預設：兩個報價欄位之一、兩個型錄欄位、兩個前端合成欄位。 */
const DEFAULTS: WatchlistColumn[] = [
  { field: "stock.price", label: "股價" },
  { field: "watchlist.change", label: "漲跌" },
  { field: "exchangePeRatio.EOD", label: "本益比" },
  { field: "exchangePbRatio.EOD", label: "股價淨值比" },
  { field: "watchlist.exDividend", label: "下次除權息" },
];

function deps(stored: WatchlistColumn[] | null = null) {
  const lookup = (metricKey: string, fieldKey: string) => ({ metricKey, fieldKey, metricName: metricKey, fieldName: fieldKey, categoryKey: "valuation", period: fieldKey, unit: null });
  return {
    userPreferences: fakeUserPreferences({ getWatchlistColumns: vi.fn().mockResolvedValue(stored) }),
    metricCatalog: fakeMetricCatalog({
      findFields: vi.fn().mockImplementation(
        fakeCatalogLookup({
          "exchangePeRatio.EOD": lookup("exchangePeRatio", "EOD"),
          "exchangePbRatio.EOD": lookup("exchangePbRatio", "EOD"),
          "roe.TTM": lookup("roe", "TTM"),
        }),
      ),
    }),
    // fakeUserPort 預設是試用期早已結束的使用者，也就是 FREE。
    subscriptions: fakeSubscriptions(),
    user: fakeUserPort(),
  };
}

describe("updateWatchlistColumns", () => {
  // 預設清單本身就含前端合成欄位——不放行的話預設清單永遠存不進來。
  it("saves the frontend's default list, including its two synthetic fields", async () => {
    const d = deps();

    await expect(updateWatchlistColumns("uid1", DEFAULTS, d)).resolves.toEqual({ columns: DEFAULTS });
  });

  it.each(["nope.EOD", "watchlist.somethingElse", "noDot"])("rejects an unknown field %s with 400 and saves nothing", async (field) => {
    const d = deps();

    await expect(updateWatchlistColumns("uid1", [...DEFAULTS, { field, label: "x" }], d)).rejects.toMatchObject({ statusCode: 400 });
    expect(d.userPreferences.saveWatchlistColumns).not.toHaveBeenCalled();
  });

  /** 使用者 2026-10-06：「免費 3 欄、付費無上限」。額度 8 ＝ 5 欄預設 ＋ 3 欄自訂（見 quota.ts）。 */
  it("lets a free user add 3 columns to the defaults but not a 4th", async () => {
    const extra = (n: number) => Array.from({ length: n }, () => ({ field: "roe.TTM", label: "ROE" }));

    await expect(updateWatchlistColumns("uid1", [...DEFAULTS, ...extra(3)], deps())).resolves.toBeDefined();
    await expect(updateWatchlistColumns("uid1", [...DEFAULTS, ...extra(4)], deps())).rejects.toMatchObject({
      statusCode: 403,
      code: "quota_exceeded",
    });
  });
});
