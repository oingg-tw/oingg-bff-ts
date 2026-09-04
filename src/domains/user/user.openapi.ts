import { z } from "zod";
import { errorResponse, registry } from "@/adapters/swagger/registry.js";
import {
  updateDashboardCardsSchema,
  updateFullWidthSchema,
  updateMarketColorConventionSchema,
  updateShowAsOfDateSchema,
  updateThemeAccentColorSchema,
  updateThemeModeSchema,
} from "@/domains/user/user.routes.js";

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
