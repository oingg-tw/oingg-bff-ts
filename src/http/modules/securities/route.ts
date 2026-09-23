import { Router } from "ultimate-express";
import { z } from "zod";
import { parseBody } from "@/shared/validation.js";
import { getSecurityList } from "@/application/proxy/securities/securities.service.js";

export const securitiesRouter = Router();

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

securitiesRouter.get("/", async (req, res) => {
  const query = parseBody(securityListQuerySchema, req.query);
  const result = await getSecurityList(query.limit, query.offset);
  res.json(result);
});
