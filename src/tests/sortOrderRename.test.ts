import { describe, expect, it } from "vitest";
import { parseBody, withLegacyQueryNames } from "@/shared/validation.js";
import { companyRankQuerySchema, rankingQuerySchema, screenerRequestSchema } from "@/http/modules/screener/route.js";
import { etfScreenerRequestSchema } from "@/http/modules/etfScreener/route.js";

/**
 * 排序方向 2026-10-10 起叫 order（跟 analysis-ts 810da900 同名）；並存期舊的 sortOrder／direction 由各 route 的
 * withLegacyQueryNames 搬過來，兩個都給以新名為準。web-nuxt 改完、這層刪掉時，這個檔案一起刪。
 */
describe("sort direction rename (sortOrder/direction -> order)", () => {
  it("POST /screener 的 body：舊 sortOrder 照收，新 order 優先", () => {
    expect(parseBody(screenerRequestSchema, withLegacyQueryNames({ filters: [], sortField: "symbol", sortOrder: "asc" }, { sortOrder: "order" }))).toMatchObject({ order: "asc" });
    expect(parseBody(screenerRequestSchema, withLegacyQueryNames({ filters: [], sortField: "symbol", sortOrder: "asc", order: "desc" }, { sortOrder: "order" }))).toMatchObject({ order: "desc" });
    expect(() => parseBody(screenerRequestSchema, { filters: [], sortField: "symbol" })).toThrow(/"sortField" and "order"/);
  });

  // body 也走這支：陣列展開會變成一個「合法的空物件」，必須原樣交給 schema 擋下。
  it("不是物件的 body 不會被展開成空請求", () => {
    // ETF 的 schema 每個欄位都選填，所以 {} 會通過——正好驗得出展開的後果。
    expect(() => parseBody(etfScreenerRequestSchema, withLegacyQueryNames([1, 2], { sortOrder: "order" }))).toThrow();
  });

  it("GET /screener/ranking 與 /company-rank 的 query：舊 direction 照收", () => {
    expect(parseBody(rankingQuerySchema, withLegacyQueryNames({ field: "roe.TTM", direction: "asc" }, { direction: "order" }))).toMatchObject({ order: "asc" });
    expect(parseBody(companyRankQuerySchema, withLegacyQueryNames({ symbol: "2330", field: "roe.TTM", direction: "desc" }, { direction: "order" }))).toMatchObject({ order: "desc" });
    expect(() => parseBody(companyRankQuerySchema, { symbol: "2330", field: "roe.TTM" })).toThrow(/"order" query parameter is required/);
  });
});
