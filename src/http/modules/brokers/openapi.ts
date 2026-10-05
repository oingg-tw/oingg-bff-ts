import { z } from "zod";
import { errorResponse, registry } from "@/http/swagger/registry.js";

registry.registerPath({
  method: "get",
  path: "/brokers",
  summary: "券商名單——給持股頁的券商下拉選單用",
  description: [
    "資料來自 analysis-ts 的 GET /brokers（2026-10-05 新增；上游來源是 twse-ts，每日更新）。純轉發，沒有參數。",
    "",
    "- 依 `brokerCode` 排序、代號不重複（2026-10-05 實測 60 家）。",
    "- **`name` 目前一律 null**：來源只有簡稱。下拉選單請顯示 `shortName`（例如 9800 →「元大」）。",
    "- `asOfDate` 是名單最後更新日；上游沒有日期時是 null。",
  ].join("\n"),
  tags: ["Brokers"],
  responses: {
    200: {
      description: "券商名單。",
      content: {
        "application/json": {
          schema: z
            .object({
              asOfDate: z.string().nullable().openapi({ example: "2026-10-04" }),
              brokers: z.array(
                z.object({
                  brokerCode: z.string().openapi({ example: "9800" }),
                  name: z.string().nullable(),
                  shortName: z.string().openapi({ example: "元大" }),
                }),
              ),
            })
            .openapi("BrokerList"),
        },
      },
    },
    502: errorResponse("上游無法提供名單，或回應不符合契約。"),
  },
});
