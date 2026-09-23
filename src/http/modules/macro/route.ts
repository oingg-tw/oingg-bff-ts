import { Router } from "ultimate-express";
import { z } from "zod";
import { parseBody } from "@/shared/validation.js";
import {
  getBusinessCycleIndicator,
  getCbcPolicyRate,
  getCpi,
  getGdp,
  getGovBondYield10y,
  getGovBondYield10yHistory,
  getMonetaryAggregate,
  getStockMarketSummary,
  getUsdTwdRate,
} from "@/application/proxy/macro/macro.service.js";

export const macroRouter = Router();

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

macroRouter.get("/cbc-policy-rate", async (req, res) => {
  const query = parseBody(cbcPolicyRateQuerySchema, req.query);
  res.json(await getCbcPolicyRate(query.from));
});

macroRouter.get("/business-cycle-indicator", async (req, res) => {
  const query = parseBody(businessCycleIndicatorQuerySchema, req.query);
  res.json(await getBusinessCycleIndicator(query.from));
});

macroRouter.get("/monetary-aggregate", async (req, res) => {
  const query = parseBody(monetaryAggregateQuerySchema, req.query);
  res.json(await getMonetaryAggregate(query.from));
});

// Registered before the "-history" sibling purely for readability — distinct literal paths, no overlap.
macroRouter.get("/gov-bond-yield-10y", async (_req, res) => {
  res.json(await getGovBondYield10y());
});

macroRouter.get("/gov-bond-yield-10y-history", async (req, res) => {
  const query = parseBody(govBondYield10yHistoryQuerySchema, req.query);
  res.json(await getGovBondYield10yHistory(query.from));
});

macroRouter.get("/stock-market-summary", async (req, res) => {
  const query = parseBody(stockMarketSummaryQuerySchema, req.query);
  res.json(await getStockMarketSummary(query.from));
});

macroRouter.get("/usd-twd-rate", async (req, res) => {
  const query = parseBody(usdTwdRateQuerySchema, req.query);
  res.json(await getUsdTwdRate(query.limit, query.interval));
});

macroRouter.get("/cpi", async (req, res) => {
  const query = parseBody(cpiQuerySchema, req.query);
  res.json(await getCpi(query.from, query.category));
});

macroRouter.get("/gdp", async (req, res) => {
  const query = parseBody(gdpQuerySchema, req.query);
  res.json(await getGdp(query.from, query.category));
});
