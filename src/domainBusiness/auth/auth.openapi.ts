import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";

const authMeResponseSchema = z
  .object({
    user: z.record(z.string(), z.unknown()).openapi({ description: "解碼後的 Firebase user token（DecodedIdToken）。" }),
  })
  .openapi("AuthMeResponse");

registry.registerPath({
  method: "get",
  path: "/auth/me",
  summary: "回傳目前登入者的解碼後 Firebase token",
  tags: ["Auth"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "解碼後的 Firebase user token。",
      content: { "application/json": { schema: authMeResponseSchema } },
    },
    401: errorResponse("缺少或無效的 Authorization header / token。"),
  },
});
