import { Router } from "ultimate-express";
import { z } from "zod";
import { parseBody } from "@/shared/validation.js";
import type { AppDeps } from "@/application/deps.js";

export type IndustriesDeps = Pick<AppDeps, "industriesGateway">;

export const industryTreeQuerySchema = z.object({
  code: z.string().trim().min(1).optional(),
});

/**
 * 純轉發切片：route 直接呼叫 gateway port，中間沒有 service 層（見 industries.client.ts 的說明）。
 * `code` 的驗證留在上面的 zod schema，它同時是 OpenAPI 的來源。
 */
export function createIndustriesRouter(deps: IndustriesDeps): Router {
  const industriesRouter = Router();

  industriesRouter.get("/tree", async (req, res) => {
    const query = parseBody(industryTreeQuerySchema, req.query);
    const tree = await deps.industriesGateway.getIndustryTree(query.code);
    res.json(tree);
  });

  industriesRouter.get("/flat", async (_req, res) => {
    const list = await deps.industriesGateway.getIndustryFlatList();
    res.json(list);
  });

  industriesRouter.get("/securities-sectors", async (_req, res) => {
    const list = await deps.industriesGateway.getSecuritiesSectors();
    res.json(list);
  });

  // 沒有 query 參數，所以沒有 zod schema——純轉發不留空殼，同 book-value-breakdown。
  industriesRouter.get("/sector-dividend-summary", async (_req, res) => {
    const summary = await deps.industriesGateway.getSectorDividendSummary();
    res.json(summary);
  });

  return industriesRouter;
}
