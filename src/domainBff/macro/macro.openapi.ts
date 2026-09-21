import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";
import { cbcPolicyRateQuerySchema } from "@/domainBff/macro/macro.routes.js";

const upstream502 = errorResponse("analysis-ts 服務無法連線或回應格式異常。");

const cbcPolicyRateEntrySchema = z.object({
  effectiveDate: z.string(),
  discountRate: z.number(),
  collateralAccommodationRate: z.number(),
  unsecuredAccommodationRate: z.number(),
  changeBp: z.number().nullable(),
});

const cbcPolicyRateResultSchema = z
  .object({ entries: z.array(cbcPolicyRateEntrySchema) })
  .openapi("CbcPolicyRateResult", {
    example: {
      entries: [
        { effectiveDate: "2022-03-18", discountRate: 1.375, collateralAccommodationRate: 1.75, unsecuredAccommodationRate: 3.625, changeBp: 25 },
        { effectiveDate: "2022-06-17", discountRate: 1.5, collateralAccommodationRate: 1.875, unsecuredAccommodationRate: 3.75, changeBp: 12.5 },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/macro/cbc-policy-rate",
  summary: "中央銀行政策利率調整事件序列（重貼現率／擔保放款融通利率／短期融通利率）——給大盤疊加升降息事件圖用",
  description:
    "資料來自 oingg-analysis-ts 的 GET /macro/cbc-policy-rate（2026-09-21 新增）。**事件型序列**：一列代表一次利率調整，不是逐日資料；由舊到新排序，不帶 from 時回傳 1989-04-01 起全部歷史（目前 77 筆）。三個利率欄位都是百分比數字（2 代表 2%），原樣轉發 analysis-ts 的 JSON 數字。changeBp 是重貼現率相對「前一次調整」的變動，單位是基點（12.5 = 半碼、25 = 一碼）——**整段歷史的第一筆（1989-04-01）是 null**（沒有更早的可比較）；帶 from 縮小窗口時，窗口內第一筆的 changeBp 仍會有值（它的前一次調整在上游存在，只是不在回傳範圍裡）。from 選填，\"YYYY-MM-DD\"，只回生效日 >= 這天的事件，格式錯誤會 400（本服務先擋，不打上游）。搭配 GET /market/taiex-daily-price 的 interval=monthly 使用——利率事件回到 1989，而 TAIEX 日線在 2000 筆上限內只能回到約 2018 年中，month 線（約 333 筆）才涵蓋得到 2000 年後每一輪升降息循環。",
  tags: ["Macro"],
  request: { query: cbcPolicyRateQuerySchema.openapi("CbcPolicyRateQuery", { example: { from: "2020-01-01" } }) },
  responses: {
    200: { description: "利率調整事件清單，由舊到新。", content: { "application/json": { schema: cbcPolicyRateResultSchema } } },
    400: errorResponse('from 不是 "YYYY-MM-DD" 格式。'),
    502: upstream502,
  },
});
