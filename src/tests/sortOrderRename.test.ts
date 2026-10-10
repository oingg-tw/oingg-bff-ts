import { describe, expect, it } from "vitest";
import { parseBody, rejectRetiredParams } from "@/shared/validation.js";
import { companyRankQuerySchema, rankingQuerySchema, screenerRequestSchema } from "@/http/modules/screener/route.js";
import { etfScreenerRequestSchema } from "@/http/modules/etfScreener/route.js";

/**
 * 排序方向 2026-10-10 起叫 order（跟 analysis-ts 810da900 同名），舊的 sortOrder／direction 並存到 2026-10-11
 * （web-nuxt 確認改完）。之後給舊名要 400 並指出新名——不能讓 schema 靜靜剝掉：ranking 的 order 選填、預設 desc，
 * 剝掉 direction=asc 會回一份方向相反、看起來正常的排行。
 */
describe("retired sort direction names", () => {
  it("ranking 的 direction 被擋下並指出新名，不是靜靜回 desc", () => {
    expect(() => parseBody(rankingQuerySchema, rejectRetiredParams({ field: "roe.TTM", direction: "asc" }, { direction: "order" }))).toThrow(/"direction" was renamed to "order"/);
    expect(parseBody(rankingQuerySchema, rejectRetiredParams({ field: "roe.TTM", order: "asc" }, { direction: "order" }))).toMatchObject({ order: "asc" });
  });

  it("POST /screener 的 sortOrder 被擋下；新名照常", () => {
    expect(() => parseBody(screenerRequestSchema, rejectRetiredParams({ filters: [], sortField: "symbol", sortOrder: "asc" }, { sortOrder: "order" }))).toThrow(/"sortOrder" was renamed/);
    expect(parseBody(screenerRequestSchema, { filters: [], sortField: "symbol", order: "desc" })).toMatchObject({ order: "desc" });
    expect(() => parseBody(screenerRequestSchema, { filters: [], sortField: "symbol" })).toThrow(/"sortField" and "order"/);
  });

  it("company-rank 的 order 必填", () => {
    expect(() => parseBody(companyRankQuerySchema, { symbol: "2330", field: "roe.TTM" })).toThrow(/"order" query parameter is required/);
  });

  // 不是物件的 body 原樣交給 schema 擋（ETF 的 schema 每個欄位都選填，展開成物件的話 {} 會通過）。
  it("不是物件的 body 不會變成空請求", () => {
    expect(() => parseBody(etfScreenerRequestSchema, rejectRetiredParams([1, 2], { sortOrder: "order" }))).toThrow();
  });
});
