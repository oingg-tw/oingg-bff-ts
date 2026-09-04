import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";
import { etfScreenerRequestSchema } from "@/domains/etfScreener/etfScreener.routes.js";

const upstream502 = errorResponse("analysis-ts 服務無法連線或回應格式異常。");

const etfFilterFieldSchema = z.object({
  field: z.string(),
  label: z.string(),
  kind: z.enum(["numeric", "categorical"]),
  values: z.array(z.string()).optional(),
});

registry.registerPath({
  method: "get",
  path: "/etf-screener/filters",
  summary: "ETF screener 可篩選/顯示欄位目錄",
  description:
    "動態目錄，不是寫死清單——分類欄位（例如 assetClass）的 values 是現查資料庫的 distinct 值，之後可能會增加。這是 ETF screener 系列功能的第一版，之後應該還會擴充。",
  tags: ["ETF Screener"],
  responses: {
    200: {
      description: "欄位目錄。",
      content: {
        "application/json": {
          schema: z.object({ fields: z.array(etfFilterFieldSchema) }).openapi("EtfFilterCatalog", {
            example: {
              fields: [
                { field: "aum", label: "規模（新台幣）", kind: "numeric" },
                { field: "assetClass", label: "資產類型", kind: "categorical", values: ["國內成分證券", "國外成分證券", "債券成分", "槓桿型", "反向型", "多資產", "連結式"] },
              ],
            },
          }),
        },
      },
    },
    502: upstream502,
  },
});

const etfScreenerRequestDocSchema = etfScreenerRequestSchema.openapi("EtfScreenerRequest", {
  example: { filters: [{ field: "market", values: ["TWSE"] }], columns: [{ field: "aum" }], page: 1, pageSize: 50 },
});

const etfScreenerResultSchema = z
  .object({
    count: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
    results: z.array(
      z.object({
        symbol: z.string(),
        fundName: z.string(),
        shortName: z.string(),
        issuerName: z.string().nullable(),
        category: z.string(),
        values: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()]).nullable()),
      }),
    ),
  })
  .openapi("EtfScreenerResult", {
    example: {
      count: 164,
      page: 1,
      pageSize: 2,
      totalPages: 82,
      results: [
        {
          symbol: "0050",
          fundName: "元大台灣卓越50基金",
          shortName: "元大台灣50",
          issuerName: "元大投信",
          category: "上市ETF_國內成分證券ETF",
          values: { aum: 2283731446214, expenseRatio: 0.02 },
        },
      ],
    },
  });

registry.registerPath({
  method: "post",
  path: "/etf-screener",
  summary: "依 GET /etf-screener/filters 目錄篩選 ETF",
  description:
    "不需要登入。filters 跟 columns 至少要提供一個（可以只給 columns 列出所有 ETF 不加篩選）。filters 依欄位種類分兩種形狀：數字欄位用 { field, min, max, exclude? }（語意同股票 screener）；類別欄位（market/assetClass/isActive）用 { field, values: [...] }（IN 語意）。實際欄位要用數字還是類別形狀由 analysis-ts 驗證，用錯形狀會收到說明是哪個欄位、該用哪種形狀的錯誤訊息。results[].values 是 Record<field, number|string|boolean|null>，不是像股票 screener 那樣包成 { value, asOfDate } 物件——這是 ETF screener 系列的第一版，形狀之後可能還會調整。symbol/fundName/shortName/issuerName/category 固定回傳，不需要放進 columns。expenseRatio 只用最新一個完整年度，發行不滿一年的 ETF 這個欄位是 null（不是整檔被排除）。",
  tags: ["ETF Screener"],
  request: {
    body: { required: true, content: { "application/json": { schema: etfScreenerRequestDocSchema } } },
  },
  responses: {
    200: { description: "篩選結果。", content: { "application/json": { schema: etfScreenerResultSchema } } },
    400: errorResponse("filters/columns 都是空的、欄位不存在，或 filter 形狀跟該欄位的種類不符。"),
    502: upstream502,
  },
});
