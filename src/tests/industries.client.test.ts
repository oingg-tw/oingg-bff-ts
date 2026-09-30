import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchIndustryFlatList,
  fetchIndustryTree,
  fetchSectorDividendSummary,
  fetchSecuritiesSectors,
} from "@/infrastructure/analysisApi/industries/industries.client.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_FILTERS_URL = process.env.FILTERS_SERVICE_URL;
const ORIGINAL_BFF_API_KEY = process.env.BFF_API_KEY;

beforeEach(() => {
  process.env.FILTERS_SERVICE_URL = "http://filters.test";
  process.env.BFF_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_FILTERS_URL === undefined) {
    delete process.env.FILTERS_SERVICE_URL;
  } else {
    process.env.FILTERS_SERVICE_URL = ORIGINAL_FILTERS_URL;
  }
  if (ORIGINAL_BFF_API_KEY === undefined) {
    delete process.env.BFF_API_KEY;
  } else {
    process.env.BFF_API_KEY = ORIGINAL_BFF_API_KEY;
  }
});

function mockFetchOnce(response: { ok: boolean; status?: number; body: unknown }) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    json: () => Promise.resolve(response.body),
  }) as unknown as typeof fetch;
}

const ROOT_RESPONSE = {
  found: true,
  code: null,
  level: null,
  name: null,
  companyCount: 999,
  children: [
    { code: "A", level: "section", name: "農、林、漁、牧業", companyCount: 4, hasChildren: true },
    { code: "O", level: "section", name: "公共行政及國防；強制性社會安全", companyCount: 0, hasChildren: true },
  ],
  companies: [],
};

const LEAF_RESPONSE = {
  found: true,
  code: "2711-00",
  level: "subclass",
  name: "電腦製造業",
  companyCount: 18,
  children: [],
  companies: [{ symbol: "2317", companyName: "鴻海" }],
};

const NOT_FOUND_RESPONSE = {
  found: false,
  code: "ZZZZ-NOPE",
  level: null,
  name: null,
  companyCount: 0,
  children: [],
  companies: [],
};

describe("fetchIndustryTree", () => {
  it("requests /industries/tree without a code param when omitted, and normalizes the root response", async () => {
    mockFetchOnce({ ok: true, body: ROOT_RESPONSE });

    const result = await fetchIndustryTree();

    expect(result).toEqual(ROOT_RESPONSE);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/industries/tree");
  });

  // hasChildren can be true even when companyCount is 0 — the dictionary has children even if no
  // tracked company currently falls under this node. Normalization must preserve this, not collapse it.
  it("preserves a zero companyCount alongside hasChildren: true", async () => {
    mockFetchOnce({ ok: true, body: ROOT_RESPONSE });

    const result = await fetchIndustryTree();

    const empty = result.children.find((c) => c.code === "O");
    expect(empty).toEqual({ code: "O", level: "section", name: "公共行政及國防；強制性社會安全", companyCount: 0, hasChildren: true });
  });

  it("requests /industries/tree?code= with the given code and normalizes a leaf (subclass) response", async () => {
    mockFetchOnce({ ok: true, body: LEAF_RESPONSE });

    const result = await fetchIndustryTree("2711-00");

    expect(result).toEqual(LEAF_RESPONSE);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/industries/tree?code=2711-00");
  });

  it("returns found:false for an unknown code, without throwing", async () => {
    mockFetchOnce({ ok: true, body: NOT_FOUND_RESPONSE });

    await expect(fetchIndustryTree("ZZZZ-NOPE")).resolves.toEqual(NOT_FOUND_RESPONSE);
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchIndustryTree("C")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchIndustryTree("C")).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a 502 AppError when the response is missing a boolean "found" field', async () => {
    mockFetchOnce({ ok: true, body: { code: "C" } });

    await expect(fetchIndustryTree("C")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when a child has an unrecognized level", async () => {
    mockFetchOnce({
      ok: true,
      body: { ...ROOT_RESPONSE, children: [{ code: "X", level: "not-a-real-level", name: "x", companyCount: 1, hasChildren: false }] },
    });

    await expect(fetchIndustryTree()).rejects.toMatchObject({ statusCode: 502 });
  });
});

// Real entry given directly by analysis-ts (2026-09-09).
const FLAT_LIST_RESPONSE = {
  companies: [
    {
      symbol: "2330",
      companyName: "台積電",
      path: [
        { code: "C", level: "section", name: "製造業" },
        { code: "26", level: "division", name: "電子零組件製造業" },
        { code: "261", level: "group", name: "半導體製造業" },
        { code: "2611", level: "class", name: "積體電路製造業" },
        { code: "2611-99", level: "subclass", name: "其他積體電路製造" },
      ],
    },
  ],
};

describe("fetchIndustryFlatList", () => {
  it("requests /industries/flat with no query params and normalizes the response", async () => {
    mockFetchOnce({ ok: true, body: FLAT_LIST_RESPONSE });

    const result = await fetchIndustryFlatList();

    expect(result).toEqual(FLAT_LIST_RESPONSE);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/industries/flat");
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchIndustryFlatList()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchIndustryFlatList()).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a 502 AppError when the response is missing a "companies" array', async () => {
    mockFetchOnce({ ok: true, body: { oops: true } });

    await expect(fetchIndustryFlatList()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when a company's path has an unrecognized level", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        companies: [
          { symbol: "2330", companyName: "台積電", path: [{ code: "X", level: "not-a-real-level", name: "x" }] },
        ],
      },
    });

    await expect(fetchIndustryFlatList()).rejects.toMatchObject({ statusCode: 502 });
  });
});

// Real shape given directly by analysis-ts (2026-09-11).
const SECTORS_RESPONSE = {
  sectors: [
    { code: "01", name: "水泥工業", companyCount: 8 },
    { code: "24", name: "半導體業", companyCount: 240 },
  ],
};

describe("fetchSecuritiesSectors", () => {
  it("requests /industries/securities-sectors with no query params and normalizes the response", async () => {
    mockFetchOnce({ ok: true, body: SECTORS_RESPONSE });

    const result = await fetchSecuritiesSectors();

    expect(result).toEqual(SECTORS_RESPONSE);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/industries/securities-sectors");
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchSecuritiesSectors()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchSecuritiesSectors()).rejects.toMatchObject({ statusCode: 502 });
  });

  it('throws a 502 AppError when the response is missing a "sectors" array', async () => {
    mockFetchOnce({ ok: true, body: { oops: true } });

    await expect(fetchSecuritiesSectors()).rejects.toMatchObject({ statusCode: 502 });
  });
});

/**
 * 類股股利統計（上游 2026-09-30 新增）。這裡守的不是「有沒有回傳資料」，是**兩個容易把散佈圖畫錯的欄位語意**：
 * 每一軸的 `count` 不得被丟掉或猜測（它是唯一告訴下游這個點代表多少家公司的東西——實測油電燃氣業的成長率
 * 只有 2 家），而 `mean`/`median` 是 nullable、不能被 `Number()` 變成 0。
 */
describe("fetchSectorDividendSummary", () => {
  /** 貼近實際回應（2026-09-30 的 01 水泥工業與 27 油電燃氣業）。 */
  const RAW = {
    dividendYieldTradeDate: "2026-09-30",
    sectors: [
      { sectorCode: "01", sectorName: "水泥工業", companyCount: 7, dividendYield: { count: 7, mean: 5.48, median: 6.44 }, dividendGrowthRate3y: { count: 7, mean: 2.9, median: 7.72 } },
      { sectorCode: "27", sectorName: "油電燃氣業", companyCount: 12, dividendYield: { count: 12, mean: 3.1, median: 3.0 }, dividendGrowthRate3y: { count: 2, mean: -45.87, median: -45.87 } },
    ],
  };

  it("原樣轉發，兩軸的 count 各自保留", async () => {
    mockFetchOnce({ ok: true, body: RAW });
    const result = await fetchSectorDividendSummary();

    expect(result).toEqual(RAW);
    // 一個點的 x 與 y 來自不同子母體，所以兩個 count 必須分開帶出來，不能只留一個。
    const gas = result.sectors[1];
    expect(gas?.dividendYield.count).toBe(12);
    expect(gas?.dividendGrowthRate3y.count).toBe(2);
    expect(gas?.companyCount).toBe(12);
  });

  /**
   * **這一條守的是 `Number(null)` 是 0 這個坑。** count 為 0 時上游給 null，若哪天有人把這裡改成
   * `Number(r.mean)`，散佈圖會把「沒有樣本」畫成原點上的一個點，而 0% 殖利率看起來完全像一個真實的值。
   */
  it("count 為 0 時 mean 與 median 保持 null，不變成 0", async () => {
    mockFetchOnce({
      ok: true,
      body: { dividendYieldTradeDate: "2026-09-30", sectors: [{ sectorCode: "99", sectorName: "測試業", companyCount: 3, dividendYield: { count: 0, mean: null, median: null }, dividendGrowthRate3y: { count: 0, mean: null, median: null } }] },
    });
    const row = (await fetchSectorDividendSummary()).sectors[0];

    expect(row?.dividendYield.count).toBe(0);
    expect(row?.dividendYield.mean).toBeNull();
    expect(row?.dividendYield.median).toBeNull();
    expect(row?.dividendGrowthRate3y.mean).toBeNull();
  });

  /** 真實的 0（例如平均剛好是 0）不得被當成缺值——跟上面那條是反向的同一個界線。 */
  it("mean 真的是 0 時保留 0，不變成 null", async () => {
    mockFetchOnce({
      ok: true,
      body: { dividendYieldTradeDate: "2026-09-30", sectors: [{ sectorCode: "98", sectorName: "測試業", companyCount: 4, dividendYield: { count: 4, mean: 0, median: 0 }, dividendGrowthRate3y: { count: 4, mean: 0, median: -1.5 } }] },
    });
    const row = (await fetchSectorDividendSummary()).sectors[0];

    expect(row?.dividendYield.mean).toBe(0);
    expect(row?.dividendYield.mean).not.toBeNull();
    expect(row?.dividendGrowthRate3y.median).toBe(-1.5);
  });

  /**
   * 整個 stats 物件缺席時 count 給 0、mean/median 給 null，**不丟 502**。方向是安全的那一邊：下游的最小 n
   * 門檻會把 count 0 擋掉，而猜一個家數才會讓人以為那個平均有代表性。
   */
  it("stats 物件缺席時 count 為 0 而不是丟錯", async () => {
    mockFetchOnce({
      ok: true,
      body: { dividendYieldTradeDate: null, sectors: [{ sectorCode: "97", sectorName: "測試業", companyCount: 5 }] },
    });
    const row = (await fetchSectorDividendSummary()).sectors[0];

    expect(row?.dividendYield.count).toBe(0);
    expect(row?.dividendYield.mean).toBeNull();
    expect(row?.dividendGrowthRate3y.count).toBe(0);
  });

  it("dividendYieldTradeDate 缺席或非字串時為 null", async () => {
    mockFetchOnce({ ok: true, body: { sectors: [] } });
    await expect(fetchSectorDividendSummary()).resolves.toEqual({ dividendYieldTradeDate: null, sectors: [] });
  });

  it("回應缺 sectors 陣列時丟 502", async () => {
    mockFetchOnce({ ok: true, body: { dividendYieldTradeDate: "2026-09-30" } });
    await expect(fetchSectorDividendSummary()).rejects.toMatchObject({ statusCode: 502 });
  });

  it("上游非 2xx 時丟 502", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });
    await expect(fetchSectorDividendSummary()).rejects.toMatchObject({ statusCode: 502 });
  });
});
