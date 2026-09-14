import { Router } from "ultimate-express";
import { z } from "zod";
import { parseBody } from "@/shared/validation.js";
import {
  getChainClassification,
  getIndustryFlatList,
  getIndustryTree,
  getSecuritiesSectors,
} from "@/domainBff/industries/industries.service.js";

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

industriesRouter.get("/securities-sectors", async (_req, res) => {
  const list = await getSecuritiesSectors();
  res.json(list);
});

industriesRouter.get("/chain-classification", async (_req, res) => {
  const list = await getChainClassification();
  res.json(list);
});
