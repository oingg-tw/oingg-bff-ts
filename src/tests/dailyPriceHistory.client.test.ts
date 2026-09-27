import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchDailyPriceHistory } from "@/infrastructure/analysisApi/stock/dailyPriceHistory.client.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_FILTERS_URL = process.env.FILTERS_SERVICE_URL;

beforeEach(() => {
  process.env.FILTERS_SERVICE_URL = "http://filters.test";
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_FILTERS_URL === undefined) {
    delete process.env.FILTERS_SERVICE_URL;
  } else {
    process.env.FILTERS_SERVICE_URL = ORIGINAL_FILTERS_URL;
  }
});

function mockFetchOnce(response: { ok: boolean; status?: number; body: unknown }) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    json: () => Promise.resolve(response.body),
  }) as unknown as typeof fetch;
}

// Real entries given directly by analysis-ts (2026-09-10) — note oldest-to-newest ordering, the opposite
// of foreign-shareholding-history despite sharing the same /stocks/:symbol/... path convention.
// earliestAvailableTradeDate added 2026-09-16.
const RAW_BODY = {
  symbol: "2330",
  entries: [
    { tradeDate: "2026-09-07", open: 2435, high: 2460, low: 2430, close: 2460, volume: 26898329 },
    { tradeDate: "2026-09-08", open: 2465, high: 2505, low: 2460, close: 2470, volume: 28931697 },
  ],
  earliestAvailableTradeDate: "2020-11-02",
};

describe("fetchDailyPriceHistory", () => {
  it("requests analysis-ts's own /stocks/:symbol/daily-price-history path and normalizes entries", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    const result = await fetchDailyPriceHistory("2330");

    expect(result).toEqual(RAW_BODY);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/stocks/2330/daily-price-history");
  });

  it("includes limit in the request when given", async () => {
    mockFetchOnce({ ok: true, body: RAW_BODY });

    await fetchDailyPriceHistory("2330", 500);

    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/stocks/2330/daily-price-history?limit=500");
  });

  it("returns an empty entries array for an unknown symbol, without throwing", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "NOPE", entries: [], earliestAvailableTradeDate: null } });

    await expect(fetchDailyPriceHistory("NOPE")).resolves.toEqual({
      symbol: "NOPE",
      entries: [],
      earliestAvailableTradeDate: null,
    });
  });

  // earliestAvailableTradeDate reflects the symbol's whole history, not just this page — confirmed live it
  // stays put regardless of how `entries` gets truncated by limit.
  it("passes through earliestAvailableTradeDate independent of the entries page/limit", async () => {
    mockFetchOnce({ ok: true, body: { ...RAW_BODY, entries: [RAW_BODY.entries[1]] } });

    const result = await fetchDailyPriceHistory("2330", 1);

    expect(result.entries).toHaveLength(1);
    expect(result.earliestAvailableTradeDate).toBe("2020-11-02");
  });

  // analysis-ts validates limit bounds (1-2000) itself and returns a 400 with a clear message — relayed
  // as-is, same convention as the other history endpoints in this domain.
  it("relays analysis-ts's 400 message for an out-of-range limit", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: "Too big: expected number to be <=2000" } });

    await expect(fetchDailyPriceHistory("2330", 99999)).rejects.toMatchObject({
      statusCode: 400,
      message: "Too big: expected number to be <=2000",
    });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchDailyPriceHistory("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-2xx, non-400 status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchDailyPriceHistory("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing an entries array", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "2330" } });

    await expect(fetchDailyPriceHistory("2330")).rejects.toMatchObject({ statusCode: 502 });
  });
});

/**
 * **2026-09-27 的真 bug 迴歸測試。** 沒成交的交易日，上游回的是 open/high/low/close 全 null，而這支
 * client 原本寫 `close: Number(r.close)` —— **`Number(null)` 是 0，不是 NaN**，所以那些列變成「收盤
 * 0 元」送到前端，股價圖上是掉到零的斷崖。抽 51 檔實測有 4 檔中招（1259、1525、2321），1538 連續四天。
 *
 * 我把它誤報成 analysis-ts 的問題，他們查了資料庫：9 月整月 194,447 列裡 close=0 有 0 筆，沒成交的
 * 一律是 NULL。0 是我們這一層製造出來的。
 *
 * 同一個陷阱在今天早上已經在別處踩過一次（`Number(null)` 讓 1589 的營收變成 0），所以這裡釘住的不只
 * 是這支端點，是那個轉換本身。
 */
describe("沒成交的交易日", () => {
  /** 貼近上游實際回應：2321 的 2026-09-24（OHLC 全 null、volume 377）。 */
  const NO_TRADE_BODY = {
    entries: [
      { tradeDate: "2026-09-23", open: 23.8, high: 26.25, low: 23.8, close: 25, volume: 16034 },
      { tradeDate: "2026-09-24", open: null, high: null, low: null, close: null, volume: 377 },
    ],
    earliestAvailableTradeDate: "2020-11-02",
  };

  it("OHLC 是 null 時保留 null，不得變成 0", async () => {
    mockFetchOnce({ ok: true, body: NO_TRADE_BODY });

    const entry = (await fetchDailyPriceHistory("2321")).entries[1];

    expect(entry?.close).toBeNull();
    expect(entry?.open).toBeNull();
    expect(entry?.high).toBeNull();
    expect(entry?.low).toBeNull();
    // 明確斷言不是 0：這正是 Number(null) 會產生的值，也是這條測試存在的理由。
    expect(entry?.close).not.toBe(0);
  });

  /**
   * volume 不跟著變 null —— 沒成交的列上它仍是實數（零股或盤後）。所以**不能用 volume 判斷當天有沒有
   * 成交**，這一條就是防止有人「順手」把 volume 也改成 nullable 或拿它當判斷依據。
   */
  it("OHLC 全 null 時 volume 仍是實數且可能非 0", async () => {
    mockFetchOnce({ ok: true, body: NO_TRADE_BODY });

    const entry = (await fetchDailyPriceHistory("2321")).entries[1];

    expect(entry?.volume).toBe(377);
  });

  /** 沒成交的列不得被濾掉：前端需要知道「那天有開盤但沒成交」，跟「那天不是交易日」是兩件事。 */
  it("沒成交的交易日仍然出現在 entries 裡，不被濾掉", async () => {
    mockFetchOnce({ ok: true, body: NO_TRADE_BODY });

    const result = await fetchDailyPriceHistory("2321");

    expect(result.entries).toHaveLength(2);
    expect(result.entries[1]?.tradeDate).toBe("2026-09-24");
  });

  /** 連續多天沒成交也照樣保留（1538 的 09-18、09-22、09-23、09-24）。 */
  it("連續多天沒成交時每一天都保留、每一天都是 null", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        entries: [
          { tradeDate: "2026-09-18", open: null, high: null, low: null, close: null, volume: 1252 },
          { tradeDate: "2026-09-21", open: 8.3, high: 8.3, low: 8.3, close: 8.3, volume: 3452 },
          { tradeDate: "2026-09-22", open: null, high: null, low: null, close: null, volume: 110 },
          { tradeDate: "2026-09-23", open: null, high: null, low: null, close: null, volume: 167 },
          { tradeDate: "2026-09-24", open: null, high: null, low: null, close: null, volume: 1 },
        ],
      },
    });

    const entries = (await fetchDailyPriceHistory("1538")).entries;

    expect(entries.map((e) => e.close)).toEqual([null, 8.3, null, null, null]);
    expect(entries.map((e) => e.volume)).toEqual([1252, 3452, 110, 167, 1]);
  });
});

