import { Router } from "ultimate-express";
import { z } from "zod";
import { parseBody } from "@/shared/validation.js";
import { getIndustryFlatList, getIndustryTree } from "@/domainBff/industries/industries.service.js";

export const industriesRouter = Router();

export const industryTreeQuerySchema = z.object({
  code: z.string().trim().min(1).optional(),
});

industriesRouter.get("/tree", async (req, res) => {
  const query = parseBody(industryTreeQuerySchema, req.query);
  const tree = await getIndustryTree(query.code);
  res.json(tree);
});

industriesRouter.get("/flat", async (_req, res) => {
  const list = await getIndustryFlatList();
  res.json(list);
});
