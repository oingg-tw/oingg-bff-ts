import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";
import { industryTreeQuerySchema } from "@/domainBff/industries/industries.routes.js";

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

const securitiesSectorSchema = z.object({ code: z.string(), name: z.string(), companyCount: z.number() });

const securitiesSectorListSchema = z
  .object({ sectors: z.array(securitiesSectorSchema) })
  .openapi("SecuritiesSectorList", {
    example: { sectors: [{ code: "24", name: "半導體業", companyCount: 240 }] },
  });

registry.registerPath({
  method: "get",
  path: "/industries/securities-sectors",
  summary: "查詢證交所類股分類清單（供 screener 的 sectorCodes 篩選使用）",
  description:
    "跟上面的 GET /industries/tree（財政部稅籍五層分類）是完全不同的分類體系——這裡是證交所/櫃買中心自己的類股代碼（例如「24」是半導體業），二碼代號，沒有樹狀階層。回傳的 code 可直接用在 POST /screener 跟 GET /screener/ranking 的 sectorCodes 參數，多個代碼是聯集（OR），再跟其他篩選條件 AND。沒有查詢參數，一次回傳全部類股。",
  tags: ["Industries"],
  responses: {
    200: { description: "全部證交所類股清單。", content: { "application/json": { schema: securitiesSectorListSchema } } },
    502: errorResponse("analysis-ts 服務無法連線或回應格式異常。"),
  },
});

const chainClassificationCompanySchema = z.object({
  symbol: z.string(),
  companyName: z.string(),
  category: z.string().nullable(),
  coarseGroup: z.string().nullable(),
  source: z.enum(["keyword", "gemini"]).nullable(),
  updatedAt: z.string().nullable(),
});

const chainClassificationGroupSchema = z.object({
  coarseGroup: z.string(),
  fineCategories: z.array(z.string()),
});

const chainClassificationListSchema = z
  .object({
    companies: z.array(chainClassificationCompanySchema),
    groups: z.array(chainClassificationGroupSchema),
  })
  .openapi("ChainClassificationList", {
    example: {
      companies: [
        { symbol: "1101", companyName: "台泥", category: "水泥建材", coarseGroup: "工業材料與設備", source: "gemini", updatedAt: "2026-09-14" },
      ],
      groups: [
        { coarseGroup: "工業材料與設備", fineCategories: ["化學塑膠材料", "工業自動化", "水泥建材", "紙業包裝材料", "鋼鐵金屬材料"] },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/industries/chain-classification",
  summary: "供應鏈關係分類全量清單（給「產業追蹤」頁面用，非財政部稅籍分類）",
  description:
    "資料來自 oingg-analysis-ts 的 GET /industries/chain-classification（2026-09-14 新增）——分類來源是 oingg-playwright-py 用 Gemini 解析真實供應鏈關係得出的分類，跟上面 GET /industries/tree／GET /industries/flat 的財政部稅籍五層分類是完全不同、互不相關的體系，這支是全新獨立端點，不是取代那兩支（那兩支照常運作不受影響）。companies 約 1984 家（涵蓋上市＋上櫃＋KY 境外註冊公司，比稅籍分類的 999 家範圍更廣），category 為 null 的公司不會被濾掉（代表這家公司尚未被分類或分類信心不足）。groups 是粗分類→細分類的對照表（10 組），可用來做前端的 drill-down 選單。source/updatedAt 跟 GET /stocks/{symbol}/peer-group 的同名欄位語意完全一致（同一份底層快取，2026-09-15 起取代原本的 confidence/sampleSize）——source 是 keyword（僅用免費關鍵字規則）或 gemini（額外經 Gemini 語意驗證/修正）之一，代表這家公司自己的分類判定方式，可當成單一品質等級看待，不用再自己做門檻篩選；updatedAt 是快取最後更新時間，沒有排程重抓機制，不代表資料新鮮度保證。沒有查詢參數，一次回傳全量。",
  tags: ["Industries"],
  responses: {
    200: { description: "全量供應鏈分類清單（公司 + 分類對照表）。", content: { "application/json": { schema: chainClassificationListSchema } } },
    502: errorResponse("analysis-ts 服務無法連線或回應格式異常。"),
  },
});

const chainClusterMemberSchema = z.object({
  code: z.string(),
  name: z.string(),
  isListed: z.boolean(),
});

const chainSubClusterSchema = z.object({
  subClusterId: z.number(),
  subLabel: z.string(),
  members: z.array(chainClusterMemberSchema),
});

const chainClusterSchema = z.object({
  clusterId: z.number(),
  label: z.string(),
  metaGroup: z.string().nullable(),
  directMembers: z.array(chainClusterMemberSchema),
  subClusters: z.array(chainSubClusterSchema),
});

const chainClusterTreeSchema = z
  .object({ clusters: z.array(chainClusterSchema) })
  .openapi("ChainClusterTree", {
    example: {
      clusters: [
        {
          clusterId: 0,
          label: "證券金融與資安雲端",
          metaGroup: "金融服務",
          directMembers: [],
          subClusters: [
            {
              subClusterId: 0,
              subLabel: "期貨與證券商",
              members: [
                { code: "5201", name: "凱衛", isListed: true },
                { code: "citigroupinc", name: "花旗集團（Citigroup Inc）", isListed: false },
              ],
            },
          ],
        },
      ],
    },
  });

registry.registerPath({
  method: "get",
  path: "/industries/chain-clusters",
  summary: "供應鏈聚落樹（113 個頂層聚落＋475 個子聚落，含國際供應鏈節點）——跟扁平分類是完全獨立的兩套分群概念",
  description:
    "資料來自 oingg-analysis-ts 的 GET /industries/chain-clusters（2026-09-14 新增）。跟 GET /industries/chain-classification 的扁平 category/coarseGroup 分類是完全獨立的兩套分群概念，並存服務不同的瀏覽方式，不是取代關係。**兩個必須遵守的限制**：(1) clusterId/subClusterId/metaGroup 底層的分群結果**都不是穩定的**——playwright-py 重新跑分群演算法後，同一個 id 可能對應到完全不同的一群公司，編號會整個洗牌；前端不能把這些值放進 URL 參數、收藏、分享連結、或任何形式的快取，只能當「這次查詢當下」使用，每次都要重新呼叫這支端點取得最新的樹。(2) 成員的 code 不是只有台股代號——供應鏈圖包含蘋果/NVIDIA 這類國際客戶/供應商節點（約 7,566 個節點中 1,912 個是上市櫃、5,654 個是外部公司），isListed:false 代表這是外部節點，沒有對應的個股詳情頁可以連結，點擊行為要先判斷這個欄位。metaGroup（2026-09-15 新增）是把細聚落再收斂成給人類瀏覽用的粗分組標籤——分布形狀刻意不均勻（例如目前約 177/233 個聚落集中在同一組），這是真實反映台股供應鏈圖以電子業為核心的結構，不是資料異常（先前確實有過一次分群參數副作用造成的真異常，已由 playwright-py 修好並重新驗證過）。directMembers 只有節點數 <=100、沒有再往下分子聚落的頂層聚落才會有內容，其餘頂層聚落的成員都在 subClusters 底下。沒有查詢參數，一次回傳整棵樹。",
  tags: ["Industries"],
  responses: {
    200: { description: "完整供應鏈聚落樹。", content: { "application/json": { schema: chainClusterTreeSchema } } },
    502: errorResponse("analysis-ts 服務無法連線或回應格式異常。"),
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
