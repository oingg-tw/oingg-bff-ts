import { AppError } from "@/domain/appError.js";
import {
  assertAnalysisServiceOk,
  buildAnalysisServiceUrl,
  fetchAnalysisService,
  renamedField,
  requireNumber,
  toNumberOrNull,
  toStringOrNull,
} from "@/infrastructure/analysisApi/analysisServiceClient.js";
import { logger } from "@/shared/logger.js";
import type {
  SecuritiesSector,
  SecuritiesSectorList,
  SectorDividendSummary,
  SectorDividendSummaryRow,
  SectorMetricStats,
  SectorFieldStats,
  SectorMetricHistory,
  SectorMonthlyRevenueHistory,
  SectorSummary,
} from "@/application/proxy/industries/industries.types.js";
import type { IndustriesGatewayPort } from "@/application/ports/industriesGateway.js";

/**
 * code／name 是並存期舊名（2026-10-10 起，跟著 analysis-ts 批次 2b，上游 2026-10-24 移除）：讀新名優先，回應裡把
 * 舊名補回去給 web-nuxt。web-nuxt 改完就刪掉回傳的 code／name；上游舊名移除後把 renamedField 換回直接讀新名。
 */
function normalizeSector(raw: unknown): SecuritiesSector & { code: string; name: string } {
  const r = raw as Record<string, unknown>;
  const sectorCode = String(renamedField(r, "sectorCode", "code"));
  const sectorName = String(renamedField(r, "sectorName", "name"));
  return { sectorCode, sectorName, companyCount: Number(r.companyCount), code: sectorCode, name: sectorName };
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

// mean/median 可以是 null（count 為 0 時），所以逐欄位走共用的 toNumberOrNull，不用 Number()（會把 null 變 0）。

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
  getSectorMetricHistory: fetchSectorMetricHistory,
  getSectorMonthlyRevenueHistory: fetchSectorMonthlyRevenueHistory,
  getSectorSummary: fetchSectorSummary,
};

// ---------------------------------------------------------------------------
// 類股分布三支（analysis-ts ae14be5e，2026-10-09）。逐欄位正規化：必填走 requireNumber／requireString（缺了 502 指名），
// 可為 null 的保留 null（不用 Number()／String()）。
// ---------------------------------------------------------------------------

function requireString(value: unknown, field: string, label: string): string {
  if (typeof value !== "string") {
    throw new AppError(`${label} response is missing the field ${field}`, 502);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * 類股代碼查無上市櫃公司：上游回 404 ＋ `code: unknown_sector`（analysis-ts cb33e1d4，2026-10-10 應我們要求加的）。
 * 這是呼叫端的錯，原樣回 404 並轉出同一個 code 與 detail，不變成 502。
 *
 * **只認這個 code**：上游其他的 404（路由不存在，例如他們的部署版本落後、這支端點還沒上）不是「類股不存在」，
 * 交給 assertAnalysisServiceOk 當成上游故障回 502——否則前端會把「上游沒部署」讀成「你給的代碼錯了」。
 * 在 cb33e1d4 之前上游沒有 code，只能靠 detail 區分，那是規範說不要解析的欄位。
 */
async function relayUnknownSector(response: Response): Promise<void> {
  if (response.status !== 404) {
    return;
  }
  const body = asRecord(await response.json().catch(() => null)); // 不是 unknown_sector 時下游只看 status、不再讀 body，所以不必 clone
  if (body.code !== "unknown_sector") {
    return;
  }
  const detail = typeof body.detail === "string" && body.detail ? body.detail : "Unknown sector";
  throw new AppError(detail, 404, undefined, "unknown_sector");
}

function normalizeSectorMetricHistory(body: unknown): SectorMetricHistory & { basis: string } {
  const b = asRecord(body);
  const label = "Sector metric history";
  if (!Array.isArray(b.entries)) {
    throw new AppError(`${label} response is missing an entries array`, 502);
  }
  return {
    sectorCode: requireString(b.sectorCode, "sectorCode", label),
    sectorName: requireString(b.sectorName, "sectorName", label),
    metricCode: requireString(b.metricCode, "metricCode", label),
    timeframe: requireString(b.timeframe, "timeframe", label),
    // 並存期舊名（2026-10-10 起改叫 timeframe），web-nuxt 改完就刪。
    basis: requireString(b.timeframe, "timeframe", label),
    entries: b.entries.map((raw) => {
      const e = asRecord(raw);
      return {
        fiscalYear: requireNumber(e.fiscalYear, "entries[].fiscalYear", label),
        fiscalQuarter: toNumberOrNull(e.fiscalQuarter),
        count: requireNumber(e.count, "entries[].count", label),
        median: toNumberOrNull(e.median),
        q1: toNumberOrNull(e.q1),
        q3: toNumberOrNull(e.q3),
        nullReason: toStringOrNull(e.nullReason),
      };
    }),
  };
}

export async function fetchSectorMetricHistory(sectorCode: string, metricCode: string, basis: string, limit?: number): Promise<SectorMetricHistory & { basis: string }> {
  const params: Record<string, string> = { metricCode, timeframe: basis };
  if (limit !== undefined) {
    params.limit = String(limit);
  }
  const url = buildAnalysisServiceUrl(`/industries/${encodeURIComponent(sectorCode)}/metric-history`, params);
  const response = await fetchAnalysisService(url);
  await relayUnknownSector(response);
  await assertAnalysisServiceOk(response, url, "Sector metric history endpoint");
  return normalizeSectorMetricHistory(await response.json());
}

export async function fetchSectorMonthlyRevenueHistory(sectorCode: string, limit?: number): Promise<SectorMonthlyRevenueHistory> {
  const label = "Sector monthly revenue history";
  const url = buildAnalysisServiceUrl(
    `/industries/${encodeURIComponent(sectorCode)}/monthly-revenue-history`,
    limit === undefined ? undefined : { limit: String(limit) },
  );
  const response = await fetchAnalysisService(url);
  await relayUnknownSector(response);
  await assertAnalysisServiceOk(response, url, `${label} endpoint`);
  const b = asRecord(await response.json());
  if (!Array.isArray(b.entries)) {
    throw new AppError(`${label} response is missing an entries array`, 502);
  }
  return {
    sectorCode: requireString(b.sectorCode, "sectorCode", label),
    sectorName: requireString(b.sectorName, "sectorName", label),
    total: requireNumber(b.total, "total", label),
    hasMore: b.hasMore === true,
    entries: b.entries.map((raw) => {
      const e = asRecord(raw);
      // 上游欄名再改時，這裡會讀到 undefined→null 而不報錯——2026-10-10 就發生過一次（40058581 改名沒有並存期，
      // 三欄悄悄變 null）。所以改名一律先看上游實際回應再跟。
      return {
        yearMonth: requireString(e.yearMonth, "entries[].yearMonth", label),
        currentMonthRevenue: toStringOrNull(e.currentMonthRevenue),
        lastYearSameMonthRevenue: toStringOrNull(e.lastYearSameMonthRevenue),
        yoyChangePct: toNumberOrNull(e.yoyChangePct),
        companyCount: requireNumber(e.companyCount, "entries[].companyCount", label),
      };
    }),
  };
}

export async function fetchSectorSummary(fields: string): Promise<SectorSummary> {
  const label = "Sector summary";
  const url = buildAnalysisServiceUrl("/industries/sector-summary", { fields });
  const response = await fetchAnalysisService(url);
  await assertAnalysisServiceOk(response, url, `${label} endpoint`);
  const b = asRecord(await response.json());
  if (!Array.isArray(b.sectors)) {
    throw new AppError(`${label} response is missing a sectors array`, 502);
  }
  return {
    sectors: b.sectors.map((raw) => {
      const r = asRecord(raw);
      const fieldsOut: Record<string, SectorFieldStats> = {};
      for (const [field, stats] of Object.entries(asRecord(r.fields))) {
        const s = asRecord(stats);
        fieldsOut[field] = {
          count: requireNumber(s.count, `sectors[].fields.${field}.count`, label),
          median: toNumberOrNull(s.median),
          q1: toNumberOrNull(s.q1),
          q3: toNumberOrNull(s.q3),
        };
      }
      return {
        sectorCode: requireString(r.sectorCode, "sectors[].sectorCode", label),
        sectorName: requireString(r.sectorName, "sectors[].sectorName", label),
        companyCount: requireNumber(r.companyCount, "sectors[].companyCount", label),
        fields: fieldsOut,
      };
    }),
  };
}

