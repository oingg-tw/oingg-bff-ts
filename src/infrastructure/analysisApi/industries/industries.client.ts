import { AppError } from "@/domain/appError.js";
import { assertAnalysisServiceOk, buildAnalysisServiceUrl, fetchAnalysisService } from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type {
  SecuritiesSector,
  SecuritiesSectorList,
  SectorDividendSummary,
  SectorDividendSummaryRow,
  SectorMetricStats,
} from "@/application/proxy/industries/industries.types.js";
import type { IndustriesGatewayPort } from "@/application/ports/industriesGateway.js";

function normalizeSector(raw: unknown): SecuritiesSector {
  const r = raw as Record<string, unknown>;
  return { code: String(r.code), name: String(r.name), companyCount: Number(r.companyCount) };
}

/**
 * Fetches TWSE/TPEx's own securities-sector classification (證交所類股, e.g. "24" = 半導體業) from
 * analysis-ts's GET /industries/securities-sectors — a separate scheme from the gov-ts tax-registration
 * tree above, used to power the screener's sectorCodes filter.
 */
export async function fetchSecuritiesSectors(): Promise<SecuritiesSectorList> {
  const url = buildAnalysisServiceUrl("/industries/securities-sectors");
  const response = await fetchAnalysisService(url);
  await assertAnalysisServiceOk(response, url, "Securities sectors endpoint");

  const body: unknown = await response.json();
  const sectors = (body as { sectors?: unknown } | null)?.sectors;
  if (!Array.isArray(sectors)) {
    logger.error({ url: url.toString() }, "Securities sectors endpoint response is missing a sectors array");
    throw new AppError("Securities sectors endpoint response is missing a sectors array", 502);
  }

  return { sectors: sectors.map(normalizeSector) };
}

/**
 * `Number()` 會把 null 變 0，而這裡的 mean/median 本來就可以是 null（count 為 0 時），所以逐欄位都要走這支。
 * 見 dailyPriceHistory.client.ts 的說明：那次 `Number(null)` 把沒有交易的日子變成收盤價 0。
 */
function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * `count` 缺席時給 0 而不是丟 502：它是用來判斷 mean/median 可不可信的欄位，缺了就當成「沒有樣本」，
 * 那是安全的方向——下游的最小 n 門檻會把它擋掉。反過來猜一個家數才會讓人以為那個平均有代表性。
 */
function normalizeMetricStats(raw: unknown): SectorMetricStats {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    count: typeof r.count === "number" && Number.isFinite(r.count) ? r.count : 0,
    mean: toNumberOrNull(r.mean),
    median: toNumberOrNull(r.median),
  };
}

function normalizeSectorDividendRow(raw: unknown): SectorDividendSummaryRow {
  const r = raw as Record<string, unknown>;
  return {
    sectorCode: String(r.sectorCode),
    sectorName: String(r.sectorName),
    companyCount: typeof r.companyCount === "number" && Number.isFinite(r.companyCount) ? r.companyCount : 0,
    dividendYield: normalizeMetricStats(r.dividendYield),
    dividendGrowthRate3y: normalizeMetricStats(r.dividendGrowthRate3y),
  };
}

/**
 * analysis-ts's GET /industries/sector-dividend-summary (added 2026-09-30, commit 5530a14a) — per-sector
 * dividend-yield and 3-year dividend-growth statistics for a sector scatter plot. No parameters.
 *
 * Measured on arrival (34 sectors, 2026-09-30): the two axes have **different** counts per sector, so a
 * point's x and y are means over different sub-populations — 綠能環保 has yield n=38 and growth n=5 out of
 * 46 companies, 油電燃氣業 growth n=2. That is why `count` is normalized per axis and never dropped: it is
 * the only thing telling a consumer how much of the sector a point represents. See the types file for the
 * full caveats handed to web-nuxt.
 */
export async function fetchSectorDividendSummary(): Promise<SectorDividendSummary> {
  const url = buildAnalysisServiceUrl("/industries/sector-dividend-summary");
  const response = await fetchAnalysisService(url);
  await assertAnalysisServiceOk(response, url, "Sector dividend summary endpoint");

  const body: unknown = await response.json();
  const sectors = (body as { sectors?: unknown } | null)?.sectors;
  if (!Array.isArray(sectors)) {
    logger.error({ url: url.toString() }, "Sector dividend summary endpoint response is missing a sectors array");
    throw new AppError("Sector dividend summary endpoint response is missing a sectors array", 502);
  }

  const tradeDate = (body as { dividendYieldTradeDate?: unknown }).dividendYieldTradeDate;
  return {
    dividendYieldTradeDate: typeof tradeDate === "string" ? tradeDate : null,
    sectors: sectors.map(normalizeSectorDividendRow),
  };
}

/**
 * IndustriesGatewayPort 的實作。上面的 fetchX 函式已經做完正規化與 502 判定，所以這裡只是把它們對應到
 * port 的方法名。
 *
 * 重構前中間還隔著一支 industries.service.ts，但那支檔案每個函式都是 `getX(a) => fetchX(a)`，沒有任何
 * 驗證或編排。
 * 代理切片只要是純轉發，就不該為了湊滿分層而留一層空殼——跟 macro 切片同樣的判斷。
 */
export const analysisIndustriesGateway: IndustriesGatewayPort = {
  getSecuritiesSectors: fetchSecuritiesSectors,
  getSectorDividendSummary: fetchSectorDividendSummary,
};

