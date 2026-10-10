import { describe, expect, it } from "vitest";
import { parseBody, withLegacyRocYear } from "@/shared/validation.js";
import {
  financialStatementQuerySchema,
  metricProvenanceQuerySchema,
  piotroskiBreakdownQuerySchema,
} from "@/http/modules/stock/route.js";

/**
 * 三支「查某一季」端點（financial-statement、piotroski-breakdown、metric-provenance）共用一組參數。2026-10-10 起是
 * 西元 fiscalYear ＋ 整數 fiscalQuarter（統一用語，analysis-ts 05967082 起上游只認這組）；並存期間舊的民國 year／
 * season 由 withLegacyRocYear 換算過來。這裡守三支共用同一份規則、以及舊參數換算正確。
 */
const SCHEMAS = [
  ["financial-statement", financialStatementQuerySchema, { statementType: "incomeStatement" }],
  ["piotroski-breakdown", piotroskiBreakdownQuerySchema, {}],
  ["metric-provenance", metricProvenanceQuerySchema, { metricCode: "roe" }],
] as const;

const parse = (schema: (typeof SCHEMAS)[number][1], query: Record<string, unknown>) => parseBody(schema, withLegacyRocYear(query));

describe.each(SCHEMAS)("%s 的 fiscalYear/fiscalQuarter", (_name, schema, base) => {
  it("西元年＋季別通過，轉成整數", () => {
    expect(parse(schema, { ...base, fiscalYear: "2025", fiscalQuarter: "2" })).toMatchObject({ fiscalYear: 2025, fiscalQuarter: 2 });
  });

  it("並存期：舊的民國 year／season 換算成西元（114 → 2025）", () => {
    expect(parse(schema, { ...base, year: "114", season: "2" })).toMatchObject({ fiscalYear: 2025, fiscalQuarter: 2 });
  });

  it("舊參數放四位數西元年仍被擋下並說明（那個參數名代表民國年，不猜）", () => {
    expect(() => parse(schema, { ...base, year: "2025", season: "2" })).toThrow(/ROC year/);
  });

  it("兩組都給時以新的為準", () => {
    expect(parse(schema, { ...base, fiscalYear: "2026", fiscalQuarter: "1", year: "114", season: "2" })).toMatchObject({ fiscalYear: 2026, fiscalQuarter: 1 });
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
