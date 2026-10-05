import { AppError } from "@/domain/appError.js";
import { parseFieldRef, toFieldRefString } from "@/shared/fieldRef.js";
import type { AppDeps } from "@/application/deps.js";
import { SPECIAL_COLUMNS } from "@/application/screener/columnField.js";
import type { Pagination } from "@/application/proxy/screener/pagination.js";
import type {
  ScreenerColumnRef,
  ScreenerFilter,
  ScreenerResult,
  ScreenerResultColumn,
  ScreenerResultRow,
  ScreenerSort,
  ScreenerValuesResult,
  ValuationRankingMetric,
} from "@/application/proxy/screener/screener.types.js";

/**
 * Three ports, and the split is the point: `screenerGateway` is the query engine (analysis-ts owns it),
 * `metricCatalog` is bff-ts's own synced copy of the field catalog, only ever read here to attach
 * display names and to fail fast on an unknown field without a round trip. Taken as the LAST argument.
 *
 * `stockGateway` is a third source again: "stock.price" comes from twse/tpex via analysis-ts's batched
 * prices endpoint, not from the screener query. It used to be a direct module call into proxy/stock's
 * barrel; now it is the same port the stock slice's own routes use, so this dependency shows up in the
 * signature like the other two instead of hiding in an import.
 */
export type ScreenerDeps = Pick<AppDeps, "screenerGateway" | "metricCatalog" | "stockGateway">;

const STOCK_PRICE_FIELD = "stock.price";

/**
 * Ranking is a second-order computation over raw market data, not something this BFF should own —
 * oingg-analysis-ts's GET /valuation/ranking already does it (sort, limit, exclude non-positive P/E or
 * P/B), covering both TWSE and TPEx. These three fields go there (see ScreenerGatewayPort's
 * getValuationRanking) instead of the general screener path below — this override is ranking-only.
 *
 * Trigger keys updated 2026-09-08 for analysis-ts's pitMetrics rebuild (old metricCatalog metricKeys
 * per/pbr/dividendYield no longer exist). The new catalog has two distinct metrics per concept — e.g.
 * `exchangePeRatio` (TWSE-computed daily snapshot) vs. `peRatio` (TTM basis, financial-statement-derived)
 * — confirmed live which one actually matches GET /valuation/ranking's own daily TWSE/TPEx
 * `daily_valuation` source (same trade date, e.g. both landing on 2026-09-07) rather than assuming the
 * literal-looking "peRatio"/"pbRatio" names were the right match: `exchangePeRatio`/`exchangePbRatio`, not
 * `peRatio.TTM`/`pbRatio.Q`.
 *
 * Token suffix updated again same day, same rebuild's second pass: analysis-ts split `metric_values.basis`
 * into periodType/lookbackRange/samplingInterval/snapshotCadence (a plain `basis` column overloaded an
 * accounting reserved word), and snapshot-cadence metrics' token changed from "DAILY" to "EOD" —
 * `dividendYield` only has one token (EOD) so there's no ambiguity there.
 */
const VALUATION_RANKING_FIELDS: Record<string, ValuationRankingMetric> = {
  "exchangePeRatio.EOD": "peRatio",
  "exchangePbRatio.EOD": "pbRatio",
  "dividendYield.EOD": "dividendYield",
};

interface ResolvedRef {
  metricKey: string;
  fieldKey: string;
  field: string;
  metricName: string;
  fieldName: string;
  unit: string | null;
}

/**
 * Resolves metricCatalog fields against bff-ts's own synced catalog — used for filters, and for catalog
 * display columns (to attach metricName/fieldName in the response; the actual query now runs on
 * analysis-ts's side, see ScreenerGatewayPort). Looks all of them up in a single batched query rather
 * than one query per field.
 *
 * Used to also check the field against ANALYSIS_METRIC_TABLES and 501 if the metric wasn't wired up to
 * a real analysis-DB table yet — removed 2026-09-01 along with the rest of the direct-DB query building
 * (buildMetricCtes/toSnakeCase/ROC-year conversion, etc.): analysis-ts's POST /screener/GET
 * /screener/ranking now cover the entire /filters catalog by construction, so there's no "not wired up
 * yet" case left on bff-ts's side. An unknown field is still a 400 here (fails fast against the local
 * catalog cache, same message as always, without a round trip to analysis-ts).
 */
async function resolveCatalogFieldRefs(fields: string[], deps: ScreenerDeps): Promise<ResolvedRef[]> {
  const refs = fields.map((field) => ({ field, ...parseFieldRef(field) }));
  const found = await deps.metricCatalog.findFields(refs);
  const foundByKey = new Map(found.map((f) => [toFieldRefString(f.metricKey, f.fieldKey), f]));

  return refs.map((ref) => {
    const lookup = foundByKey.get(toFieldRefString(ref.metricKey, ref.fieldKey));
    if (!lookup) {
      throw new AppError(`Unknown filter field "${ref.field}"`, 400);
    }
    return {
      metricKey: ref.metricKey,
      fieldKey: ref.fieldKey,
      field: ref.field,
      metricName: lookup.metricName,
      fieldName: lookup.fieldName,
      unit: lookup.unit,
    };
  });
}

/**
 * Shared by runScreener/runRanking: merges "stock.price" (twse/tpex, not the analysis DB) into result rows.
 *
 * **這是本切片的第二次上游呼叫，而且是循序的**——screener 查詢跑完才打這一次。兩次各自套用
 * `ANALYSIS_SERVICE_TIMEOUT_MS`（10 秒），所以一個 columns 含 `stock.price` 的請求**最壞可以花到接近
 * 20 秒才失敗**，而回給呼叫端的 502 **不會指出是哪一次逾時的**（兩次都是同一種錯誤）。
 *
 * 2026-10-02 這件事害 web-nuxt 誤診了一整天：他們看到 /screener 間歇 502，以為是某個篩選條件貼著 10 秒
 * 上限。交錯量測之後實測 `stock.price` 只值約 240ms（他們 14 輪／56 次的配對中位差 237~244ms，跟我這邊
 * 的 2×2 吻合），而那些 6~9 秒是三方共用同一台本機上游造成的負載——重載時連 1.8 秒的對照查詢都要 8.18 秒。
 *
 * 所以這段註解要留的是**診斷順序**，不是那個 240ms：看到 /screener 的 502，先問「columns 有沒有
 * `stock.price`」，因為那決定了有幾個 10 秒窗口可能越界；再問「上游當時的負載」，因為負載能把任何一條
 * 查詢乘上四五倍。別從「哪個欄位慢」開始猜。
 */
async function mergeStockPrices(rows: ScreenerResultRow[], wantsStockPrice: boolean, deps: ScreenerDeps): Promise<void> {
  if (!wantsStockPrice) {
    return;
  }
  applyStockPrices(rows, await deps.stockGateway.getLatestClosePrices(rows.map((row) => row.symbol)));
}

function applyStockPrices(
  rows: ScreenerResultRow[],
  pricesBySymbol: Awaited<ReturnType<ScreenerDeps["stockGateway"]["getLatestClosePrices"]>>,
): void {
  for (const row of rows) {
    const price = pricesBySymbol.get(row.symbol);
    // formulaVersion 是 null 而不是某個數字：股價不是型錄裡的公式算出來的，是報價原樣帶進來的，
    // 所以「第幾版公式」對它沒有意義。下游看到 null 就知道不必拿它跟型錄的版本號比。
    row.values[STOCK_PRICE_FIELD] = { value: price?.close ?? null, knowledgeDate: price?.tradeDate ?? null, nullReason: null, formulaVersion: null };
  }
}

/**
 * `sortField` must be "symbol" or one of this request's own display `columns` — never "stock.price"
 * (twse/tpex, not part of analysis-ts's data at all) and never an arbitrary filter-only field the caller
 * didn't also ask to display. analysis-ts sorts the full result set before pagination (not just the
 * returned page), adding `symbol` as an internal tiebreaker for stable pagination when the sort field has
 * duplicate values.
 */
function validateSort(sort: ScreenerSort | undefined, resolvedColumns: ResolvedRef[]): void {
  if (!sort) {
    return;
  }
  if (sort.field !== "symbol" && !resolvedColumns.some((c) => c.field === sort.field)) {
    throw new AppError(
      `"sortField" must be "symbol" or one of this request's own columns — "${sort.field}" isn't in "columns"`,
      400,
    );
  }
}

/**
 * Screens companies by metricCatalog metrics — the actual query (dynamic CTE/JOIN across 30+ metric
 * tables, latest-row-per-symbol, ROC-year quarter labels, null/exclude filter semantics, sorting) now
 * runs on analysis-ts's own POST /screener (see ScreenerGatewayPort and
 * docs/直連DB反模式修復計畫.md for what moved and why). This function's remaining job is: validate/resolve
 * fields against bff-ts's own synced catalog (for metricName/fieldName in the response — analysis-ts's
 * endpoint doesn't echo those back, we already have them locally), split off "stock.price" (twse/tpex,
 * not part of the metricCatalog at all), delegate the rest, then merge stock.price in (company names come
 * back attached directly from analysis-ts as of 2026-09-01, no local merge needed).
 *
 * Requires at least one filter — an empty-filters "list everything" mode isn't supported (bff-ts's own
 * long-standing rule, independent of what analysis-ts's engine can technically do).
 */
export async function runScreener(
  filters: ScreenerFilter[],
  columns: ScreenerColumnRef[],
  pagination: Pagination,
  sort: ScreenerSort | undefined,
  sectorCodes: string[] | undefined,
  excludeSectorCodes: string[] | undefined,
  deps: ScreenerDeps,
): Promise<ScreenerResult> {
  if (filters.length === 0) {
    throw new AppError("At least one filter is required", 400);
  }

  const specialColumns = columns.filter((c) => c.field in SPECIAL_COLUMNS);
  const catalogColumnRefs = columns.filter((c) => !(c.field in SPECIAL_COLUMNS));

  const allRefs = await resolveCatalogFieldRefs(
    [...filters.map((f) => f.field), ...catalogColumnRefs.map((c) => c.field)],
    deps,
  );
  const resolvedColumns = allRefs.slice(filters.length);
  validateSort(sort, resolvedColumns);

  const apiResult = await deps.screenerGateway.runScreener(
    filters,
    resolvedColumns.map((c) => ({ field: c.field })),
    pagination,
    sort,
    sectorCodes,
    excludeSectorCodes,
  );

  const wantsStockPrice = specialColumns.some((c) => c.field === STOCK_PRICE_FIELD);

  const resultColumns: ScreenerResultColumn[] = resolvedColumns.map((c) => ({
    field: c.field,
    metricName: c.metricName,
    fieldName: c.fieldName,
    unit: c.unit,
  }));
  if (wantsStockPrice) {
    resultColumns.push({ field: STOCK_PRICE_FIELD, ...SPECIAL_COLUMNS[STOCK_PRICE_FIELD]! });
  }

  const results: ScreenerResultRow[] = apiResult.results.map((row) => ({
    symbol: row.symbol,
    name: row.name,
    values: row.values,
  }));
  await mergeStockPrices(results, wantsStockPrice, deps);

  return {
    count: apiResult.count,
    page: apiResult.page,
    pageSize: apiResult.pageSize,
    totalPages: apiResult.totalPages,
    columns: resultColumns,
    results,
  };
}

// Matches bff-ts's own screener pageSize cap (see pagination.ts's MAX_PAGE_SIZE) — this endpoint's
// real use case is "the symbols on my current page", which never gets close to either limit.
const MAX_VALUES_SYMBOLS = 200;

/**
 * Fetches just the requested columns for an explicit, already-known list of symbols — used when the
 * frontend adds a new column to an already-loaded/paginated result set, so it doesn't need to re-run the
 * full filtered query (and re-fetch every column it already has) just to pick up one more field. No
 * filters, no pagination: the caller already knows which symbols it wants. Every requested symbol gets a
 * result row (even if analysis-ts has no data for it, with empty `values`) — this never silently drops a
 * row the caller already has on screen.
 */
export async function runScreenerValues(
  symbols: string[],
  columns: ScreenerColumnRef[],
  deps: ScreenerDeps,
): Promise<ScreenerValuesResult> {
  if (symbols.length === 0) {
    throw new AppError("At least one symbol is required", 400);
  }
  if (symbols.length > MAX_VALUES_SYMBOLS) {
    throw new AppError(`At most ${MAX_VALUES_SYMBOLS} symbols are allowed per request`, 400);
  }
  if (columns.length === 0) {
    throw new AppError("At least one column is required", 400);
  }

  const specialColumns = columns.filter((c) => c.field in SPECIAL_COLUMNS);
  const catalogColumnRefs = columns.filter((c) => !(c.field in SPECIAL_COLUMNS));

  const wantsStockPrice = specialColumns.some((c) => c.field === STOCK_PRICE_FIELD);

  /**
   * **股價跟數值查詢並行**，不像 runScreener／runRanking 那樣接在後面：這支端點的代號是呼叫端給的，
   * 不必等查詢結果才知道要抓哪幾檔的股價。2026-10-05 交錯量測（8 輪、10 檔，本機）：循序時 911ms，
   * 股價那一段的配對差是 299ms——幾乎就是上游 getLatestClosePrices 自己的 324ms，等於整段被串在後面。
   * 並行也讓最壞情況回到一個 10 秒窗口（mergeStockPrices 說明裡的「兩個窗口」只剩另外兩支端點適用）。
   * Promise.all 讓任一邊的失敗都會被處理，不會留下一個沒人接的 rejection。
   */
  const [{ resolvedColumns, apiResult }, pricesBySymbol] = await Promise.all([
    (async () => {
      const resolved = await resolveCatalogFieldRefs(
        catalogColumnRefs.map((c) => c.field),
        deps,
      );
      const values = await deps.screenerGateway.getValues(
        symbols,
        resolved.map((c) => ({ field: c.field })),
      );
      return { resolvedColumns: resolved, apiResult: values };
    })(),
    wantsStockPrice ? deps.stockGateway.getLatestClosePrices(symbols) : Promise.resolve(null),
  ]);

  const resultColumns: ScreenerResultColumn[] = resolvedColumns.map((c) => ({
    field: c.field,
    metricName: c.metricName,
    fieldName: c.fieldName,
    unit: c.unit,
  }));
  if (wantsStockPrice) {
    resultColumns.push({ field: STOCK_PRICE_FIELD, ...SPECIAL_COLUMNS[STOCK_PRICE_FIELD]! });
  }

  const rowBySymbol = new Map(apiResult.results.map((row) => [row.symbol, row]));
  const results: ScreenerResultRow[] = symbols.map((symbol) => ({
    symbol,
    name: rowBySymbol.get(symbol)?.name ?? null,
    values: rowBySymbol.get(symbol)?.values ?? {},
  }));
  if (pricesBySymbol) {
    applyStockPrices(results, pricesBySymbol);
  }

  return { count: results.length, columns: resultColumns, results };
}

export interface RankingResult {
  field: string;
  direction: "asc" | "desc";
  columns: ScreenerResultColumn[];
  results: ScreenerResultRow[];
}

/**
 * Top-N ranking by a single metric (e.g. "highest dividend yield", "lowest P/E") — for homepage cards,
 * not the full screener. The ranked field always comes back in each row's values from analysis-ts's
 * GET /screener/ranking (their deliberate asymmetry vs. POST /screener, confirmed with them directly),
 * so unlike runScreener we don't need to explicitly pass it as a column — only the caller's extra
 * display columns (which may include "stock.price") go through as `columns`.
 */
export async function runRanking(
  field: string,
  direction: "asc" | "desc",
  limit: number,
  columns: ScreenerColumnRef[],
  sectorCodes: string[] | undefined,
  excludeSectorCodes: string[] | undefined,
  deps: ScreenerDeps,
): Promise<RankingResult> {
  const valuationMetric = VALUATION_RANKING_FIELDS[field];
  if (valuationMetric) {
    if ((sectorCodes && sectorCodes.length > 0) || (excludeSectorCodes && excludeSectorCodes.length > 0)) {
      const paramName = sectorCodes && sectorCodes.length > 0 ? "sectorCodes" : "excludeSectorCodes";
      throw new AppError(
        `"${paramName}" can't be combined with a "${field}" ranking (sourced from oingg-analysis-ts's ` +
          `ranking endpoint, not the general screener path, which has no sector-filter concept)`,
        400,
      );
    }
    return runValuationRanking(field, valuationMetric, direction, limit, columns, deps);
  }

  const specialColumns = columns.filter((c) => c.field in SPECIAL_COLUMNS);
  const catalogColumnRefs = columns.filter((c) => !(c.field in SPECIAL_COLUMNS) && c.field !== field);

  const allRefs = await resolveCatalogFieldRefs([field, ...catalogColumnRefs.map((c) => c.field)], deps);
  const [rankedRef, ...extraColumnRefs] = allRefs as [ResolvedRef, ...ResolvedRef[]];
  const allColumnRefs = [rankedRef, ...extraColumnRefs];

  const apiResult = await deps.screenerGateway.runRanking(
    field,
    direction,
    limit,
    extraColumnRefs.map((c) => ({ field: c.field })),
    sectorCodes,
    excludeSectorCodes,
  );

  const wantsStockPrice = specialColumns.some((c) => c.field === STOCK_PRICE_FIELD);
  const resultColumns: ScreenerResultColumn[] = allColumnRefs.map((c) => ({
    field: c.field,
    metricName: c.metricName,
    fieldName: c.fieldName,
    unit: c.unit,
  }));
  if (wantsStockPrice) {
    resultColumns.push({ field: STOCK_PRICE_FIELD, ...SPECIAL_COLUMNS[STOCK_PRICE_FIELD]! });
  }

  const results: ScreenerResultRow[] = apiResult.results.map((row) => ({
    symbol: row.symbol,
    name: row.name,
    values: row.values,
  }));
  await mergeStockPrices(results, wantsStockPrice, deps);

  return { field, direction, columns: resultColumns, results };
}

/**
 * The oingg-analysis-ts-backed ranking path for per.peRatio/pbr.pbRatio/dividendYield.dividendYieldPct —
 * see VALUATION_RANKING_FIELDS. Only "stock.price" can be combined with it as an extra column: any other
 * field would need a join this path deliberately doesn't do (that's what the general ranking path above,
 * or the full /screener endpoint, is for).
 */
async function runValuationRanking(
  field: string,
  metric: ValuationRankingMetric,
  direction: "asc" | "desc",
  limit: number,
  columns: ScreenerColumnRef[],
  deps: ScreenerDeps,
): Promise<RankingResult> {
  const unsupportedColumn = columns.find((c) => c.field !== STOCK_PRICE_FIELD);
  if (unsupportedColumn) {
    throw new AppError(
      `"${unsupportedColumn.field}" can't be combined with a "${field}" ranking (sourced from ` +
        `oingg-analysis-ts's ranking endpoint, not the general screener path) — only "stock.price" ` +
        `is supported alongside it`,
      400,
    );
  }

  const [rankedRef] = await resolveCatalogFieldRefs([field], deps);
  const { tradeDate, rankings } = await deps.screenerGateway.getValuationRanking(metric, direction, limit);
  const wantsStockPrice = columns.some((c) => c.field === STOCK_PRICE_FIELD);

  const results: ScreenerResultRow[] = rankings.map((row) => ({
    symbol: row.symbol,
    name: row.name,
    // 同 mergeStockPrices：這條路徑的值來自 analysis-ts 的估值排行端點而不是 screener，那支端點沒有
    // 帶版本號，所以這裡也給 null——不是漏接，是「無法得知」，而 null 正好是那個意思。
    values: { [field]: { value: String(row.value), knowledgeDate: tradeDate, nullReason: null, formulaVersion: null } },
  }));
  await mergeStockPrices(results, wantsStockPrice, deps);

  const resultColumns: ScreenerResultColumn[] = [
    { field, metricName: rankedRef!.metricName, fieldName: rankedRef!.fieldName, unit: rankedRef!.unit },
  ];
  if (wantsStockPrice) {
    resultColumns.push({ field: STOCK_PRICE_FIELD, ...SPECIAL_COLUMNS[STOCK_PRICE_FIELD]! });
  }

  return { field, direction, columns: resultColumns, results };
}

/*
 * GET /screener/company-rank and GET /screener/distribution used to have a runCompanyRank/runDistribution
 * wrapper here. Both were `runX(args) => fetchX(args)` with nothing else in them: neither response has a
 * display column (metricName/fieldName), so there's nothing to resolve against the local catalog, and
 * field/bins validation is delegated to analysis-ts itself — unlike runScreener/runRanking above. The
 * route now calls ScreenerGatewayPort's getCompanyRank/getDistribution directly (their semantics, and why
 * company-rank isn't routed through the valuation-ranking override, are documented on that port).
 */
