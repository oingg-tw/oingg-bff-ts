import { Router } from "ultimate-express";
import { z } from "zod";
import { parseBody } from "@/shared/validation.js";
import type { AppDeps } from "@/application/deps.js";

export type MacroDeps = Pick<AppDeps, "macroGateway">;


const YYYY_MM_DD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const YYYY_MM_PATTERN = /^\d{4}-\d{2}$/;
const YYYY_Qn_PATTERN = /^\d{4}-Q[1-4]$/;

// Local validation exists for a fast, readable 400 — analysis-ts rejects the same inputs, but with a
// generic "Invalid query parameters." zod dump that isn't caller-friendly (confirmed live 2026-09-22).

export const cbcPolicyRateQuerySchema = z.object({
  from: z
    .string({ error: '"from" must be a string' })
    .trim()
    .regex(YYYY_MM_DD_PATTERN, { error: '"from" must be in "YYYY-MM-DD" format, e.g. "2020-01-01"' })
    .optional(),
});

/** Shared by the three monthly series filtered on an inclusive "YYYY-MM" lower bound. */
const fromMonthQuerySchema = z.object({
  from: z
    .string({ error: '"from" must be a string' })
    .trim()
    .regex(YYYY_MM_PATTERN, { error: '"from" must be in "YYYY-MM" format, e.g. "2020-01"' })
    .optional(),
});

/** 跟 cbc-policy-rate 完全相同的驗證（同樣是 "YYYY-MM-DD" 的事件序列下界），所以共用那一份 schema。 */
export const usPolicyRateQuerySchema = cbcPolicyRateQuerySchema;
export const ecbPolicyRateQuerySchema = cbcPolicyRateQuerySchema;

/**
 * 風險溢酬的窗口參數。四個都選填，但**年與月必須成對**——上游也會擋（400），這裡先擋是為了省一次
 * 跨服務往返，跟這個切片其他端點的日期格式驗證同一個理由。
 *
 * 用 z.coerce.number()：query 進來一律是字串。非數字會被 coerce 成 NaN 再被 int() 擋下。
 */
const yearMonthPart = (name: string) =>
  z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : v),
    z.coerce.number({ error: `"${name}" must be an integer` }).int(`"${name}" must be an integer`).optional(),
  );

export const equityRiskPremiumQuerySchema = z
  .object({
    startYear: yearMonthPart("startYear"),
    startMonth: yearMonthPart("startMonth").refine((v) => v === undefined || (v >= 1 && v <= 12), {
      message: '"startMonth" must be between 1 and 12',
    }),
    endYear: yearMonthPart("endYear"),
    endMonth: yearMonthPart("endMonth").refine((v) => v === undefined || (v >= 1 && v <= 12), {
      message: '"endMonth" must be between 1 and 12',
    }),
  })
  .refine((q) => (q.startYear === undefined) === (q.startMonth === undefined), {
    message: '"startYear" and "startMonth" must be given together, or not at all',
    path: ["startMonth"],
  })
  .refine((q) => (q.endYear === undefined) === (q.endMonth === undefined), {
    message: '"endYear" and "endMonth" must be given together, or not at all',
    path: ["endMonth"],
  });

export const businessCycleIndicatorQuerySchema = fromMonthQuerySchema;
export const monetaryAggregateQuerySchema = fromMonthQuerySchema;
export const govBondYield10yHistoryQuerySchema = fromMonthQuerySchema;
export const stockMarketSummaryQuerySchema = fromMonthQuerySchema;

export const USD_TWD_RATE_MAX_LIMIT = 2000;

export const usdTwdRateQuerySchema = z.object({
  // Bounds and default mirror analysis-ts (verified live: >2000 is a 400 there; default 250 applied upstream when omitted).
  limit: z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : v),
    z
      .coerce.number({ error: '"limit" must be a positive integer' })
      .refine((n) => Number.isInteger(n) && n > 0, { message: '"limit" must be a positive integer' })
      .refine((n) => n <= USD_TWD_RATE_MAX_LIMIT, { message: `"limit" must be at most ${USD_TWD_RATE_MAX_LIMIT}` })
      .optional(),
  ),
  interval: z.enum(["daily", "weekly", "monthly"], { error: '"interval" must be "daily", "weekly", or "monthly"' }).optional(),
});

export const CPI_CATEGORIES = ["total", "food", "clothing", "housing", "transport_communication", "medical", "education_recreation", "misc"] as const;

export const cpiQuerySchema = z.object({
  from: fromMonthQuerySchema.shape.from,
  category: z.enum(CPI_CATEGORIES, { error: `"category" must be one of ${CPI_CATEGORIES.join(", ")}` }).optional(),
});

export const GDP_CATEGORIES = [
  "growth_rate",
  "domestic_demand_total",
  "private_consumption",
  "government_consumption",
  "fixed_capital_formation_total",
  "fixed_capital_formation_private",
  "fixed_capital_formation_government",
  "fixed_capital_formation_public_enterprise",
  "inventory_change",
  "net_external_demand_total",
  "exports",
  "imports",
] as const;

export const gdpQuerySchema = z.object({
  from: z
    .string({ error: '"from" must be a string' })
    .trim()
    .regex(YYYY_Qn_PATTERN, { error: '"from" must be in "YYYY-Qn" format, e.g. "2026-Q1"' })
    .optional(),
  category: z.enum(GDP_CATEGORIES, { error: `"category" must be one of ${GDP_CATEGORIES.join(", ")}` }).optional(),
});

/**
 * 純轉發切片：route 直接呼叫 gateway port，中間沒有 service 層（見 macro.client.ts 的說明）。
 * 參數驗證留在這裡的 zod schema，它同時是 OpenAPI 的來源。
 */
export function createMacroRouter(deps: MacroDeps): Router {
  const macroRouter = Router();

  macroRouter.get("/cbc-policy-rate", async (req, res) => {
    const query = parseBody(cbcPolicyRateQuerySchema, req.query);
    res.json(await deps.macroGateway.getCbcPolicyRate(query.from));
  });

  macroRouter.get("/us-policy-rate", async (req, res) => {
    const query = parseBody(usPolicyRateQuerySchema, req.query);
    res.json(await deps.macroGateway.getUsPolicyRate(query.from));
  });

  macroRouter.get("/equity-risk-premium", async (req, res) => {
    const query = parseBody(equityRiskPremiumQuerySchema, req.query);
    res.json(await deps.macroGateway.getEquityRiskPremium(query));
  });

  macroRouter.get("/ecb-policy-rate", async (req, res) => {
    const query = parseBody(ecbPolicyRateQuerySchema, req.query);
    res.json(await deps.macroGateway.getEcbPolicyRate(query.from));
  });

  macroRouter.get("/business-cycle-indicator", async (req, res) => {
    const query = parseBody(businessCycleIndicatorQuerySchema, req.query);
    res.json(await deps.macroGateway.getBusinessCycleIndicator(query.from));
  });

  macroRouter.get("/monetary-aggregate", async (req, res) => {
    const query = parseBody(monetaryAggregateQuerySchema, req.query);
    res.json(await deps.macroGateway.getMonetaryAggregate(query.from));
  });

  // Registered before the "-history" sibling purely for readability — distinct literal paths, no overlap.
  macroRouter.get("/gov-bond-yield-10y", async (_req, res) => {
    res.json(await deps.macroGateway.getGovBondYield10y());
  });

  macroRouter.get("/gov-bond-yield-10y-history", async (req, res) => {
    const query = parseBody(govBondYield10yHistoryQuerySchema, req.query);
    res.json(await deps.macroGateway.getGovBondYield10yHistory(query.from));
  });

  macroRouter.get("/stock-market-summary", async (req, res) => {
    const query = parseBody(stockMarketSummaryQuerySchema, req.query);
    res.json(await deps.macroGateway.getStockMarketSummary(query.from));
  });

  macroRouter.get("/usd-twd-rate", async (req, res) => {
    const query = parseBody(usdTwdRateQuerySchema, req.query);
    res.json(await deps.macroGateway.getUsdTwdRate(query.limit, query.interval));
  });

  macroRouter.get("/cpi", async (req, res) => {
    const query = parseBody(cpiQuerySchema, req.query);
    res.json(await deps.macroGateway.getCpi(query.from, query.category));
  });

  macroRouter.get("/gdp", async (req, res) => {
    const query = parseBody(gdpQuerySchema, req.query);
    res.json(await deps.macroGateway.getGdp(query.from, query.category));
  });

  return macroRouter;
}
