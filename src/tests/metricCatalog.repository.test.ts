import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTx = {
  $executeRaw: vi.fn(async () => 0),
  metricCategory: { deleteMany: vi.fn() },
  metricDefinition: { deleteMany: vi.fn() },
  metricDefinitionField: { deleteMany: vi.fn() },
};

const mockPrisma = {
  $transaction: vi.fn(async (callback: (tx: typeof mockTx) => Promise<void>) => callback(mockTx)),
  metricCategory: { findMany: vi.fn() },
};

vi.mock("@/infrastructure/prisma/index.js", () => ({
  getPrismaClient: () => mockPrisma,
}));

import { listMetricCatalog, replaceMetricCatalog } from "@/infrastructure/prisma/repositories/metricCatalog.repository.js";
import type { MetricCategory } from "@/application/metricCatalog/metricCatalog.types.js";

const SAMPLE_CATALOG: MetricCategory[] = [
  {
    key: "profitability",
    name: "Profitability",
    sort: 0,
    metrics: [
      {
        key: "eps",
        name: "EPS",
        path: "/profitability/eps",
        sources: ["公開發行公司損益表（XBRL）"],
        hasProvenance: false,
        formulaVersion: 1,
        sort: 0,
        fields: [
          { key: "epsQuarterly", name: "EPS (quarterly)", period: "quarterly", sort: 0 },
          { key: "epsTtm", name: "EPS (TTM)", period: "ttm", sort: 1 },
        ],
      },
    ],
  },
  {
    key: "guru",
    name: "Guru",
    sort: 1,
    metrics: [
      {
        key: "grahamNumber",
        name: "Graham Number",
        path: "/guru/graham-number",
        sources: ["公開發行公司資產負債表（XBRL）", "公開發行公司損益表（XBRL）"],
        hasProvenance: true,
        formulaVersion: 1,
        sort: 0,
        fields: [{ key: "grahamNumber", name: "Graham Number", period: "ttm", sort: 0 }],
      },
    ],
  },
];

describe("listMetricCatalog", () => {
  beforeEach(() => {
    vi.mocked(mockPrisma.metricCategory.findMany).mockReset();
  });

  // The response array is already in display order (queried with orderBy: position asc at every
  // level), but a frontend that reorders/filters the array client-side loses that implicit order — this
  // exposes the same "position" column explicitly as "sort" so it survives that kind of transformation.
  it("exposes each level's internal position as an explicit sort number", async () => {
    vi.mocked(mockPrisma.metricCategory.findMany).mockResolvedValue([
      {
        key: "technicals",
        name: "Technicals",
        position: 3,
        metrics: [
          {
            key: "bias",
            name: "BIAS",
            path: "/technicals/bias",
            description: null,
            source: null,
            position: 2,
            fields: [
              { key: "bias5d", name: "5 日乖離率", period: "daily", description: null, source: null, position: 0 },
              { key: "bias20d", name: "20 日乖離率", period: "daily", description: null, source: null, position: 1 },
            ],
          },
        ],
      },
    ] as never);

    const result = await listMetricCatalog();

    expect(result[0]?.sort).toBe(3);
    expect(result[0]?.metrics[0]?.sort).toBe(2);
    expect(result[0]?.metrics[0]?.fields[0]?.sort).toBe(0);
    expect(result[0]?.metrics[0]?.fields[1]?.sort).toBe(1);
  });

  // Coverage for the description/source tooltip fields (added to support frontend info-icon tooltips
  // per the "資料定義/來源透明" product ask). oingg-analysis-ts's actual convention (confirmed with
  // them directly) is to fill these in at the metric level only — the quarterly/TTM/etc. period
  // variants of one metric share the same definition and source, so it's not repeated per field.
  // A field without its own description/source must fall back to its metric's, so the frontend can
  // always just read field.description/field.source without knowing this upstream convention.
  it("falls back to the metric's description/source for a field that has none of its own", async () => {
    vi.mocked(mockPrisma.metricCategory.findMany).mockResolvedValue([
      {
        key: "profitability",
        name: "Profitability",
        position: 0,
        metrics: [
          {
            key: "roe",
            name: "ROE",
            path: "/profitability/roe",
            description: "股東權益報酬率，衡量股東投入資本的獲利效率。",
            source: "MOPS 季報財務比率",
            position: 0,
            fields: [
              { key: "roeTtmPct", name: "ROE", period: "ttm", description: null, source: null, position: 0 },
            ],
          },
        ],
      },
    ] as never);

    const result = await listMetricCatalog();

    expect(result[0]?.metrics[0]).toMatchObject({
      key: "roe",
      description: "股東權益報酬率，衡量股東投入資本的獲利效率。",
      source: "MOPS 季報財務比率",
    });
    expect(result[0]?.metrics[0]?.fields[0]).toMatchObject({
      key: "roeTtmPct",
      description: "股東權益報酬率，衡量股東投入資本的獲利效率。",
      source: "MOPS 季報財務比率",
    });
  });

  // Coverage for the unit field (percent/currency/times/ratio) — same metric-level-default,
  // field-can-override convention as description/source, but unlike those two, a field overriding its
  // metric's unit is a real, observed case (not just theoretical): dupont's own unit is "percent" but
  // dupont.assetTurnoverQuarterly is "times" — verified live against analysis-ts's real /filters response.
  it("falls back to the metric's unit for a field that has none of its own", async () => {
    vi.mocked(mockPrisma.metricCategory.findMany).mockResolvedValue([
      {
        key: "profitability",
        name: "Profitability",
        position: 0,
        metrics: [
          {
            key: "dupont",
            name: "杜邦分析",
            path: "/profitability/dupont",
            description: null,
            source: null,
            unit: "percent",
            position: 0,
            fields: [
              {
                key: "decomposedRoeQuarterlyPct",
                name: "組裝 ROE（杜邦）",
                period: "quarterly",
                description: null,
                source: null,
                unit: null,
                position: 0,
              },
              {
                key: "assetTurnoverQuarterly",
                name: "總資產周轉率",
                period: "quarterly",
                description: null,
                source: null,
                unit: "times",
                position: 1,
              },
            ],
          },
        ],
      },
    ] as never);

    const result = await listMetricCatalog();

    expect(result[0]?.metrics[0]?.unit).toBe("percent");
    // No unit of its own -> falls back to the metric's "percent".
    expect(result[0]?.metrics[0]?.fields[0]).toMatchObject({ key: "decomposedRoeQuarterlyPct", unit: "percent" });
    // Has its own unit -> keeps "times", doesn't inherit the metric's "percent".
    expect(result[0]?.metrics[0]?.fields[1]).toMatchObject({ key: "assetTurnoverQuarterly", unit: "times" });
  });

  it("keeps a field's own description/source when it has one, rather than always preferring the metric's", async () => {
    vi.mocked(mockPrisma.metricCategory.findMany).mockResolvedValue([
      {
        key: "profitability",
        name: "Profitability",
        position: 0,
        metrics: [
          {
            key: "roe",
            name: "ROE",
            path: "/profitability/roe",
            description: "metric-level definition",
            source: "metric-level source",
            position: 0,
            fields: [
              {
                key: "roeTtmPct",
                name: "ROE",
                period: "ttm",
                description: "field-level definition",
                source: "field-level source",
                position: 0,
              },
            ],
          },
        ],
      },
    ] as never);

    const result = await listMetricCatalog();

    expect(result[0]?.metrics[0]?.fields[0]).toMatchObject({
      description: "field-level definition",
      source: "field-level source",
    });
  });

  it("stays null when neither the field nor its metric has a description/source yet", async () => {
    vi.mocked(mockPrisma.metricCategory.findMany).mockResolvedValue([
      {
        key: "profitability",
        name: "Profitability",
        position: 0,
        metrics: [
          {
            key: "roe",
            name: "ROE",
            path: "/profitability/roe",
            description: null,
            source: null,
            position: 0,
            fields: [
              { key: "roeTtmPct", name: "ROE", period: "ttm", description: null, source: null, position: 0 },
            ],
          },
        ],
      },
    ] as never);

    const result = await listMetricCatalog();

    expect(result[0]?.metrics[0]?.fields[0]).toMatchObject({ description: null, source: null });
  });
});

describe("replaceMetricCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regression test: this used to `deleteMany()` the whole table then `createMany()` fresh rows on
  // every sync (called once at every server startup). MetricDefinitionField cascades onDelete into
  // ScreenerPresetFilter, so recreating a field that already existed — same key, same data — silently
  // wiped every user's saved preset filters on every restart, even though nothing about that field
  // actually changed. Upserting by natural key must leave an unchanged/kept row's identity intact
  // (no delete at all for it), and only ever delete a row that's genuinely absent from the new catalog.
  it("upserts via a single batched statement per table instead of wiping and recreating every row", async () => {
    await replaceMetricCatalog(SAMPLE_CATALOG);

    // One batched INSERT ... ON CONFLICT DO UPDATE per table (category/metric/field) — never a
    // deleteMany() covering rows that are still present in the new catalog.
    expect(mockTx.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it("only deletes rows that are genuinely absent from the new catalog, not the whole table", async () => {
    await replaceMetricCatalog(SAMPLE_CATALOG);

    expect(mockTx.metricCategory.deleteMany).toHaveBeenCalledWith({
      where: { key: { notIn: ["profitability", "guru"] } },
    });
    expect(mockTx.metricDefinition.deleteMany).toHaveBeenCalledWith({
      where: { key: { notIn: ["eps", "grahamNumber"] } },
    });
    expect(mockTx.metricDefinitionField.deleteMany).toHaveBeenCalledWith({
      where: {
        NOT: {
          OR: [
            { metricKey: "eps", key: "epsQuarterly" },
            { metricKey: "eps", key: "epsTtm" },
            { metricKey: "grahamNumber", key: "grahamNumber" },
          ],
        },
      },
    });
  });

  it("deletes everything when the new catalog is empty, instead of leaving stale rows behind", async () => {
    await replaceMetricCatalog([]);

    expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    expect(mockTx.metricDefinitionField.deleteMany).toHaveBeenCalledWith({ where: {} });
    expect(mockTx.metricDefinition.deleteMany).toHaveBeenCalledWith({ where: { key: { notIn: [] } } });
    expect(mockTx.metricCategory.deleteMany).toHaveBeenCalledWith({ where: { key: { notIn: [] } } });
  });

  it("stays at a fixed number of queries no matter how many categories/metrics/fields there are", async () => {
    const bigCatalog: MetricCategory[] = Array.from({ length: 10 }, (_, categoryIndex) => ({
      key: `category${categoryIndex}`,
      name: `Category ${categoryIndex}`,
      sort: categoryIndex,
      metrics: Array.from({ length: 5 }, (_, metricIndex) => ({
        key: `category${categoryIndex}-metric${metricIndex}`,
        name: `Metric ${metricIndex}`,
        path: `/category${categoryIndex}/metric${metricIndex}`,
        sources: [],
        hasProvenance: false,
        formulaVersion: 1,
        sort: metricIndex,
        fields: Array.from({ length: 3 }, (_, fieldIndex) => ({
          key: `field${fieldIndex}`,
          name: `Field ${fieldIndex}`,
          period: "quarterly",
          sort: fieldIndex,
        })),
      })),
    }));

    await replaceMetricCatalog(bigCatalog);

    const totalCalls =
      mockTx.$executeRaw.mock.calls.length +
      mockTx.metricCategory.deleteMany.mock.calls.length +
      mockTx.metricDefinition.deleteMany.mock.calls.length +
      mockTx.metricDefinitionField.deleteMany.mock.calls.length;

    expect(totalCalls).toBe(6);
  });
});

/**
 * **這一組是 2026-09-26 一個真 bug 的迴歸測試，而那個 bug 四項檢查全綠還是溜過去了。**
 *
 * 加 `nameEn` 時我改了 metricRows 的物件對映，卻沒改下面那句 raw SQL 的欄位清單。物件多一個屬性而 SQL
 * 沒有，**TypeScript 不會報錯**——同步回 200、metricCount 156、測試全過，實測 0/156 有值。
 *
 * 所以這裡不驗「有沒有呼叫」，而是驗**產生的 SQL 本身**：欄位清單要有那一欄，值要真的被綁進去。
 * 之後任何人往 metric_definition 加欄位，照這個形狀加一條，就不會重蹈。
 */
describe("replaceMetricCatalog 產生的 SQL 真的帶上每一個欄位", () => {
  // 這一組讀的是 mock.calls[1]，所以每條測試都要從乾淨的 mock 開始——前一條測試的呼叫留著的話，
  // 索引 1 會指到別人的 SQL（第一次寫就是這樣拿到上一條測試產生的 900 個值）。
  beforeEach(() => {
    mockTx.$executeRaw.mockClear();
  });

  /**
   * `mockTx.$executeRaw` 宣告成 `vi.fn(async () => 0)`，參數被推成空 tuple，所以直接寫 `calls[1][0]`
   * 會讓 `npm run typecheck` 紅（測試照樣綠）。先轉成明確的 tuple 型別再取，不要靠索引硬取。
   */
  type RawCall = [strings: string[], fragment?: { values?: unknown[] }];

  function metricInsert() {
    // 三句 INSERT 依序是 category / metric / field，取中間那句。
    const call = mockTx.$executeRaw.mock.calls[1] as unknown as RawCall | undefined;
    const strings = call?.[0] ?? [];
    // 內插進來的是**一個** Prisma.Sql 片段（Prisma.join 的結果），不是攤平的值，所以要往裡面取一層。
    return { sql: [...strings].join(" "), values: call?.[1]?.values ?? [] };
  }

  it("metric 的 INSERT 欄位清單涵蓋 schema 上所有可寫欄位", async () => {
    await replaceMetricCatalog(SAMPLE_CATALOG);
    const { sql } = metricInsert();

    for (const column of [
      "key", "category_key", "name", "name_en", "path", "description", "source",
      "limitations", "misreadings", "unit", "formula_latex", "reference_url",
      "academic_source_url", "badge", "sources", "has_provenance", "formula_version", "position",
    ]) {
      expect(sql, `INSERT 的欄位清單少了 ${column}`).toContain(column);
    }
  });

  it("ON CONFLICT 也要更新 name_en，不然只有新增的列會有值", async () => {
    await replaceMetricCatalog(SAMPLE_CATALOG);
    const { sql } = metricInsert();

    // 型錄是逐次 upsert 的（不是 delete+recreate，見 replaceMetricCatalog 的說明），所以既有的列走
    // ON CONFLICT 那一支。漏在這裡的欄位，症狀是「新指標有值、舊指標永遠是 null」，更難發現。
    expect(sql).toContain("name_en = EXCLUDED.name_en");
  });

  it("nameEn 的值真的被綁進 SQL，不只是欄位名出現在字串裡", async () => {
    await replaceMetricCatalog([
      {
        ...SAMPLE_CATALOG[0]!,
        metrics: [{ ...SAMPLE_CATALOG[0]!.metrics[0]!, key: "roic", name: "投入資本報酬率", nameEn: "ROIC" }],
      },
    ]);
    const { values } = metricInsert();

    expect(values).toContain("ROIC");
    // 中文名稱不得被縮寫取代——兩個都要在。
    expect(values).toContain("投入資本報酬率");
  });

  it("沒有 nameEn 的指標綁 null 而不是 undefined", async () => {
    await replaceMetricCatalog(SAMPLE_CATALOG);
    const { values } = metricInsert();

    // undefined 在 Prisma.sql 裡的行為跟 null 不同，而 SAMPLE_CATALOG 的指標沒有 nameEn。
    expect(values).toContain(null);
    expect(values).not.toContain(undefined);
  });
});

