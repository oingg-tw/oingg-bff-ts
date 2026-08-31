import { describe, expect, it } from "vitest";
import { getLatestClosePrices, getStockQuote } from "../domains/stock/stock.service.js";

// Direct DB access to twse-ts/tpex-ts was removed 2026-08-31 per the "bff-ts only talks to
// analysis-ts" architecture rule (see docs/業務中台與後台資料邊界架構.md). analysis-ts doesn't yet
// expose a replacement lookup API (blocked on their own twse/tpex mirror being incomplete — see
// docs/直連DB反模式修復計畫.md), so this is a deliberate, accepted short-term regression rather than a
// bug. These tests lock in the *current* (temporary) behavior so a future PR wiring up the real
// analysis-ts client has a clear diff to replace, not silent behavior drift.

describe("getStockQuote", () => {
  // Throws (not a silent null) because a null return would look identical to "unknown symbol" to
  // every caller (GET /stocks/:symbol, and holdings/transactions/watchlist symbol validation) —
  // that would be actively misleading about why it's failing.
  it("throws a 503 AppError explaining the migration block, for any symbol", async () => {
    await expect(getStockQuote("2330")).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe("getLatestClosePrices", () => {
  // Degrades gracefully (empty map, not a throw) because "stock.price" is part of the screener's
  // system default columns — throwing here would break the entire screener/ranking feature over a
  // missing display column, not just the price lookup itself.
  it("returns an empty map regardless of input, instead of throwing", async () => {
    const prices = await getLatestClosePrices(["2330", "1240"]);

    expect(prices.size).toBe(0);
  });

  it("returns an empty map for an empty symbol list too", async () => {
    const prices = await getLatestClosePrices([]);

    expect(prices.size).toBe(0);
  });
});
