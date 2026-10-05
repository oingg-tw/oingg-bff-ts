import { describe, expect, it, vi } from "vitest";
import { assertSymbolExists } from "@/application/proxy/stock/stock.service.js";
import { fakeSecuritiesGateway, fakeStockGateway } from "@/tests/fakes/analysisGateways.js";

/**
 * This file used to be ~400 lines of "getX delegates to fetchX and returns its result as-is", asserted
 * against 17 vi.mock'd client modules. Those wrappers are gone (the routes call StockGatewayPort
 * directly), and so are the tests: a test that a one-line pass-through passes through only ever
 * restated the implementation.
 *
 * Nothing is left uncovered by the deletion — each client keeps its own *.client.test.ts covering the
 * part that actually has rules (URL/query building, the 400 relay, the field normalizers), and the
 * routes' validation lives in the zod schemas. What remains here is the one function in the slice that
 * makes a decision.
 */
describe("assertSymbolExists", () => {
  const page = (symbols: string[], count = symbols.length) => ({
    count,
    limit: 1000,
    offset: 0,
    entries: symbols.map((symbol) => ({ symbol, name: symbol, type: "ETF" as const })),
  });

  it("有報價就結束，而且不去查有價證券總表", async () => {
    const stockGateway = fakeStockGateway({
      getStockQuote: vi.fn().mockResolvedValue({ symbol: "2330", price: null, valuation: null }),
    });
    const securitiesGateway = fakeSecuritiesGateway();

    await expect(assertSymbolExists("2330", { stockGateway, securitiesGateway })).resolves.toBeUndefined();
    expect(stockGateway.getStockQuote).toHaveBeenCalledWith("2330");
    // 2,722 檔裡 2,349 是普通股，所以這條快路徑決定了 86% 的寫入只付一次上游呼叫。
    expect(securitiesGateway.getSecurityList).not.toHaveBeenCalled();
  });

  /**
   * **這一條是 2026-10-05 那個缺陷的迴歸測試。** ETF 與特別股在上游沒有公司檔案，所以報價查不到它們，
   * 而舊的守衛就只查報價——0050／0056／00878／1312A 全部被擋成 404，而那幾檔正是退休族最常持有的。
   */
  it("報價查不到但在有價證券總表裡（ETF／特別股）時放行", async () => {
    const stockGateway = fakeStockGateway({ getStockQuote: vi.fn().mockResolvedValue(null) });
    const securitiesGateway = fakeSecuritiesGateway({
      getSecurityList: vi.fn().mockResolvedValue(page(["0050", "0056", "1312A"])),
    });

    await expect(assertSymbolExists("0056", { stockGateway, securitiesGateway })).resolves.toBeUndefined();
  });

  /**
   * 總表有 2,722 列而上游的 limit 上限是 1000，所以要翻頁。這裡守的是「第一頁找不到會繼續翻」——
   * 只看第一頁的話，排在後面的 ETF 會被當成不存在。
   */
  it("第一頁沒命中會繼續翻頁", async () => {
    const stockGateway = fakeStockGateway({ getStockQuote: vi.fn().mockResolvedValue(null) });
    const getSecurityList = vi
      .fn()
      .mockResolvedValueOnce({ count: 1500, limit: 1000, offset: 0, entries: page(Array.from({ length: 1000 }, (_, i) => `X${i}`), 1500).entries })
      .mockResolvedValueOnce({ count: 1500, limit: 1000, offset: 1000, entries: page(["00878"], 1500).entries });

    await expect(assertSymbolExists("00878", { stockGateway, securitiesGateway: fakeSecuritiesGateway({ getSecurityList }) })).resolves.toBeUndefined();
    expect(getSecurityList).toHaveBeenCalledTimes(2);
  });

  it("兩邊都查不到才丟 404", async () => {
    const stockGateway = fakeStockGateway({ getStockQuote: vi.fn().mockResolvedValue(null) });
    const securitiesGateway = fakeSecuritiesGateway({
      getSecurityList: vi.fn().mockResolvedValue(page(["0050"])),
    });

    await expect(assertSymbolExists("NOPE", { stockGateway, securitiesGateway })).rejects.toMatchObject({
      statusCode: 404,
      message: 'Unknown stock symbol "NOPE"',
    });
  });

  /** 翻完所有頁才放棄，不會因為最後一頁是空的就無限迴圈。 */
  it("總表為空時丟 404 而不是卡住", async () => {
    const stockGateway = fakeStockGateway({ getStockQuote: vi.fn().mockResolvedValue(null) });
    const securitiesGateway = fakeSecuritiesGateway({
      getSecurityList: vi.fn().mockResolvedValue({ count: 0, limit: 1000, offset: 0, entries: [] }),
    });

    await expect(assertSymbolExists("NOPE", { stockGateway, securitiesGateway })).rejects.toMatchObject({ statusCode: 404 });
  });
});
