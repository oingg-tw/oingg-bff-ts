import { Router } from "ultimate-express";
import { z } from "zod";
import { parseBody } from "@/shared/validation.js";
import { getIndustryTree } from "@/bff/industries/industries.service.js";

export const industriesRouter = Router();

export const industryTreeQuerySchema = z.object({
  code: z.string().trim().min(1).optional(),
});

industriesRouter.get("/tree", async (req, res) => {
  const query = parseBody(industryTreeQuerySchema, req.query);
  const tree = await getIndustryTree(query.code);
  res.json(tree);
});
