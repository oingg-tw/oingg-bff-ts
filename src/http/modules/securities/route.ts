import { Router } from "ultimate-express";
import { z } from "zod";
import { parseQuery } from "@/shared/validation.js";
import type { AppDeps } from "@/application/deps.js";

export type SecuritiesDeps = Pick<AppDeps, "securitiesGateway">;

export const securityListQuerySchema = z.object({
  limit: z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : v),
    z
      .coerce.number({ error: '"limit" must be an integer between 1 and 1000' })
      .refine((n) => Number.isInteger(n) && n >= 1 && n <= 1000, {
        message: '"limit" must be an integer between 1 and 1000',
      })
      .optional(),
  ),
  offset: z.preprocess(
    (v) => (v === undefined || v === "" ? undefined : v),
    z
      .coerce.number({ error: '"offset" must be a non-negative integer' })
      .refine((n) => Number.isInteger(n) && n >= 0, { message: '"offset" must be a non-negative integer' })
      .optional(),
  ),
});

/**
 * 純轉發切片：route 直接呼叫 gateway port，中間沒有 service 層（見 securities.client.ts 的說明）。
 * limit/offset 的界限驗證留在上面的 zod schema，它同時是 OpenAPI 的來源；兩者都是 optional，沒給就
 * 不往上游送，上游才會套用它自己的預設值。
 */
export function createSecuritiesRouter(deps: SecuritiesDeps): Router {
  const securitiesRouter = Router();

  securitiesRouter.get("/", async (req, res) => {
    const query = parseQuery(securityListQuerySchema, req.query);
    const result = await deps.securitiesGateway.getSecurityList(query.limit, query.offset);
    res.json(result);
  });

  return securitiesRouter;
}
