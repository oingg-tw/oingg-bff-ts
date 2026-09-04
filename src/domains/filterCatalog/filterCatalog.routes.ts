import { Router } from "ultimate-express";
import { getFilterCatalog } from "@/domains/filterCatalog/filterCatalog.service.js";

export const filterCatalogRouter = Router();

filterCatalogRouter.get("/", async (_req, res) => {
  const categories = await getFilterCatalog();
  res.json({ categories });
});
