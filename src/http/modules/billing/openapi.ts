import { z } from "zod";
import { errorResponse, registry } from "@/http/swagger/registry.js";

const entitlementSchema = z
  .object({
    tier: z.enum(["FREE", "PRO", "ADVISOR"]),
    source: z.enum(["subscription", "trial", "allowlist", "none"]),
    status: z.enum(["TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"]).nullable(),
    currentPeriodEnd: z.string().nullable(),
    trialEndsAt: z.string().nullable(),
    renewalMode: z.enum(["AUTOMATIC", "MANUAL"]).nullable(),
    quotas: z.object({
      watchlistItems: z.number().nullable(),
      screenerPresets: z.number().nullable(),
      columnPresets: z.number().nullable(),
    }),
  })
  .openapi("Entitlement", {
    example: {
      tier: "PRO",
      source: "trial",
      status: null,
      currentPeriodEnd: null,
      trialEndsAt: "2026-10-07T02:31:00.000Z",
      renewalMode: null,
      quotas: { watchlistItems: null, screenerPresets: null, columnPresets: null },
    },
  });

registry.registerPath({
  method: "get",
  path: "/billing/entitlement",
  summary: "查詢自己目前的方案層級與額度上限",
  description:
    "需要登入。回傳呼叫者目前的方案（tier）、這個方案是怎麼來的（source）、以及對應的額度上限（quotas，null 代表無上限）。**前端請一律從這支端點取得額度數字，不要自己寫死**——上限是伺服器端的常數，寫死在前端會在調整時悄悄跟伺服器不一致。\n\n" +
    "tier 有三層：FREE、PRO、ADVISOR。source 說明來源：`subscription`（真的有訂閱資料列）、`trial`（註冊後 14 天的反向試用，免綁卡、不需要任何資料列，從使用者的 createdAt 起算）、`allowlist`（**暫時性的開發用白名單**，金流串好後會移除；出現在正式環境代表有人忘了拿掉）、`none`（免費且沒有任何紀錄）。\n\n" +
    "**renewalMode**（2026-09-24 新增）說明這期結束後會不會自己續下去，是前端唯一能據以決定文案的欄位：`AUTOMATIC` 是信用卡定期定額，金流商那邊有合約、會自動扣款，文案應為「下次扣款 <日期>」；`MANUAL` 是 ATM 虛擬帳號／超商代碼的一次性年繳，金流商那邊**沒有任何合約**，到期就是到期，文案必須是「<日期> 到期，未續費將降級」並提供續費入口。沒有訂閱列時（免費、試用、手動授予）是 null。請**不要**用 providerPeriodNo 是否為 null 去推論——手動授予同樣沒有週期單號，會被誤判成自動續約。訂閱過期降為 FREE 之後這個欄位仍會保留，好讓前端知道該提供續費，而不是等一筆永遠不會來的扣款。" +
    "試用到期是**平滑降級，不是封鎖**：使用者已經建立的東西一律保留，只是不能再新增。超過額度時新增的請求會拿到 403，錯誤物件帶 `code: \"quota_exceeded\"`，前端可據此顯示升級提示，而不是當成一般錯誤。\n\n" +
    "**合規邊界（投信投顧法）**：方案只會影響「查詢廣度、歷史深度、匯出／推播效率」三件事。個股頁的任何分析內容——徽章達標計數、估值河流圖與歷史百分位、杜邦拆解、分位座標敘述、資料溯源與原始財報三表——以及 /screener 的清單筆數，**都不會因為方案不同而有差異**，免費與付費拿到的 payload 完全相同。這不是產品選擇而是法律結構：一旦免費層看到閹割版分析、付費層才「解鎖完整分析」，定價結構本身就成為「販售分析意見」的證據。",
  tags: ["Billing"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "目前的方案與額度",
      content: { "application/json": { schema: entitlementSchema } },
    },
    401: errorResponse("缺少或無效的 Firebase ID token。"),
  },
});
