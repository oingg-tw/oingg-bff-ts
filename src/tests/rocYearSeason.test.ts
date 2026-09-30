import { describe, expect, it } from "vitest";
import { parseBody } from "@/shared/validation.js";
import {
  financialStatementQuerySchema,
  metricProvenanceQuerySchema,
  piotroskiBreakdownQuerySchema,
} from "@/http/modules/stock/route.js";

/**
 * analysis-ts 的三支「查某一季」端點共用一組 year/season，而**輸入是民國年、回應是西元年**
 * （`year=114` 回 `fiscalYear: 2025`）。2026-09-30 實測上游三支都對四位數西元年回 400，而
 * assertAnalysisServiceOk 會把它變成一句沒有資訊的 502「returned 400」，前端的 fallback 再顯示成
 * 「資料不足」——一個參數錯誤長得像資料覆蓋率問題。
 *
 * 這支測試守的是三支共用同一份規則。schema 只有一份，所以任何一支被改成自己的版本、或者位數檢查
 * 被放寬到讓 "2025" 穿過去，這裡就會亮。
 */
const SCHEMAS = [
  ["financial-statement", financialStatementQuerySchema, { statementType: "incomeStatement" }],
  ["piotroski-breakdown", piotroskiBreakdownQuerySchema, {}],
  ["metric-provenance", metricProvenanceQuerySchema, { metricCode: "roe" }],
] as const;

describe.each(SCHEMAS)("%s 的 year/season", (_name, schema, base) => {
  it("民國年通過", () => {
    expect(parseBody(schema, { ...base, year: "114", season: "2" })).toMatchObject({ year: "114", season: "2" });
  });

  it("四位數西元年被擋下，錯誤訊息指出要民國年", () => {
    expect(() => parseBody(schema, { ...base, year: "2025", season: "2" })).toThrow(/ROC year/);
  });

  it("season 只收 1~4", () => {
    expect(() => parseBody(schema, { ...base, year: "114", season: "5" })).toThrow(/season/);
    expect(() => parseBody(schema, { ...base, year: "114", season: "0" })).toThrow(/season/);
  });

  /** 兩個都不給是合法的：上游會查最新一季。這是三支端點都有的慣例，不要在收緊位數時一起弄壞。 */
  it("兩個都不給時通過", () => {
    expect(() => parseBody(schema, { ...base })).not.toThrow();
  });

  it("只給一個時被擋下", () => {
    expect(() => parseBody(schema, { ...base, year: "114" })).toThrow(/together/);
    expect(() => parseBody(schema, { ...base, season: "2" })).toThrow(/together/);
  });
});
