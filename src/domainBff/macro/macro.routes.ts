import { Router } from "ultimate-express";
import { z } from "zod";
import { parseBody } from "@/shared/validation.js";
import { getCbcPolicyRate } from "@/domainBff/macro/macro.service.js";

export const macroRouter = Router();

const YYYY_MM_DD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const cbcPolicyRateQuerySchema = z.object({
  from: z
    .string({ error: '"from" must be a string' })
    .trim()
    .regex(YYYY_MM_DD_PATTERN, { error: '"from" must be in "YYYY-MM-DD" format, e.g. "2020-01-01"' })
    .optional(),
});

macroRouter.get("/cbc-policy-rate", async (req, res) => {
  const query = parseBody(cbcPolicyRateQuerySchema, req.query);
  const result = await getCbcPolicyRate(query.from);
  res.json(result);
});
