import { z } from "zod";
import { registry } from "@/adapters/swagger/registry.js";

registry.registerPath({
  method: "get",
  path: "/",
  summary: "伺服器啟動時間與運作時長",
  tags: ["System"],
  responses: {
    200: {
      description: "開機時間與 uptime。",
      content: {
        "application/json": {
          schema: z.object({
            status: z.literal("ok"),
            startedAt: z.string(),
            uptimeSeconds: z.number(),
          }),
        },
      },
    },
  },
});
