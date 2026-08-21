import { Router } from "ultimate-express";
import { listNeonPoolNames } from "../../adapters/neon/index.js";

export const systemRouter = Router();

systemRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    neonPools: listNeonPoolNames(),
  });
});
