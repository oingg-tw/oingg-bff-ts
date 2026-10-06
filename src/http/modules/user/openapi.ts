import { z } from "zod";
import { errorResponse, registry } from "@/http/swagger/registry.js";
import {
  updateDashboardCardsSchema,
  updateFullWidthSchema,
  updateHoldingColumnsSchema,
  updateWatchlistColumnsSchema,
  updateMarketColorConventionSchema,
  updatePreferredStocksPreferencesSchema,
  updateShowAsOfDateSchema,
  updateStockDetailPreferencesSchema,
  updateThemeAccentColorSchema,
  updateThemeModeSchema,
} from "@/http/modules/user/route.js";

const userProfileSchema = z
  .object({
    id: z.string(),
    firebaseUid: z.string(),
    email: z.string().nullable(),
    displayName: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("UserProfile");

const themeSchema = z
  .object({
    mode: z.enum(["LIGHT", "DARK", "SYSTEM"]),
    accentColor: z.enum(["BLUE", "GREEN", "PURPLE", "ORANGE", "RED", "TEAL", "GOLD"]),
    marketColorConvention: z.enum(["ASIA", "WESTERN", "ACCESSIBLE"]),
    isFullWidth: z.boolean(),
  })
  .openapi("ThemePreference", {
    example: { mode: "DARK", accentColor: "PURPLE", marketColorConvention: "ASIA", isFullWidth: true },
  });

const themeResponseSchema = z.object({ theme: themeSchema });

const displaySettingsSchema = z.object({ showAsOfDate: z.boolean() }).openapi("ScreenerDisplaySettings");
const displaySettingsResponseSchema = z.object({ displaySettings: displaySettingsSchema });

const dashboardCardsSchema = z
  .object({ visibleCardIds: z.array(z.string()).nullable() })
  .openapi("DashboardCardSettings", {
    example: { visibleCardIds: ["margin-short-ratio", "revenue-ranking", "volume-top20"] },
  });
const dashboardCardsResponseSchema = z.object({ dashboardCards: dashboardCardsSchema });

const stockDetailPreferencesSchema = z
  .object({
    mode: z.enum(["CARD", "ACCOUNTING"]).nullable(),
    visibleCardIds: z.array(z.string()).nullable(),
    pinnedMetricSlugs: z.array(z.string()).nullable(),
  })
  .openapi("StockDetailPreferences", {
    example: {
      mode: "CARD",
      visibleCardIds: ["profile", "per-river", "pbr-river", "eps", "revenue"],
      pinnedMetricSlugs: ["roe", "current-ratio", "pe-ratio"],
    },
  });
const stockDetailPreferencesResponseSchema = z.object({ stockDetailPreferences: stockDetailPreferencesSchema });

const preferredStocksPreferencesSchema = z
  .object({
    columnPresetId: z.enum(["ALL", "CONTRACT_TERMS", "VALUATION", "CALL_RISK"]).nullable(),
    columnOrder: z.array(z.string()).nullable(),
  })
  .openapi("PreferredStocksPreferences", {
    example: { columnPresetId: "CONTRACT_TERMS", columnOrder: ["dividend-type", "participation", "issue-price"] },
  });
const preferredStocksPreferencesResponseSchema = z.object({
  preferredStocksPreferences: preferredStocksPreferencesSchema,
});

const unauthorized = errorResponse("缺少或無效的 Authorization header / token。");

registry.registerPath({
  method: "get",
  path: "/users/me",
  summary: "查詢目前登入使用者的 user profile",
  description: "依 Firebase token 的 uid 查詢這個服務自己 DB 裡的 users 表（見 user.service.ts）。目前沒有 signup/首次登入自動建檔流程，查無資料回 404。",
  tags: ["User"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: "user profile。", content: { "application/json": { schema: z.object({ user: userProfileSchema }) } } },
    401: unauthorized,
    404: errorResponse("找不到對應此 Firebase uid 的使用者。"),
  },
});

registry.registerPath({
  method: "get",
  path: "/users/me/theme",
  summary: "查詢目前登入使用者的 UI 主題設定",
  description:
    "尚未設定過的欄位回傳系統預設值（mode: SYSTEM, accentColor: GOLD, marketColorConvention: ASIA, isFullWidth: true——符合目前上線版面本來就是滿版的實際狀態），不是寫死在使用者資料裡的快照——之後調整系統預設，沒特別設定過的使用者會直接跟著變。",
  tags: ["User"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "主題設定，包在 \"theme\" 這個 key 底下（不是扁平物件）。",
      content: { "application/json": { schema: themeResponseSchema } },
    },
    401: unauthorized,
  },
});

registry.registerPath({
  method: "put",
  path: "/users/me/theme/mode",
  summary: "更新外觀模式（淺色／深色／跟隨系統）",
  tags: ["User"],
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: updateThemeModeSchema.openapi("UpdateThemeModeRequest") } } },
  },
  responses: {
    200: {
      description: "更新後的完整主題設定，包在 \"theme\" 這個 key 底下（跟 GET /users/me/theme 同一個 shape）。",
      content: { "application/json": { schema: themeResponseSchema } },
    },
    400: errorResponse("mode 沒給，或不在允許的選項內。"),
    401: unauthorized,
  },
});

registry.registerPath({
  method: "put",
  path: "/users/me/theme/accent-color",
  summary: "更新主題色",
  tags: ["User"],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: updateThemeAccentColorSchema.openapi("UpdateThemeAccentColorRequest") } },
    },
  },
  responses: {
    200: {
      description: "更新後的完整主題設定，包在 \"theme\" 這個 key 底下（跟 GET /users/me/theme 同一個 shape）。",
      content: { "application/json": { schema: themeResponseSchema } },
    },
    400: errorResponse("accentColor 沒給，或不在允許的選項內。"),
    401: unauthorized,
  },
});

registry.registerPath({
  method: "put",
  path: "/users/me/theme/market-color-convention",
  summary: "更新漲跌顏色慣例",
  description: "ASIA（紅漲綠跌，台股慣例，系統預設）、WESTERN（紅跌綠漲，歐美慣例），或 ACCESSIBLE（色盲友善藍橘配色，取代紅綠）。",
  tags: ["User"],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { "application/json": { schema: updateMarketColorConventionSchema.openapi("UpdateMarketColorConventionRequest") } },
    },
  },
  responses: {
    200: {
      description: "更新後的完整主題設定，包在 \"theme\" 這個 key 底下（跟 GET /users/me/theme 同一個 shape）。",
      content: { "application/json": { schema: themeResponseSchema } },
    },
    400: errorResponse("marketColorConvention 沒給，或不在允許的選項內。"),
    401: unauthorized,
  },
});

registry.registerPath({
  method: "put",
  path: "/users/me/theme/full-width",
  summary: "更新「視覺滿版」設定",
  description:
    "整個 app 通用的版面偏好（主內容區是否佔滿整個頁面寬度），不限定某個功能頁面。系統預設 true（滿版），對應目前上線版面本來就是滿版的實際狀態；false 是新的「置中」選配。",
  tags: ["User"],
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: updateFullWidthSchema.openapi("UpdateFullWidthRequest") } } },
  },
  responses: {
    200: {
      description: "更新後的完整主題設定，包在 \"theme\" 這個 key 底下（跟 GET /users/me/theme 同一個 shape）。",
      content: { "application/json": { schema: themeResponseSchema } },
    },
    400: errorResponse("isFullWidth 不是布林值。"),
    401: unauthorized,
  },
});

registry.registerPath({
  method: "get",
  path: "/users/me/screener-display-settings",
  summary: "查詢目前登入使用者的 screener 顯示設定",
  description:
    "目前只有一項：showAsOfDate（screener/ranking 結果表格是否顯示每個數值的資料時間，見 asOfDate）。只有已登入使用者能用這個設定（未登入的 screener 呼叫不會套用任何顯示設定）。尚未設定過回傳系統預設值（false，不顯示），不是寫死在使用者資料裡的快照——之後調整系統預設，沒特別設定過的使用者會直接跟著變。",
  tags: ["User"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: "顯示設定。", content: { "application/json": { schema: displaySettingsResponseSchema } } },
    401: unauthorized,
  },
});

registry.registerPath({
  method: "put",
  path: "/users/me/screener-display-settings/show-as-of-date",
  summary: "更新「是否顯示資料時間」設定",
  tags: ["User"],
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: updateShowAsOfDateSchema.openapi("UpdateShowAsOfDateRequest") } } },
  },
  responses: {
    200: { description: "更新後的顯示設定。", content: { "application/json": { schema: displaySettingsResponseSchema } } },
    400: errorResponse("showAsOfDate 不是布林值。"),
    401: unauthorized,
  },
});

registry.registerPath({
  method: "get",
  path: "/users/me/dashboard-cards",
  summary: "查詢目前登入使用者的首頁卡片顯示偏好",
  description:
    "visibleCardIds 沒設定過是 null（不是 []）——null 代表「還沒存過偏好」，[] 代表「使用者主動把每張卡片都關掉」，兩者語意不同。卡片 id 是前端自訂、會持續增加的清單，這個服務不驗證/不知道目前完整清單有哪些，null 時前端應該自行套用自己的預設清單。",
  tags: ["User"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "顯示偏好，包在 \"dashboardCards\" 這個 key 底下。",
      content: { "application/json": { schema: dashboardCardsResponseSchema } },
    },
    401: unauthorized,
  },
});

registry.registerPath({
  method: "put",
  path: "/users/me/dashboard-cards",
  summary: "更新目前登入使用者的首頁卡片顯示偏好",
  description: "完整覆蓋整份清單（不是增量新增/刪除單一卡片）——前端要保留哪些卡片，就把完整清單傳過來。",
  tags: ["User"],
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { "application/json": { schema: updateDashboardCardsSchema.openapi("UpdateDashboardCardsRequest") } } },
  },
  responses: {
    200: {
      description: "更新後的顯示偏好，包在 \"dashboardCards\" 這個 key 底下（跟 GET 同一個 shape）。",
      content: { "application/json": { schema: dashboardCardsResponseSchema } },
    },
    400: errorResponse("visibleCardIds 沒給，或不是字串陣列。"),
    401: unauthorized,
  },
});

registry.registerPath({
  method: "get",
  path: "/users/me/stock-detail-preferences",
  summary: "查詢目前登入使用者的個股詳細頁顯示偏好",
  description:
    "/stock/[code].vue 的版面模式（mode: CARD/ACCOUNTING，2026-09-07 從三選一「簡易/專家/會計」收斂成二選一，因為簡易/專家從未真正呈現不同內容）與資訊卡片顯示偏好（visibleCardIds），兩者都沒設定過是 null——null 代表「還沒存過偏好」，[] 代表「使用者主動把每張卡片都關掉」，兩者語意不同（跟 dashboard-cards 一致）。卡片 id 是前端自訂清單，這個服務不驗證/不知道目前完整清單有哪些。",
  tags: ["User"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "顯示偏好，包在 \"stockDetailPreferences\" 這個 key 底下。",
      content: { "application/json": { schema: stockDetailPreferencesResponseSchema } },
    },
    401: unauthorized,
  },
});

registry.registerPath({
  method: "put",
  path: "/users/me/stock-detail-preferences",
  summary: "更新目前登入使用者的個股詳細頁顯示偏好",
  description:
    "mode 跟 visibleCardIds 一起整包覆蓋（沒有只改其中一個的端點）——前端的設定彈窗本來就是兩者一起存。" +
    "**pinnedMetricSlugs（2026-09-25 新增）是選填，而且三個狀態各有不同意思**：沒送＝不動既有值、" +
    "送 `[]`＝使用者取消了所有釘選、送陣列＝就是側邊欄的釘選順序。" +
    "「沒送就不動」是過渡設計，為的是讓 bff-ts 與 web-nuxt 誰先上線都不會壞——若做成必填，舊 client 每次 PUT 都會 400；" +
    "若把沒送當成 `[]`，舊 client 每存一次設定就會清空使用者的釘選。web-nuxt 改成三個欄位一起送之後那條分支就不會再走到。" +
    "**順序有意義且原樣儲存**，這個服務不排序、不去重。slug 的內容不驗證（值是 web-nuxt 的頁面 slug，vocabulary 在他們的 hub-slugs.ts、會隨新頁面增減），上限 50 個。",
  tags: ["User"],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": { schema: updateStockDetailPreferencesSchema.openapi("UpdateStockDetailPreferencesRequest") },
      },
    },
  },
  responses: {
    200: {
      description: "更新後的顯示偏好，包在 \"stockDetailPreferences\" 這個 key 底下（跟 GET 同一個 shape）。",
      content: { "application/json": { schema: stockDetailPreferencesResponseSchema } },
    },
    400: errorResponse("mode 不在允許的選項內、visibleCardIds 沒給／不是字串陣列，或 pinnedMetricSlugs 不是字串陣列／超過 50 個。"),
    401: unauthorized,
  },
});

registry.registerPath({
  method: "get",
  path: "/users/me/preferred-stocks-preferences",
  summary: "查詢目前登入使用者的特別股清單頁顯示偏好",
  description:
    "/preferred-stocks 頁面選中的欄位預設分頁（columnPresetId: ALL/CONTRACT_TERMS/VALUATION/CALL_RISK，對應全部欄位/契約條款/估值指標/贖回風險）與可拖曳排序的欄位順序（columnOrder）。兩者都沒設定過是 null——null 代表「還沒存過偏好」，跟 dashboard-cards/stock-detail-preferences 一致。columnOrder 的欄位 id 是前端自訂清單，這個服務不驗證/不知道目前完整清單有哪些。",
  tags: ["User"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "顯示偏好，包在 \"preferredStocksPreferences\" 這個 key 底下。",
      content: { "application/json": { schema: preferredStocksPreferencesResponseSchema } },
    },
    401: unauthorized,
  },
});

registry.registerPath({
  method: "put",
  path: "/users/me/preferred-stocks-preferences",
  summary: "更新目前登入使用者的特別股清單頁顯示偏好",
  description: "columnPresetId 跟 columnOrder 一起整包覆蓋（沒有只改其中一個的端點）——前端的顯示設定本來就是兩者一起存。",
  tags: ["User"],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        "application/json": {
          schema: updatePreferredStocksPreferencesSchema.openapi("UpdatePreferredStocksPreferencesRequest"),
        },
      },
    },
  },
  responses: {
    200: {
      description: "更新後的顯示偏好，包在 \"preferredStocksPreferences\" 這個 key 底下（跟 GET 同一個 shape）。",
      content: { "application/json": { schema: preferredStocksPreferencesResponseSchema } },
    },
    400: errorResponse("columnPresetId 不在允許的選項內，或 columnOrder 沒給／不是字串陣列。"),
    401: unauthorized,
  },
});

const holdingColumnsResponse = z
  .object({
    holdingColumns: z.object({
      columns: z
        .array(
          z.object({
            id: z.string(),
            label: z.string(),
            formula: z.string().openapi({ example: "=D/A" }),
            format: z.enum(["number", "percent", "money"]),
            decimals: z.number().int(),
          }),
        )
        .nullable()
        .openapi({ description: "null＝從來沒存過（前端套用自己的預設）；[]＝刻意存了一份空清單。順序就是顯示順序。" }),
    }),
  })
  .openapi("HoldingColumnsResponse");

registry.registerPath({
  method: "get",
  path: "/users/me/holding-columns",
  summary: "查詢持股頁的自訂欄位（Excel 風格的公式欄）",
  description: [
    "使用者自己定義的持股欄位，例如「第二欄除以第一欄」。`formula` 是 Excel 風格字串（`=D/A`、`=ROUND(E/B*100, 2)`），",
    "**bff-ts 只存、不解析也不計算**：計算在瀏覽器裡對使用者自己的持股進行。欄位字母由前端定義",
    "（內建 A～G，自訂欄位從 H 起依清單順序），所以**清單順序本身就是公式參照的一部分**。",
  ].join("\n"),
  tags: ["Users"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: "自訂欄位。", content: { "application/json": { schema: holdingColumnsResponse } } },
    401: unauthorized,
  },
});

registry.registerPath({
  method: "put",
  path: "/users/me/holding-columns",
  summary: "整份覆蓋持股頁的自訂欄位",
  description: [
    "整份取代，順序就是顯示順序。驗證：`id` 1～40 字元且清單內不可重複；`label` 去頭尾空白後 1～20 字元；",
    "`formula` 1～200 字元（不驗語意）；`format` 是 number／percent／money；`decimals` 0～4 的整數；最多 50 欄（跟方案無關的硬上限）。",
    "",
    "**方案額度**：`GET /billing/entitlement` 的 `quotas.customHoldingColumns`（FREE 10＝3 欄自訂＋7 欄預設，付費方案 null＝不限）。",
    "超過額度回 403、`code: \"quota_exceeded\"`——但**只有在比目前已存的更多時才擋**：降級後已經超過額度的使用者，",
    "仍然可以調整順序、修改或刪減既有欄位，只是不能再變多（降級只變唯讀、永不刪除）。",
  ].join("\n"),
  tags: ["Users"],
  security: [{ bearerAuth: [] }],
  request: {
    body: { required: true, content: { "application/json": { schema: updateHoldingColumnsSchema.openapi("UpdateHoldingColumnsRequest") } } },
  },
  responses: {
    200: { description: "存好之後的自訂欄位。", content: { "application/json": { schema: holdingColumnsResponse } } },
    400: errorResponse("欄位形狀或長度不合法，或 id 重複。"),
    401: unauthorized,
    403: errorResponse("超過方案的自訂欄位額度，而且比目前已存的更多（code: quota_exceeded）。"),
  },
});

const watchlistColumnsResponse = z
  .object({
    watchlistColumns: z.object({
      columns: z
        .array(z.object({ field: z.string().openapi({ example: "exchangePeRatio.EOD" }), label: z.string() }))
        .nullable()
        .openapi({ description: "null＝從來沒存過，前端套用自己的預設；[]＝刻意存了一份空清單。" }),
    }),
  })
  .openapi("WatchlistColumnsResponse");

registry.registerPath({
  method: "get",
  path: "/users/me/watchlist-columns",
  summary: "查詢自選股表格的顯示欄位",
  description:
    "使用者自己排的自選股表格欄位（2026-10-06）。這裡只存清單；數值由前端拿 field 去打 POST /screener/values（前端自己算的合成欄位除外）。",
  tags: ["Users"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: "顯示欄位。", content: { "application/json": { schema: watchlistColumnsResponse } } },
    401: unauthorized,
  },
});

registry.registerPath({
  method: "put",
  path: "/users/me/watchlist-columns",
  summary: "整份覆蓋自選股表格的顯示欄位",
  description: [
    "整份取代，順序就是顯示順序，**含前端的預設欄**。驗證：`label` 去頭尾空白後 1～60 字元；最多 20 欄（跟方案無關的硬上限）；",
    "`field` 必須是下列之一，否則 400：GET /metrics 型錄裡的欄位（`metricCode.token`）、報價特殊欄位 `stock.price`／`stock.previousClose`、",
    "或前端自己算的兩個合成欄位 `watchlist.change`（漲跌）與 `watchlist.exDividend`（下次除權息）。同一個 field 出現兩次不擋。",
    "",
    "**方案額度**：`GET /billing/entitlement` 的 `quotas.watchlistColumns`（FREE 8＝3 欄自訂＋5 欄預設，付費方案 null＝不限）。",
    "超過額度回 403、`code: \"quota_exceeded\"`——只有在比目前已存的更多時才擋，降級後仍可調順序與刪欄位。",
  ].join("\n"),
  tags: ["Users"],
  security: [{ bearerAuth: [] }],
  request: {
    body: { required: true, content: { "application/json": { schema: updateWatchlistColumnsSchema.openapi("UpdateWatchlistColumnsRequest") } } },
  },
  responses: {
    200: { description: "存好之後的顯示欄位。", content: { "application/json": { schema: watchlistColumnsResponse } } },
    400: errorResponse("欄位形狀或長度不合法、超過 20 欄，或有認不得的 field。"),
    401: unauthorized,
    403: errorResponse("超過方案的欄位額度，而且比目前已存的更多（code: quota_exceeded）。"),
  },
});
