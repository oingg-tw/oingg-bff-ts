import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchStockPrices, fetchStockQuote } from "@/infrastructure/analysisApi/stock/stockQuote.client.js";

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

describe("fetchStockQuote", () => {
  it("requests /stocks/:symbol/quote and returns the parsed quote", async () => {
    const quote = {
      symbol: "2330",
      price: { tradeDate: "2026-09-01", close: "1090" },
      valuation: { tradeDate: "2026-09-01", peRatio: "28.05", pbRatio: "9.76", dividendYield: "0.91" },
    };
    mockFetchOnce({ ok: true, body: quote });

    const result = await fetchStockQuote("2330");

    expect(result).toEqual(quote);
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/stocks/2330/quote");
  });

  it("returns null on a 404 (unknown symbol in either market) instead of throwing", async () => {
    mockFetchOnce({ ok: false, status: 404, body: {} });

    await expect(fetchStockQuote("nope")).resolves.toBeNull();
  });

  // Regression: verified live against analysis-ts's real endpoint — it sends ratio/percentage fields as
  // JSON numbers (close: 2420, peRatio: 28.05), their genuine existing convention for Decimal-backed
  // fields (confirmed with them directly), not something new to this endpoint. Normalize to strings
  // anyway so bff-ts's own outward API stays consistent with its screener values — which are strings
  // only because node-postgres's default NUMERIC serialization does that, not because of any shared
  // convention with analysis-ts's API.
  it("normalizes numeric price/valuation fields to strings for bff-ts's own outward-consistency choice", async () => {
    mockFetchOnce({
      ok: true,
      body: {
        symbol: "2330",
        price: { tradeDate: "2026-08-28", close: 2420 },
        valuation: { tradeDate: "2026-08-28", peRatio: 28.05, pbRatio: 9.76, dividendYield: 0.91 },
      },
    });

    const result = await fetchStockQuote("2330");

    expect(result).toEqual({
      symbol: "2330",
      price: { tradeDate: "2026-08-28", close: "2420" },
      valuation: { tradeDate: "2026-08-28", peRatio: "28.05", pbRatio: "9.76", dividendYield: "0.91" },
    });
  });

  it("keeps a null close/valuation field as null rather than stringifying it", async () => {
    mockFetchOnce({
      ok: true,
      body: { symbol: "2330", price: { tradeDate: "2026-08-28", close: null }, valuation: null },
    });

    const result = await fetchStockQuote("2330");

    expect(result).toEqual({
      symbol: "2330",
      price: { tradeDate: "2026-08-28", close: null },
      valuation: null,
    });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchStockQuote("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError for a non-404 non-2xx status", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchStockQuote("2330")).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the response is missing required fields", async () => {
    mockFetchOnce({ ok: true, body: { symbol: "2330" } });

    await expect(fetchStockQuote("2330")).rejects.toMatchObject({ statusCode: 502 });
  });
});

describe("fetchStockPrices", () => {
  it("returns an empty map without calling fetch when given no symbols", async () => {
    const result = await fetchStockPrices([]);

    expect(result).toEqual(new Map());
    expect(globalThis.fetch).toBe(ORIGINAL_FETCH);
  });

  it("requests /stocks/prices with a comma-joined symbols param and returns a Map", async () => {
    mockFetchOnce({
      ok: true,
      body: { prices: { "2330": { close: "1090", tradeDate: "2026-09-01" } } },
    });

    const result = await fetchStockPrices(["2330", "1240"]);

    expect(result).toEqual(new Map([["2330", { close: "1090", tradeDate: "2026-09-01", previousClose: null, previousTradeDate: null, latestClose: null, latestCloseDate: null }]]));
    const calledUrl = vi.mocked(globalThis.fetch).mock.calls[0]?.[0] as URL;
    expect(calledUrl.toString()).toBe("http://filters.test/stocks/prices?symbols=2330%2C1240");
  });

  // Same normalization as fetchStockQuote — see that test's comment for why.
  it("normalizes a numeric close field to a string", async () => {
    mockFetchOnce({ ok: true, body: { prices: { "2330": { close: 2420, tradeDate: "2026-08-28" } } } });

    const result = await fetchStockPrices(["2330"]);

    expect(result).toEqual(new Map([["2330", { close: "2420", tradeDate: "2026-08-28", previousClose: null, previousTradeDate: null, latestClose: null, latestCloseDate: null }]]));
  });

  // 2026-10-06 analysis-ts 新增 previousClose／previousTradeDate（DEV 先上，PRD 還沒有）：有就原樣轉成字串，
  // 沒有這兩個欄位的舊上游（上一個測試的形狀）讀成 null 而不是 undefined 或 "undefined"。
  it("passes previousClose and previousTradeDate through", async () => {
    mockFetchOnce({
      ok: true,
      body: { prices: { "2330": { close: 2575, tradeDate: "2026-10-05", previousClose: 2500, previousTradeDate: "2026-10-02", latestClose: 2575, latestCloseDate: "2026-10-05" } } },
    });

    const result = await fetchStockPrices(["2330"]);

    expect(result.get("2330")).toEqual({ close: "2575", tradeDate: "2026-10-05", previousClose: "2500", previousTradeDate: "2026-10-02", latestClose: "2575", latestCloseDate: "2026-10-05" });
  });

  // 2026-10-07 analysis-ts e6fea8c3：最近一次真的有成交的收盤與它的日期。8416 在 10-06 沒成交（DEV 實測）。
  it("passes latestClose and latestCloseDate through", async () => {
    mockFetchOnce({
      ok: true,
      body: { prices: { "8416": { close: null, tradeDate: "2026-10-06", previousClose: 169.5, previousTradeDate: "2026-10-05", latestClose: 169.5, latestCloseDate: "2026-10-05" } } },
    });

    const result = await fetchStockPrices(["8416"]);

    expect(result.get("8416")).toMatchObject({ close: null, latestClose: "169.5", latestCloseDate: "2026-10-05" });
  });

  // Regression-shaped: analysis-ts confirmed a symbol with no data is simply absent from `prices` — not
  // mapped to null, not silently dropped as part of some truncation. "present = has data" must hold.
  it("a symbol absent from the response's prices object is absent from the returned Map too", async () => {
    mockFetchOnce({ ok: true, body: { prices: {} } });

    const result = await fetchStockPrices(["2330"]);

    expect(result.has("2330")).toBe(false);
  });

  /**
   * 這幾條取代了原本「超過 100 檔就丟 500」那一條測試——**那條測試把 bug 當成規格釘住了**。
   *
   * 上游的 100 檔上限是「每個 request」的上限，不是這個函式能處理的上限。而 bff-ts 的 pageSize 上限是
   * 200（MAX_PAGE_SIZE），所以任何 pageSize > 100 又要 stock.price 欄位的 POST /screener 都會回 500。
   * 2026-09-26 實測確認：五種 filter、八個頁碼，全部 500。/screener/values 帶超過 100 檔也一樣。
   */
  it("超過 100 檔時分批請求，而不是丟錯", async () => {
    const symbols = Array.from({ length: 200 }, (_, i) => String(1000 + i));
    const calls: string[] = [];
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const batch = (url.searchParams.get("symbols") ?? "").split(",");
      calls.push(url.searchParams.get("symbols") ?? "");
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ prices: Object.fromEntries(batch.map((s) => [s, { close: s, tradeDate: "2026-09-25" }])) }),
      });
    }) as unknown as typeof fetch;

    const result = await fetchStockPrices(symbols);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.split(",")).toHaveLength(100);
    expect(calls[1]?.split(",")).toHaveLength(100);
    // 每一檔都要在合併後的 Map 裡：分批最容易出的錯是只回傳最後一批。
    expect(result.size).toBe(200);
    expect(result.get("1000")?.close).toBe("1000");
    expect(result.get("1199")?.close).toBe("1199");
  });

  it("剛好 100 檔時只發一次請求", async () => {
    const symbols = Array.from({ length: 100 }, (_, i) => String(1000 + i));
    mockFetchOnce({ ok: true, body: { prices: {} } });

    await fetchStockPrices(symbols);

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });

  // 沒有整除的情況：最後一批比較短，不該被補足也不該被丟掉。
  it("101 檔切成 100 + 1", async () => {
    const symbols = Array.from({ length: 101 }, (_, i) => String(1000 + i));
    const sizes: number[] = [];
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const batch = (new URL(String(input)).searchParams.get("symbols") ?? "").split(",");
      sizes.push(batch.length);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ prices: Object.fromEntries(batch.map((s) => [s, { close: s, tradeDate: "2026-09-25" }])) }),
      });
    }) as unknown as typeof fetch;

    const result = await fetchStockPrices(symbols);

    expect(sizes).toEqual([100, 1]);
    expect(result.size).toBe(101);
  });

  // 一批失敗就整個失敗：回一份少了 100 檔股價的 Map，下游會把它讀成「這些公司沒有報價」。
  it("其中一批失敗時整個請求失敗，不回傳只有一半的 Map", async () => {
    const symbols = Array.from({ length: 200 }, (_, i) => String(1000 + i));
    let n = 0;
    globalThis.fetch = vi.fn(() => {
      n += 1;
      return Promise.resolve(
        n === 1
          ? { ok: true, status: 200, json: () => Promise.resolve({ prices: {} }) }
          : { ok: false, status: 500, json: () => Promise.resolve({}) },
      );
    }) as unknown as typeof fetch;

    await expect(fetchStockPrices(symbols)).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError (not an uncaught exception) when fetch itself fails to connect", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;

    await expect(fetchStockPrices(["2330"])).rejects.toMatchObject({ statusCode: 502 });
  });

  it("throws a 502 AppError when the prices endpoint fails on its own side", async () => {
    mockFetchOnce({ ok: false, status: 500, body: {} });

    await expect(fetchStockPrices(["2330"])).rejects.toMatchObject({ statusCode: 502 });
  });

  /**
   * 這條原本用 status 400 驗「非 2xx 就是 502」。2026-09-30 起上游的 400 轉成我們的 400 並帶原訊息，
   * 所以那個案例改成 500，另外補這一條——**4xx 說的是「這個請求有問題」，5xx 說的是「我們壞了」**，
   * 把上游的 4xx 包成 5xx 會讓呼叫端重試一個永遠不會成功的請求。
   */
  it("relays an upstream 400 as a 400 with its own message", async () => {
    mockFetchOnce({ ok: false, status: 400, body: { message: "symbols 最多 100 個。" } });

    await expect(fetchStockPrices(["2330"])).rejects.toMatchObject({ statusCode: 400, message: "symbols 最多 100 個。" });
  });

  it('throws a 502 AppError when the response has no "prices" object', async () => {
    mockFetchOnce({ ok: true, body: {} });

    await expect(fetchStockPrices(["2330"])).rejects.toMatchObject({ statusCode: 502 });
  });
});
