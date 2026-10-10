import { passThroughEnum } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type { Market } from "@/application/proxy/market/market.types.js";

/**
 * 市場別改成 MOPS 的 TYPEK（analysis-ts 6d420ef8，2026-10-10）：'sii' 上市、'otc' 上櫃、'rotc' 興櫃——興櫃不再是
 * 「TPEx＋isEmerging」。上游分兩步，而且**同一個 key 會換編碼**：
 *   - 步驟一（現在）：新增 marketCode；舊的 market（"TWSE"／"TPEx"）、isEmerging、特別股的 marketType 照舊。
 *   - 步驟二（2026-10-24）：market 本身改成 TYPEK，isEmerging 與 marketType 移除；marketCode 並存到 2026-11-07。
 * 所以這裡**看值認編碼，不看日期**：上游在哪一步、本機或部署的版本落後，讀到的都對。
 *
 * 對 web-nuxt 目前維持舊的 market／isEmerging（值跟以前一樣），另外加 marketCode。業務中台自己的 market 改成
 * TYPEK 是下一步，跟 web-nuxt 約好再做（同上游，新 key 先上、舊 key 並存）。
 *
 * 2026-10-24 前不接這裡會靜靜出錯的兩處：公司清單的 `isEmerging === true` 會全部變成 false（364 家興櫃被放回
 * 覆蓋率分母），特別股的 `String(marketType)` 會變成字串 "undefined"。
 */
const TYPEK = ["sii", "otc", "rotc"] as const;

/** 特別股的舊欄位是中文。 */
const MARKET_TYPE_BY_TYPEK: Readonly<Record<string, string>> = { sii: "上市", otc: "上櫃", rotc: "興櫃" };

export interface MarketFields {
  /** TYPEK；上游舊編碼分不出上櫃／興櫃（排行列沒有 isEmerging）或缺欄位時是 null。未知的新值照樣放行。 */
  marketCode: string | null;
  /** 舊的對外編碼 "TWSE"／"TPEx"，並存期給 web-nuxt。 */
  market: Market;
  isEmerging: boolean | null;
}

export function readMarketFields(raw: Record<string, unknown>, symbol?: unknown): MarketFields {
  const marketCode = readTypek(raw, symbol);
  const isEmerging =
    marketCode === "rotc" ? true : marketCode === "sii" || marketCode === "otc" ? false : typeof raw.isEmerging === "boolean" ? raw.isEmerging : null;
  return { marketCode, market: legacyMarket(raw, marketCode, symbol), isEmerging };
}

function readTypek(raw: Record<string, unknown>, symbol: unknown): string | null {
  if (typeof raw.marketCode === "string") {
    return passThroughEnum(raw.marketCode, TYPEK, { field: "marketCode", symbol });
  }
  // 上游舊編碼（步驟一還沒部署到的上游）
  if (raw.market === "TWSE") {
    return "sii";
  }
  if (raw.market === "TPEx") {
    return raw.isEmerging === true ? "rotc" : raw.isEmerging === false ? "otc" : null;
  }
  // 2026-11-07 之後 marketCode 消失、market 就是 TYPEK
  return passThroughEnum(raw.market, TYPEK, { field: "market", symbol });
}

function legacyMarket(raw: Record<string, unknown>, marketCode: string | null, symbol: unknown): Market {
  if (marketCode === "sii") {
    return "TWSE";
  }
  if (marketCode === "otc" || marketCode === "rotc") {
    return "TPEx";
  }
  if (marketCode !== null) {
    return marketCode; // 未知的新值照樣放行（passThroughEnum 已記 warn），不改寫成 TWSE
  }
  if (raw.market === "TPEx") {
    return "TPEx"; // 舊編碼的排行列：知道是 TPEx、分不出上櫃或興櫃
  }
  logger.warn({ symbol, market: raw.market, marketCode: raw.marketCode }, "Row is missing its market — defaulting to TWSE");
  return "TWSE";
}

/** 特別股：上游給 marketCode（新）或中文 marketType（舊，2026-10-24 移除）。 */
export function readPreferredMarketFields(raw: Record<string, unknown>): { marketCode: string | null; marketType: string | null } {
  const legacyType = typeof raw.marketType === "string" ? raw.marketType : null;
  const marketCode =
    typeof raw.marketCode === "string"
      ? raw.marketCode
      : (Object.keys(MARKET_TYPE_BY_TYPEK).find((code) => MARKET_TYPE_BY_TYPEK[code] === legacyType) ?? null);
  return { marketCode, marketType: legacyType ?? (marketCode === null ? null : (MARKET_TYPE_BY_TYPEK[marketCode] ?? null)) };
}
