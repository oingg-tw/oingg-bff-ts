import { describe, expect, it, vi } from "vitest";
import { fakeMarketGateway, fakeStockGateway } from "@/tests/fakes/analysisGateways.js";
import { fetchCloses } from "@/application/holdings/marketWindow.js";

function deps() {
  return {
    marketGateway: fakeMarketGateway(),
    stockGateway: fakeStockGateway({
      getDailyPriceHistory: vi.fn().mockImplementation(async (symbol: string, limit: number) => ({
        symbol,
        entries: Array.from({ length: limit }, (_, i) => ({ tradeDate: `2026-01-${String(i + 1).padStart(2, "0")}`, open: null, high: null, low: null, close: 100 + i, volume: 1 })),
        earliestAvailableTradeDate: null,
      })),
    }),
  };
}

/**
 * 日線是全市場公開資料，跨請求共用快取（2026-10-05：/holdings/performance 每次重抓約 50 檔，中位數 2 秒）。
 * setup.ts 每個測試前會清掉快取。
 */
describe("fetchCloses cache", () => {
  it("reuses a cached history for the same or a smaller limit", async () => {
    const d = deps();

    await fetchCloses(["2330", "2317"], 20, d);
    const again = await fetchCloses(["2330", "2317"], 10, d);

    expect(d.stockGateway.getDailyPriceHistory).toHaveBeenCalledTimes(2);
    expect(again.get("2330")!.size).toBe(20); // 超集：比這次要的多，照樣可用
  });

  it("refetches only the symbols it does not have, or has with too few rows", async () => {
    const d = deps();

    await fetchCloses(["2330"], 10, d);
    await fetchCloses(["2330", "0056"], 10, d);
    await fetchCloses(["2330"], 25, d);

    const calls = (d.stockGateway.getDailyPriceHistory as ReturnType<typeof vi.fn>).mock.calls.map(([s, l]) => `${s}:${l}`);
    expect(calls).toEqual(["2330:10", "0056:10", "2330:25"]);
  });
});
