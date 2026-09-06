import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";
import { industryTreeQuerySchema } from "@/bff/industries/industries.routes.js";

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
