import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry } from "@/http/swagger/registry.js";
import { env } from "@/shared/env.js";

// Side-effect imports — each one calls registry.registerPath(...) for its domain's endpoints. All of
// these must run before generateDocument() below, or the registry is incomplete for whatever hasn't
// been imported yet (ESM hoists/runs import statements before any other top-level code in this file,
// so this ordering is guaranteed regardless of what else imports these modules elsewhere — confirmed
// with twse-ts, who hit this exact ordering trap themselves, 2026-09-04).
import "@/http/root.openapi.js";
import "@/http/modules/system/openapi.js";
import "@/http/modules/user/openapi.js";
import "@/http/modules/billing/openapi.js";
import "@/http/modules/stock/openapi.js";
import "@/http/modules/watchlist/openapi.js";
import "@/http/modules/holdings/openapi.js";
import "@/http/modules/transactions/openapi.js";
import "@/http/modules/metricCatalog/openapi.js";
import "@/http/modules/market/openapi.js";
import "@/http/modules/macro/openapi.js";
import "@/http/modules/etfScreener/openapi.js";
import "@/http/modules/industries/openapi.js";
import "@/http/modules/securities/openapi.js";
import "@/http/modules/brokers/openapi.js";
import "@/http/modules/screener/openapi.js";
import "@/http/modules/columnPresets/openapi.js";
import "@/http/modules/screenerPresets/openapi.js";
import "@/http/modules/columnPresetTemplates/openapi.js";
import "@/http/modules/presetTemplates/openapi.js";

function generateDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "業務中台 API（oingg-business-ts）",
      version: "1.0.0",
      description: "業務中台（oingg-business-ts）的 API 合約。Nitro 是唯一呼叫端；錯誤一律是 RFC 9457 problem+json。" +
        "**2026-10-10 起查詢參數改用生態系統一用語**：期別 `basis`／`periodType` → `timeframe`；查某一季的民國 `year`＋字串 `season` → 西元 `fiscalYear`＋整數 `fiscalQuarter`。" +
        "並存期舊名仍收（舊 year 為民國年、會換算），兩者都給以新名為準；web-nuxt 改完就移除舊名。" +
        "**回應欄位也改了名（只改名、值不變）**：*Percent → *Pct（yoyChangePct、changePct、topPct…）、paidInShares → numberOfSharesIssued。" +
        "個股基本資料（批次 2b）：reportDate → generatedDate、industry → sectorCode、industryName → sectorName（上櫃也有值了）、" +
        "listedDate → listingDate、preferredStockShares → numberOfPreferenceShares、financialReportType → declaredDataType（**編碼反過來**，改用 MOPS：\"2\" 合併）；" +
        "類股字典 code／name → sectorCode／sectorName。" +
        "這份文件只列新名；並存期回應裡會同時帶舊名（值與舊時相同，financialReportType 維持交易所編碼），web-nuxt 改完就移除。"
    },
    servers: [
      {
        url: `http://localhost:${env.port}`,
        description: "Development server",
      },
    ],
    tags: [
      { name: "System", description: "伺服器狀態" },
      { name: "User", description: "使用者資料" },
      { name: "Billing", description: "訂閱方案與額度（只鎖查詢廣度／歷史深度／匯出推播，不影響任何個股分析內容）" },
      { name: "Stock", description: "股票資料查詢——股價、本益比、本淨比、殖利率" },
      { name: "Watchlist", description: "使用者自選股清單 CRUD" },
      { name: "Holdings", description: "使用者持股明細（唯讀投影，由交易紀錄算出；2026-10-05 起不再獨立維護）" },
      { name: "Transactions", description: "交易日誌（買進／賣出交易紀錄）CRUD" },
      { name: "Screener", description: "依 metricCatalog 指標篩選個股，並依使用者設定的欄位偏好回傳結果" },
      { name: "Market", description: "市場排行/清單（外資持股、券資比、注意股、處置股、成交量、漲跌幅、ETF 排行等）" },
      { name: "Macro", description: "總體經濟事件序列（央行政策利率調整等）" },
      { name: "ETF Screener", description: "ETF 篩選" },
      { name: "Industries", description: "產業分類樹（財政部稅籍五層分類）" },
      { name: "Securities", description: "統一搜尋索引（普通股＋TWSE 特別股＋全部 ETF）" },
      { name: "Brokers", description: "券商名單（持股頁的券商下拉選單）" },
    ],
  });
}

/**
 * 2026-10-08 起只以 JSON 提供（GET /openapi.json），Swagger UI 頁面拿掉了——使用者不再看它，而合約說明
 * 仍然有人要用（web-nuxt 查欄位語意、日後做 CI diff），跟 analysis-ts 的 GET /openapi.json 同一個慣例。
 */
export const openApiSpec = generateDocument();
