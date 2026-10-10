import { describe, expect, it } from "vitest";
import { parseBody, rejectRetiredParams } from "@/shared/validation.js";
import {
  financialStatementQuerySchema,
  metricProvenanceQuerySchema,
  piotroskiBreakdownQuerySchema,
} from "@/http/modules/stock/route.js";

/**
 * 三支「查某一季」端點（financial-statement、piotroski-breakdown、metric-provenance）共用一組參數。2026-10-10 起是
 * 西元 fiscalYear ＋ 整數 fiscalQuarter（統一用語，analysis-ts 05967082 起上游只認這組）；並存期間舊的民國 year／
 * season 並存到 2026-10-11，之後給了就 400。這裡守三支共用同一份規則、以及舊參數被擋下。
 */
const SCHEMAS = [
  ["financial-statement", financialStatementQuerySchema, { statementType: "incomeStatement" }],
  ["piotroski-breakdown", piotroskiBreakdownQuerySchema, {}],
  ["metric-provenance", metricProvenanceQuerySchema, { metricCode: "roe" }],
] as const;

const parse = (schema: (typeof SCHEMAS)[number][1], query: Record<string, unknown>) => parseBody(schema, rejectRetiredParams(query, { year: "fiscalYear", season: "fiscalQuarter" }));

describe.each(SCHEMAS)("%s 的 fiscalYear/fiscalQuarter", (_name, schema, base) => {
  it("西元年＋季別通過，轉成整數", () => {
    expect(parse(schema, { ...base, fiscalYear: "2025", fiscalQuarter: "2" })).toMatchObject({ fiscalYear: 2025, fiscalQuarter: 2 });
  });

  // 並存期 2026-10-11 結束：舊名給了要 400 並指出新名，不能被 schema 靜靜剝掉後改查最新一季。
  it("舊的 year／season 被擋下並指出新名", () => {
    expect(() => parse(schema, { ...base, year: "114", season: "2" })).toThrow(/"year" was renamed to "fiscalYear"/);
    expect(() => parse(schema, { ...base, fiscalYear: "2025", fiscalQuarter: "2", season: "2" })).toThrow(/"season" was renamed to "fiscalQuarter"/);
  });

  it("fiscalQuarter 只收 1~4", () => {
    expect(() => parse(schema, { ...base, fiscalYear: "2025", fiscalQuarter: "5" })).toThrow(/fiscalQuarter/);
    expect(() => parse(schema, { ...base, fiscalYear: "2025", fiscalQuarter: "0" })).toThrow(/fiscalQuarter/);
  });

  /** 兩個都不給是合法的：上游會查最新一季。 */
  it("兩個都不給時通過", () => {
    expect(() => parse(schema, { ...base })).not.toThrow();
  });

  it("只給一個時被擋下", () => {
    expect(() => parse(schema, { ...base, fiscalYear: "2025" })).toThrow(/together/);
    expect(() => parse(schema, { ...base, fiscalQuarter: "2" })).toThrow(/together/);
  });
});
