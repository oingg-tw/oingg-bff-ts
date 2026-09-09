import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";
import { industryTreeQuerySchema, valueChainQuerySchema } from "@/domainBff/industries/industries.routes.js";

const industryLevelSchema = z.enum(["section", "division", "group", "class", "subclass"]);

const industryTreeChildSchema = z.object({
  code: z.string(),
  level: industryLevelSchema,
  name: z.string(),
  companyCount: z.number(),
  hasChildren: z.boolean(),
});

const industryTreeCompanySchema = z.object({ symbol: z.string(), companyName: z.string() });

const industryTreeSchema = z
  .object({
    found: z.boolean(),
    code: z.string().nullable(),
    level: industryLevelSchema.nullable(),
    name: z.string().nullable(),
    companyCount: z.number(),
    children: z.array(industryTreeChildSchema),
    companies: z.array(industryTreeCompanySchema),
  })
  .openapi("IndustryTree", {
    example: {
      found: true,
      code: "C",
      level: "section",
      name: "製造業",
      companyCount: 587,
      children: [{ code: "08", level: "division", name: "食品及飼品製造業", companyCount: 13, hasChildren: true }],
      companies: [],
    },
  });

const industryTreeQueryDocSchema = industryTreeQuerySchema.openapi("IndustryTreeQuery", {
  example: { code: "C" },
});

registry.registerPath({
  method: "get",
  path: "/industries/tree",
  summary: "查詢產業分類樹（財政部稅籍五層分類：section→division→group→class→subclass）",
  description:
    "code 是任一層級的分類代碼，全域唯一，不用另外指定層級——伺服器自己判斷屬於哪一層。省略 code 回傳樹根（19 個 section，此時 code/level/name 為 null）。companyCount 是該節點含所有子孫節點的公司數加總，每一層都有意義，可用來判斷分支值不值得展開；有些 section 的 companyCount 是 0 但 hasChildren 仍是 true（字典本身有子節點，只是目前沒有公司分類在裡面）。companies 只有在 subclass 這個最細層級才會非空——999 家已追蹤公司全部分類在 subclass，中間層級（section/division/group/class）的 companies 固定是空陣列，避免同一家公司在每一層都重複出現；UI 應該用 children 逐層展開，展開到 subclass 才顯示 companies。查無此分類代碼時 found 是 false，code 會照原樣回傳查詢值，其餘欄位跟正常節點同一個 shape（level/name 為 null、children/companies 為空陣列、companyCount 為 0），不是拋錯。範圍限定在 999 家 gov-ts 已追蹤稅籍分類的公司，不含 KY（境外註冊）股——那些公司沒有台灣稅籍可以分類。",
  tags: ["Industries"],
  request: { query: industryTreeQueryDocSchema },
  responses: {
    200: { description: "分類樹節點（含子節點清單跟／或公司清單）。", content: { "application/json": { schema: industryTreeSchema } } },
    502: errorResponse("analysis-ts 服務無法連線或回應格式異常。"),
  },
});

const industryPathNodeSchema = z.object({ code: z.string(), level: industryLevelSchema, name: z.string() });

const industryFlatCompanySchema = z.object({
  symbol: z.string(),
  companyName: z.string(),
  path: z.array(industryPathNodeSchema),
});

const industryFlatListSchema = z
  .object({ companies: z.array(industryFlatCompanySchema) })
  .openapi("IndustryFlatList", {
    example: {
      companies: [
        {
          symbol: "2330",
          companyName: "台積電",
          path: [
            { code: "C", level: "section", name: "製造業" },
            { code: "26", level: "division", name: "電子零組件製造業" },
            { code: "261", level: "group", name: "半導體製造業" },
            { code: "2611", level: "class", name: "積體電路製造業" },
            { code: "2611-99", level: "subclass", name: "其他積體電路製造" },
          ],
        },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/industries/flat",
  summary: "一次取得全部已分類公司的 symbol → 完整分類路徑，供前端自建搜尋索引",
  description:
    "GET /industries/tree 的攤平版——沒有查詢參數，一次回傳所有 999 家 gov-ts 已追蹤公司的完整路徑（由粗到細：section→division→group→class→subclass，每層都帶 code/level/name），不用為了做「股票代號搜尋」或「分類名稱關鍵字搜尋」而遞迴打 GET /industries/tree 建索引。範圍/涵蓋公司跟 GET /industries/tree 一致（目前只有上市公司有資料，上櫃/興櫃待 gov-ts 補齊，補齊後這支端點會自動反映，不用改介面）。analysis-ts 這支端點讀的是常駐記憶體快取，沒有額外 DB 查詢成本，bff-ts 這邊也不另外快取，每次都是即時轉發。",
  tags: ["Industries"],
  responses: {
    200: { description: "全部已分類公司的 symbol → 完整路徑清單。", content: { "application/json": { schema: industryFlatListSchema } } },
    502: errorResponse("analysis-ts 服務無法連線或回應格式異常。"),
  },
});

const valueChainLevelSchema = z.enum(["industry", "subChain"]);
const valueChainMarketSchema = z.enum(["listed", "otc", "rotc"]);

const valueChainTreeChildSchema = z.object({ code: z.string(), name: z.string(), companyCount: z.number() });

const valueChainTreeCompanySchema = z.object({
  symbol: z.string(),
  companyName: z.string(),
  market: valueChainMarketSchema,
});

const valueChainTreeSchema = z
  .object({
    found: z.boolean(),
    code: z.string().nullable(),
    level: valueChainLevelSchema.nullable(),
    name: z.string().nullable(),
    children: z.array(valueChainTreeChildSchema),
    companies: z.array(valueChainTreeCompanySchema),
    dataSource: z.string(),
  })
  .openapi("ValueChainTree", {
    example: {
      found: true,
      code: "1100",
      level: "subChain",
      name: "石灰石",
      children: [],
      companies: [{ symbol: "1101", companyName: "台泥", market: "listed" }],
      dataSource: "https://ic.tpex.org.tw",
    },
  });

const valueChainQueryDocSchema = valueChainQuerySchema.openapi("ValueChainQuery", { example: { code: "1000" } });

registry.registerPath({
  method: "get",
  path: "/industries/value-chain",
  summary: "查詢 TPEx 產業價值鏈分類（2 層：industry→subChain）——跟 /industries/tree 是完全不同的分類系統",
  description:
    "資料來自 tpex-ts 的 TPEx 產業價值鏈資訊平台（ic.tpex.org.tw）匯出，跟 /industries/tree（財政部稅籍五層分類）是兩套獨立系統，不要混用或假設代碼對得上。只有 2 層：industry（一級產業，47 個）→ subChain（次分類，422 個）。code 全域唯一，兩層共用，不用另外指定 level。省略 code 回傳樹根（47 個一級產業，此時 code/level/name 為 null）。**一家公司可以同時對應多個 subChain**（多對多，不是唯一分類）——例如台達電對到 64 個次分類；但這支端點沒有「輸入公司代號、查詢它屬於哪些 subChain」的反向查詢能力（帶 symbol 參數會被忽略，回傳根節點，不是查詢結果），要做這種查詢需要對全部 422 個 subChain 各查一次再自己彙整。companies 只在查詢 subChain 層級的 code 時才會非空，industry 層級固定是空陣列。涵蓋全部三個市場層級（market 欄位：listed=上市、otc=上櫃、rotc=興櫃），共 6481 筆公司-次分類對應關係——這點跟 /industries/tree（只有 999 家上市公司）不同。dataSource 固定回傳 \"https://ic.tpex.org.tw\"（公開可查證的原始網站），不是內部資料表名稱。查無此分類代碼時 found 是 false，code 照原樣回傳查詢值，其餘欄位跟正常節點同一個 shape，不是拋錯。這支端點本身沒有 companyCount 彙總欄位（跟 /industries/tree 不同），只有 children 底下每個節點各自的 companyCount。",
  tags: ["Industries"],
  request: { query: valueChainQueryDocSchema },
  responses: {
    200: {
      description: "價值鏈分類節點（含子節點清單跟／或公司清單）。",
      content: { "application/json": { schema: valueChainTreeSchema } },
    },
    502: errorResponse("analysis-ts 服務無法連線或回應格式異常。"),
  },
});
