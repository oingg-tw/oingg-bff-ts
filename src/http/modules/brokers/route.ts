import { Router } from "ultimate-express";
import type { AppDeps } from "@/application/deps.js";

export type BrokersDeps = Pick<AppDeps, "brokersGateway">;

/** 純轉發切片：沒有參數、沒有驗證、沒有 service 層，route 直接呼叫 gateway port。跟 /securities 一樣不需要登入。 */
export function createBrokersRouter(deps: BrokersDeps): Router {
  const brokersRouter = Router();

  brokersRouter.get("/", async (_req, res) => {
    res.json(await deps.brokersGateway.getBrokers());
  });

  return brokersRouter;
}
