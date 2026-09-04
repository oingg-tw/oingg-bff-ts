import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import swaggerUi from "swagger-ui-express";
import { registry } from "@/adapters/swagger/registry.js";
import { env } from "@/shared/env.js";

// Side-effect imports — each one calls registry.registerPath(...) for its domain's endpoints. All of
// these must run before generateDocument() below, or the registry is incomplete for whatever hasn't
// been imported yet (ESM hoists/runs import statements before any other top-level code in this file,
// so this ordering is guaranteed regardless of what else imports these modules elsewhere — confirmed
// with twse-ts, who hit this exact ordering trap themselves, 2026-09-04).
import "@/root.openapi.js";
import "@/domains/system/system.openapi.js";
import "@/domains/auth/auth.openapi.js";
import "@/domains/user/user.openapi.js";
import "@/domains/stock/stock.openapi.js";
import "@/domains/watchlist/watchlist.openapi.js";
import "@/domains/holdings/holdings.openapi.js";
import "@/domains/transactions/transactions.openapi.js";
import "@/domains/filterCatalog/filterCatalog.openapi.js";
import "@/domains/market/market.openapi.js";
import "@/domains/etfScreener/etfScreener.openapi.js";
import "@/domains/screener/screener.openapi.js";
import "@/domains/screener/columnPresets.openapi.js";
import "@/domains/screener/screenerPresets.openapi.js";
import "@/domains/columnPresetTemplates/columnPresetTemplates.openapi.js";
import "@/domains/presetTemplates/presetTemplates.openapi.js";

function generateDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "oingg-bff-ts API",
      version: "1.0.0",
      description: "BFF API documentation for the oingg-bff-ts service",
    },
    servers: [
      {
        url: `http://localhost:${env.port}`,
        description: "Development server",
      },
    ],
    tags: [
      { name: "System", description: "伺服器狀態" },
      { name: "Auth", description: "Firebase 登入驗證" },
      { name: "User", description: "使用者資料" },
      { name: "Stock", description: "股票資料查詢——股價、本益比、本淨比、殖利率" },
      { name: "Watchlist", description: "使用者自選股清單 CRUD" },
      { name: "Holdings", description: "使用者持股管理 CRUD（獨立維護，不從交易日誌自動計算）" },
      { name: "Transactions", description: "交易日誌（買進／賣出交易紀錄）CRUD" },
      { name: "Screener", description: "依 filterCatalog 指標篩選個股，並依使用者設定的欄位偏好回傳結果" },
      { name: "Market", description: "市場排行/清單（外資持股、券資比、注意股、處置股、成交量、漲跌幅、ETF 排行等）" },
      { name: "ETF Screener", description: "ETF 篩選" },
    ],
  });
}

export const swaggerSpec = generateDocument();
export { swaggerUi };
