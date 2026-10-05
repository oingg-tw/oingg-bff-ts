import type { AppDeps } from "@/application/deps.js";
import { analysisEtfScreenerGateway } from "@/infrastructure/analysisApi/etfScreener/etfScreener.client.js";
import { analysisIndustriesGateway } from "@/infrastructure/analysisApi/industries/industries.client.js";
import { analysisMacroGateway } from "@/infrastructure/analysisApi/macro/macro.client.js";
import { analysisMarketGateway } from "@/infrastructure/analysisApi/market/marketRankings.client.js";
import { analysisMetricCatalogGateway } from "@/infrastructure/analysisApi/metricCatalog/metricCatalog.client.js";
import { analysisScreenerGateway } from "@/infrastructure/analysisApi/screener/analysisScreenerClient.js";
import { analysisSecuritiesGateway } from "@/infrastructure/analysisApi/securities/securities.client.js";
import { analysisBrokersGateway } from "@/infrastructure/analysisApi/brokers/brokers.client.js";
import { analysisStockGateway } from "@/infrastructure/analysisApi/stock/stock.gateway.js";
import { createResendEmailClient } from "@/infrastructure/email/resendEmailClient.js";
import { firebaseTokenVerifier } from "@/infrastructure/firebase/tokenVerifier.js";
import { prismaSystemHealth } from "@/infrastructure/prisma/systemHealth.js";
import { prismaColumnPresets } from "@/infrastructure/prisma/repositories/columnPresets.repository.js";
import { prismaColumnPresetTemplates } from "@/infrastructure/prisma/repositories/columnPresetTemplates.repository.js";
import { prismaMetricCatalog } from "@/infrastructure/prisma/repositories/metricCatalog.repository.js";
import { prismaPresetTemplates } from "@/infrastructure/prisma/repositories/presetTemplates.repository.js";
import { prismaScreenerPresets } from "@/infrastructure/prisma/repositories/screenerPresets.repository.js";
import { prismaSubscriptions } from "@/infrastructure/prisma/repositories/billing.repository.js";
import { prismaTransactions } from "@/infrastructure/prisma/repositories/transactions.repository.js";
import { prismaUser } from "@/infrastructure/prisma/repositories/user.repository.js";
import { prismaUserPreferences } from "@/infrastructure/prisma/repositories/userPreferences.repository.js";
import { prismaWatchlist } from "@/infrastructure/prisma/repositories/watchlist.repository.js";

/**
 * 整個服務的 composition root：全 repo 只有這個檔案（跟測試裡的 fake）知道「哪個 port 由哪個實作滿足」。
 *
 * 這就是依賴反轉真正發生的地方——application 宣告它需要什麼（port），infrastructure 提供怎麼做（實作），
 * 兩邊誰都不 import 誰，靠這裡把它們接起來。要換掉 Prisma、或把某支代理改打別的上游，改動範圍就是這個
 * 檔案的一行。
 *
 * 目前是函式而不是常數：讓測試能產生獨立的一份，也讓未來需要非同步初始化（連線池、快取暖身）時有地方放。
 */
export function createAppDeps(): AppDeps {
  return {
    watchlist: prismaWatchlist,
    transactions: prismaTransactions,
    user: prismaUser,
    userPreferences: prismaUserPreferences,
    screenerPresets: prismaScreenerPresets,
    columnPresets: prismaColumnPresets,
    presetTemplates: prismaPresetTemplates,
    columnPresetTemplates: prismaColumnPresetTemplates,
    subscriptions: prismaSubscriptions,
    metricCatalog: prismaMetricCatalog,
    emailGateway: createResendEmailClient(),
    macroGateway: analysisMacroGateway,
    marketGateway: analysisMarketGateway,
    stockGateway: analysisStockGateway,
    industriesGateway: analysisIndustriesGateway,
    securitiesGateway: analysisSecuritiesGateway,
    brokersGateway: analysisBrokersGateway,
    etfScreenerGateway: analysisEtfScreenerGateway,
    screenerGateway: analysisScreenerGateway,
    metricCatalogGateway: analysisMetricCatalogGateway,
    // 「這個系統用 Firebase 認身分」這件事，現在整個 repo 只有這一行知道。
    tokenVerifier: firebaseTokenVerifier,
    systemHealth: prismaSystemHealth,
  };
}
