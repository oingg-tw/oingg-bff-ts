import { z } from "zod";
import { errorResponse, registry } from "@/http/swagger/registry.js";
import { createTransactionSchema, importTransactionsSchema, updateTransactionSchema } from "@/http/modules/transactions/route.js";

const transactionSchema = z
  .object({
    id: z.string(),
    symbol: z.string(),
    action: z.enum(["BUY", "SELL"]),
    quantity: z.number(),
    price: z.string(),
    fee: z.string(),
    tax: z.string(),
    tradeDate: z.string(),
    note: z.string().nullable(),
    source: z.string().nullable().openapi({ description: "批次匯入的來源，一家券商一個（目前只有 yuanta-csv；期初部位是 opening）。手動輸入是 null。" }),
    externalRef: z.string().nullable().openapi({ description: '來源系統裡那一列的識別字串（券商 CSV 是 "YYYY-MM-DD|委託書號"）。手動輸入是 null。', example: "2026-03-14|A12345" }),
    importId: z.string().nullable().openapi({ description: "同一次匯入共用，用於整批撤銷。手動輸入是 null。", format: "uuid" }),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("StockTransaction");

const importResultSchema = z
  .object({
    importId: z.string().nullable().openapi({ description: "dryRun 時、以及整批都是重複列（重匯同一份檔）時為 null——沒有東西被寫進去，就沒有東西可以撤銷。", format: "uuid" }),
    inserted: z.number().openapi({ description: "實際寫入（或 dryRun 時將會寫入）的交易筆數，不含期初部位。" }),
    duplicates: z.number().openapi({ description: "因為 externalRef 已存在而跳過的筆數。不是錯誤。" }),
    openingPositions: z.array(z.object({ symbol: z.string(), status: z.enum(["created", "skipped"]) })),
    holdings: z.array(
      z.object({
        symbol: z.string(),
        quantity: z.number(),
        averageCost: z.string(),
        totalCost: z.string(),
        realizedProfitLoss: z.string(),
      }),
    ).openapi({ description: "匯入之後的持股明細，形狀與 GET /holdings 完全相同（同一支投影算的）。" }),
  })
  .openapi("ImportTransactionsResult");

const shortfallsResponse = {
  description: [
    "**整段 replay 會出現賣超**，所以整批都沒有寫入。每一筆賣超都列出來，前端據此請使用者補期初部位。",
    "",
    "`shortBy` 是**那個時點**缺的股數。同一檔有多筆賣超時，**要補的期初股數是同一檔 `shortBy` 的加總**"
      + "——每一筆賣超後部位被夾成 0，下一筆量到的是額外的缺口。加總剛好是讓整段不賣超的最小期初股數。",
    "",
    "`externalRef` 為 null 代表那筆賣超來自既有的手動交易，不在這次請求的 `transactions` 裡。",
  ].join("\n"),
  content: {
    "application/json": {
      schema: z.object({
        shortfalls: z.array(
          z.object({
            symbol: z.string(),
            tradeDate: z.string(),
            externalRef: z.string().nullable(),
            shortBy: z.number(),
          }),
        ),
      }),
    },
  },
};

const idParam = z.object({ id: z.string().openapi({ format: "uuid" }) });
const unauthorized = errorResponse("缺少或無效的 Authorization header / token。");
const notFound = errorResponse("此 id 不存在，或不屬於目前登入的使用者。");

registry.registerPath({
  method: "get",
  path: "/transactions",
  summary: "列出目前登入使用者的交易日誌（買進／賣出紀錄）",
  tags: ["Transactions"],
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({ symbol: z.string().optional().openapi({ description: "只列出這個股票代號的交易紀錄。" }) }),
  },
  responses: {
    200: {
      description: "交易紀錄清單（依交易日期新到舊排序）。",
      content: { "application/json": { schema: z.object({ transactions: z.array(transactionSchema) }) } },
    },
    401: unauthorized,
  },
});

registry.registerPath({
  method: "post",
  path: "/transactions",
  summary: "新增一筆交易日誌（買進／賣出紀錄）",
  description: "這是獨立的交易日誌，不會自動更新 /holdings 的持股數量；會先確認 symbol 在 twse/tpex 其中一邊查得到資料。",
  tags: ["Transactions"],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createTransactionSchema.openapi("CreateTransactionRequest") } },
    },
  },
  responses: {
    201: {
      description: "新增成功的交易紀錄。",
      content: { "application/json": { schema: z.object({ transaction: transactionSchema }) } },
    },
    400: errorResponse("缺少必填欄位，或欄位型別/數值不合法。"),
    401: unauthorized,
    404: errorResponse("此股票代號在 twse/tpex 都查無資料。"),
  },
});

registry.registerPath({
  method: "get",
  path: "/transactions/{id}",
  summary: "查詢單一交易紀錄",
  tags: ["Transactions"],
  security: [{ bearerAuth: [] }],
  request: { params: idParam },
  responses: {
    200: {
      description: "交易紀錄。",
      content: { "application/json": { schema: z.object({ transaction: transactionSchema }) } },
    },
    400: errorResponse("id 不是合法的 UUID。"),
    401: unauthorized,
    404: notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/transactions/{id}",
  summary: "更新一筆交易紀錄",
  description: "symbol 不可變更（要換 symbol 請刪除後重新新增）。",
  tags: ["Transactions"],
  security: [{ bearerAuth: [] }],
  request: {
    params: idParam,
    body: { content: { "application/json": { schema: updateTransactionSchema.openapi("UpdateTransactionRequest") } } },
  },
  responses: {
    200: {
      description: "更新後的交易紀錄。",
      content: { "application/json": { schema: z.object({ transaction: transactionSchema }) } },
    },
    400: errorResponse("id 不是合法的 UUID，或欄位型別/數值不合法。"),
    401: unauthorized,
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/transactions/{id}",
  summary: "刪除一筆交易紀錄",
  tags: ["Transactions"],
  security: [{ bearerAuth: [] }],
  request: { params: idParam },
  responses: {
    204: { description: "刪除成功，無回應內容。" },
    400: errorResponse("id 不是合法的 UUID。"),
    401: unauthorized,
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/transactions/import",
  summary: "批次匯入交易（券商 CSV）",
  description: [
    "**原始 CSV 不上傳。** 券商檔案由前端在瀏覽器裡解析（Big5 解碼、跳過小計列、檢查算術），",
    "這裡收到的是已正規化、跟券商無關的交易列。換一家券商只要改前端，這份契約不用動。",
    "",
    "### 一次全寫或全不寫",
    "任何一列欄位不合法 → 400；有未知代號 → 404；整段 replay 有賣超 → 422（見下）。都不會寫入半批。",
    "",
    "### source：一家券商一個",
    "目前只接受 `yuanta-csv`，其他值回 400。**不同券商不共用 source**：它是冪等鍵的命名空間，而兩家券商的",
    "「日期｜委託書號」可能相同，共用的話另一家的交易會被當成重複、靜默略過。",
    "",
    "### 冪等",
    "唯一鍵是 `(使用者, source, externalRef)`，已存在的列會被跳過並計入 `duplicates`，不算錯誤——",
    "所以使用者重匯一份有重疊期間的檔案是安全的。`externalRef` 請用 `\"YYYY-MM-DD|委託書號\"`：",
    "**委託書號單獨看不唯一**，券商會跨日重用。手動輸入的交易 `source` 與 `externalRef` 都是 null，",
    "而 Postgres 的 NULL 在唯一索引裡不互相碰撞，所以手動輸入完全不受這把鍵限制。",
    "",
    "### 同一批之內的排序",
    "**交易日升冪 → 買進先於賣出 → 陣列順序。** 中間那一層是刻意的：券商匯出檔的列序不是成交順序",
    "（實測有「同一天先賣後買卻排成先買後賣」的案例），照列序 replay 會製造出**假的賣超**把整批擋掉。",
    "買進先於賣出不會，代價是均價可能與券商自己算的不同。排序結果會逐列寫進 `createdAt`，",
    "所以之後每次 `GET /holdings` 重算都會重現同一個答案。",
    "",
    "### 期初部位",
    "`openingPositions` 會寫成一筆 `BUY`，日期排在該檔最早一筆交易的**前一天**（既有交易與這一批合起來看）。",
    "它用保留的 `source: \"opening\"` 與 `externalRef: 代號`，所以重送同一個期初就是 duplicate、被跳過。",
    "**已經有期初部位的代號一律跳過、不覆蓋**（`openingPositions[].status: \"skipped\"`）——匯入永不改既有的列，",
    "要改期初就直接編輯那一筆交易。",
    "",
    "`averageCost` 的 0 代表**真的零成本**（配股／增資配發）。券商匯出檔裡的成本 0 通常是「券商不知道成本」,",
    "那不能當成 0 送進來，否則已實現損益會被灌水——未知就讓使用者自己填。",
    "",
    "### dryRun",
    "`dryRun: true` 跑完全相同的驗證但不寫入，回 200、`importId` 為 null。預覽畫面請用它，",
    "不要在前端另寫一份 replay——成本法有兩份就會漂。",
    "",
    "### 上限",
    "`transactions` 與 `openingPositions` 合計 ≤ 2000 列。代號守衛對整張有價證券總表查一次",
    "（3 次上游呼叫），所以成本與批次大小無關。",
    "",
    "**v1 不收**融資、融券與非台幣交易——那些列請在前端跳過並向使用者說明原因。",
  ].join("\n"),
  tags: ["Transactions"],
  security: [{ bearerAuth: [] }],
  request: {
    body: { required: true, content: { "application/json": { schema: importTransactionsSchema.openapi("ImportTransactionsRequest") } } },
  },
  responses: {
    200: {
      description: "沒有任何寫入：dryRun，或整批都是已匯入過的重複列。importId 為 null。",
      content: { "application/json": { schema: importResultSchema } },
    },
    201: {
      description: "匯入完成。`importId` 可用於 DELETE /transactions/import/{importId} 整批撤銷。",
      content: { "application/json": { schema: importResultSchema } },
    },
    400: errorResponse('source 不在白名單、超過 2000 列、批次內 externalRef 重複，或某一列的欄位不合法。'),
    401: unauthorized,
    404: errorResponse("有代號不在有價證券總表裡（訊息列出最多 10 個）。"),
    422: shortfallsResponse,
  },
});

registry.registerPath({
  method: "delete",
  path: "/transactions/import/{importId}",
  summary: "撤銷整批匯入",
  description: [
    "刪掉這個 `importId` 底下的所有交易。匯入一次就是上百筆，沒有這支的話匯錯只能一筆一筆刪。",
    "",
    "**會先驗 replay**：撤掉這一批可能讓之後手動輸入的賣出變成賣超，那時候回 422 加同一個 `shortfalls`",
    "形狀，什麼都不刪——而不是默默留下一個負部位。使用者的解法是先處理那幾筆手動交易。",
  ].join("\n"),
  tags: ["Transactions"],
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ importId: z.string().openapi({ format: "uuid" }) }) },
  responses: {
    200: {
      description: "撤銷完成。",
      content: { "application/json": { schema: z.object({ deleted: z.number() }) } },
    },
    400: errorResponse("importId 不是合法的 UUID。"),
    401: unauthorized,
    404: errorResponse("找不到這個 importId（或它不屬於目前登入的使用者）。"),
    422: shortfallsResponse,
  },
});
