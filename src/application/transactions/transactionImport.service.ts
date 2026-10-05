import { randomUUID } from "node:crypto";
import { AppError } from "@/domain/appError.js";
import { projectHoldings, type LedgerEntry, type Oversold } from "@/domain/holdingProjection.js";
import { holdingsFromLedger } from "@/application/holdings/holdings.service.js";
import { applyStockDividends } from "@/application/holdings/stockDividendLedger.js";
import { assertValidTransactionInput, toLedgerEntry } from "@/application/transactions/transactions.service.js";
import { listedSymbols, type StockProxyDeps } from "@/application/proxy/stock/stock.service.js";
import type { AppDeps } from "@/application/deps.js";
import type { Holding } from "@/application/holdings/holdings.types.js";
import type { ImportedTransaction, TransactionAction } from "@/application/transactions/transactions.types.js";

export type TransactionImportDeps = Pick<AppDeps, "transactions"> & StockProxyDeps;

/**
 * 允許的來源命名空間。**刻意是白名單而不是自由字串**：`source` 是冪等鍵的一部分，所以一個 typo
 * 會開出一個新的命名空間，然後讓整批重複的交易安靜地寫進去。
 *
 * **一家券商一個 source，不共用**（2026-10-05 由 "broker-csv" 改名，使用者要求）：兩家券商的
 * 「日期｜委託書號」可能相同，共用一個命名空間會把另一家的交易當成重複、靜默略過。改名時資料庫裡
 * 0 筆 broker-csv，所以沒有搬資料、也不並存。每多支援一家券商的格式就在這裡加一個值——web-nuxt
 * 會通知。
 */
const ALLOWED_SOURCES = ["yuanta-csv"] as const;

/**
 * 期初部位用的保留來源。它不在 ALLOWED_SOURCES 裡，所以呼叫端送不進來——期初部位只能由
 * `openingPositions` 產生。這樣它的 `externalRef`（就是代號本身）不會跟券商的委託書號撞到。
 */
const OPENING_SOURCE = "opening";

/** 每批的上限。web-nuxt 量過一份兩年的券商明細是 120 筆，2000 已經是很寬的餘裕。 */
const MAX_ROWS_PER_IMPORT = 2000;

const MS_PER_DAY = 86_400_000;

export interface OpeningPositionInput {
  symbol: string;
  quantity: number;
  averageCost: number;
}

export interface ImportedTransactionInput {
  externalRef: string;
  tradeDate: string;
  symbol: string;
  action: TransactionAction;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  /**
   * 成本不明的取得（使用者 2026-10-05 決定）。前端的用法：匯入後仍然賣超、券商又沒記成本的那一筆，
   * 在**同一天**補一筆 costUnknown 的 BUY，股數＝shortBy。
   */
  costUnknown: boolean;
}

export interface TransactionImportRequest {
  source: string;
  dryRun: boolean;
  openingPositions: OpeningPositionInput[];
  transactions: ImportedTransactionInput[];
}

export interface Shortfall {
  symbol: string;
  tradeDate: string;
  /** 對應到請求裡那一列的 `externalRef`；既有的手動交易造成的賣超是 null。 */
  externalRef: string | null;
  shortBy: number;
}

export interface TransactionImportResult {
  /**
   * dryRun 時、以及整批都是重複列（重匯同一份檔）時是 null——沒有東西被寫進去，就沒有東西可以撤銷。
   */
  importId: string | null;
  inserted: number;
  duplicates: number;
  openingPositions: { symbol: string; status: "created" | "skipped" }[];
  /** 匯入之後的持股明細，形狀與 GET /holdings 完全相同（同一支投影算的）。 */
  holdings: Holding[];
}

/**
 * 賣超不走 AppError：錯誤處理在 production 會把 `details` 整個拿掉（只留 message 與 code），
 * 而前端**必須在正式環境拿到完整清單**才能請使用者補期初部位。所以它是一等公民的回傳值，
 * 由 route 轉成 422。
 */
export type TransactionImportOutcome =
  | { ok: true; result: TransactionImportResult }
  | { ok: false; shortfalls: Shortfall[] };

function assertNoDuplicates(values: string[], label: string): void {
  const seen = new Set<string>();
  const duplicated = values.filter((value) => (seen.has(value) ? true : (seen.add(value), false)));
  if (duplicated.length > 0) {
    throw new AppError(`Duplicate ${label} within the batch: ${[...new Set(duplicated)].slice(0, 10).join(", ")}`, 400);
  }
}

/**
 * **同一批之內的排序規則：交易日升冪 → 買進先於賣出 → 陣列順序。**
 *
 * 中間那一層是這裡唯一真正的決定。web-nuxt 在一份真實的券商匯出檔裡量到「同一天同一檔先賣後買，
 * 但檔案裡排成先買後賣」——也就是**檔案的列序不是成交順序**，所以照陣列順序 replay 會製造出假的
 * 賣超（賣出排在它的買進之前）。買進先於賣出永遠不會，代價是均價可能跟券商自己算的不同。
 * web-nuxt 2026-10-05 傾向這個選擇，我同意：**算錯均價是可以看出來的，假的賣超會把整批擋掉。**
 */
function byImportOrder(a: ImportedTransactionInput, b: ImportedTransactionInput): number {
  if (a.tradeDate !== b.tradeDate) {
    return a.tradeDate.localeCompare(b.tradeDate);
  }
  if (a.action !== b.action) {
    return a.action === "BUY" ? -1 : 1;
  }
  return 0; // Array.sort 是穩定排序，所以同日同動作維持陣列順序。
}

/**
 * 期初部位的交易日：**排在該檔最早一筆交易的前一天**。
 *
 * 要同時看既有的交易與這一批，否則匯入一份比期初更早的檔案時，期初會排到那些交易之後、
 * 把它們全部變成賣超。那個檔沒有任何交易時就用今天——它只是一個部位，日期不影響任何計算。
 */
function openingTradeDate(symbol: string, allDates: Map<string, string>): string {
  const earliest = allDates.get(symbol);
  const base = earliest ? Date.parse(earliest) - MS_PER_DAY : Date.now();
  return new Date(base).toISOString().slice(0, 10);
}

export async function importTransactions(
  firebaseUid: string,
  request: TransactionImportRequest,
  deps: TransactionImportDeps,
): Promise<TransactionImportOutcome> {
  if (!(ALLOWED_SOURCES as readonly string[]).includes(request.source)) {
    throw new AppError(`"source" must be one of: ${ALLOWED_SOURCES.join(", ")}`, 400);
  }
  if (request.transactions.length + request.openingPositions.length > MAX_ROWS_PER_IMPORT) {
    throw new AppError(`An import may carry at most ${MAX_ROWS_PER_IMPORT} rows`, 400);
  }

  assertNoDuplicates(
    request.transactions.map((row) => row.externalRef),
    '"externalRef"',
  );
  assertNoDuplicates(
    request.openingPositions.map((position) => position.symbol),
    'opening position "symbol"',
  );

  for (const row of request.transactions) {
    assertValidTransactionInput(row);
  }
  for (const position of request.openingPositions) {
    // 期初部位就是一筆 BUY，所以走同一套驗證——價格是均價，0 代表真的零成本（配股／增資配發），
    // **不是**「券商不知道成本」。那個區別只有有使用者在場的那一層分得出來，不在這裡。
    assertValidTransactionInput({ ...position, action: "BUY", price: position.averageCost, fee: 0, tax: 0, tradeDate: "2026-01-01" });
  }

  // 代號守衛：整張總表拉一次（3 次上游呼叫），不是每個代號各跑一次 assertSymbolExists。
  const requested = new Set([
    ...request.transactions.map((row) => row.symbol),
    ...request.openingPositions.map((position) => position.symbol),
  ]);
  if (requested.size > 0) {
    const listed = await listedSymbols(deps);
    const unknown = [...requested].filter((symbol) => !listed.has(symbol));
    if (unknown.length > 0) {
      throw new AppError(`Unknown stock symbol(s): ${unknown.slice(0, 10).join(", ")}`, 404);
    }
  }

  const existing = await deps.transactions.list(firebaseUid);
  const [duplicateRefs, existingOpenings] = await Promise.all([
    request.transactions.length > 0
      ? deps.transactions.existingExternalRefs(firebaseUid, request.source, request.transactions.map((row) => row.externalRef))
      : Promise.resolve<string[]>([]),
    request.openingPositions.length > 0
      ? deps.transactions.existingExternalRefs(firebaseUid, OPENING_SOURCE, request.openingPositions.map((p) => p.symbol))
      : Promise.resolve<string[]>([]),
  ]);
  const alreadyImported = new Set(duplicateRefs);
  const alreadyOpened = new Set(existingOpenings);

  // 每個代號最早的交易日，既有的與這一批合起來看——期初部位要排在它前面。
  const earliestBySymbol = new Map<string, string>();
  for (const row of [...existing, ...request.transactions]) {
    const current = earliestBySymbol.get(row.symbol);
    if (!current || row.tradeDate < current) {
      earliestBySymbol.set(row.symbol, row.tradeDate);
    }
  }

  /**
   * 已經有期初部位的代號**跳過、不覆蓋**：匯入永不改既有的列。那一列已經在 existing 裡，所以
   * replay 仍然算得到它。使用者要改期初就直接編輯那一筆交易。
   */
  const openingPositions = request.openingPositions.map((position) => ({
    symbol: position.symbol,
    status: alreadyOpened.has(position.symbol) ? ("skipped" as const) : ("created" as const),
  }));

  const newOpenings: ImportedTransaction[] = request.openingPositions
    .filter((position) => !alreadyOpened.has(position.symbol))
    .map((position) => ({
      symbol: position.symbol,
      action: "BUY" as const,
      quantity: position.quantity,
      price: position.averageCost,
      fee: 0,
      tax: 0,
      tradeDate: openingTradeDate(position.symbol, earliestBySymbol),
      note: null,
      source: OPENING_SOURCE,
      externalRef: position.symbol,
      createdAt: new Date(),
    }));

  const newTrades = request.transactions
    .filter((row) => !alreadyImported.has(row.externalRef))
    .sort(byImportOrder)
    .map((row) => ({
      symbol: row.symbol,
      action: row.action,
      quantity: row.quantity,
      price: row.price,
      fee: row.fee,
      tax: row.tax,
      tradeDate: row.tradeDate,
      note: null,
      source: request.source,
      externalRef: row.externalRef,
      costUnknown: row.costUnknown,
      createdAt: new Date(),
    }));

  /**
   * 逐列指派 `createdAt`，照上面排好的順序。**這不是裝飾**：replay 的同日第二排序鍵就是它，而一次
   * createMany 的所有列會拿到同一個 `now()`——那樣之後每次 GET /holdings 的排序都是未定義的，
   * 同一份資料可能算出不同的均價。期初部位排在最前面（它們的交易日本來就更早，但 createdAt 也
   * 一併排前面，免得同日時又變成未定義）。
   *
   * 基準時間往前推，讓最後一列正好是現在，整批都落在過去。審計欄位上最多 2 秒的人造間距，
   * 換來的是「存下來的資料自己就能重現同一個答案」。
   */
  const ordered = [...newOpenings, ...newTrades];
  const base = Date.now() - (ordered.length - 1);
  ordered.forEach((row, index) => {
    row.createdAt = new Date(base + index);
  });

  const ledger: LedgerEntry[] = [
    ...existing.map(toLedgerEntry),
    ...ordered.map((row) => ({
      symbol: row.symbol,
      action: row.action,
      quantity: row.quantity,
      price: row.price,
      fee: row.fee,
      tax: row.tax,
      tradeDate: row.tradeDate,
      createdAt: row.createdAt.toISOString(),
      ref: row.externalRef,
      // 這一行之前漏過一次（2026-10-05）：這裡是逐欄位對應，少了它 costUnknown 會被悄悄丟掉、當成
      // 價格 0 的買進驗證，而 TypeScript 不會抱怨，因為欄位是選填的。
      ...(row.costUnknown ? { costUnknown: true } : {}),
    })),
  ];

  // 先補自動配股再驗：配來的股數賣出時不能被當成賣超（5314 賣的 12,628 股全是配股）。
  const { entries: withDividends } = await applyStockDividends(ledger, deps);
  const { oversold } = projectHoldings(withDividends);
  if (oversold.length > 0) {
    return { ok: false, shortfalls: oversold.map(toShortfall) };
  }

  // 什麼都沒有要寫（整份檔都是重匯的重複列）時也不發 importId：2026-10-05 實測時重匯回了一個新的 id，
  // 而那個 id 底下 0 筆——拿去撤銷只會 404。發一個不能用的 id 比不發更糟。
  const importId = request.dryRun || ordered.length === 0 ? null : randomUUID();
  if (importId) {
    await deps.transactions.createManyImported(firebaseUid, importId, ordered);
  }

  return {
    ok: true,
    result: {
      importId,
      inserted: newTrades.length,
      duplicates: alreadyImported.size,
      openingPositions,
      holdings: holdingsFromLedger(withDividends),
    },
  };
}

function toShortfall(oversold: Oversold): Shortfall {
  return {
    symbol: oversold.symbol,
    tradeDate: oversold.tradeDate,
    externalRef: oversold.ref ?? null,
    shortBy: oversold.shortBy,
  };
}

/**
 * 整批撤銷。**同樣要驗 replay**：撤掉一批匯入可能讓之後手動輸入的賣出變成賣超，那時候回 422 加
 * 同一個 shortfalls 形狀，而不是默默留下負部位（使用者的解法是先刪掉那幾筆手動交易）。
 */
export async function revertTransactionImport(
  firebaseUid: string,
  importId: string,
  deps: Pick<AppDeps, "transactions" | "stockGateway">,
): Promise<{ ok: true; deleted: number } | { ok: false; shortfalls: Shortfall[] }> {
  const batch = await deps.transactions.listByImportId(firebaseUid, importId);
  if (batch.length === 0) {
    throw new AppError(`Import ${importId} not found`, 404);
  }

  const batchIds = new Set(batch.map((row) => row.id));
  const remaining = (await deps.transactions.list(firebaseUid)).filter((row) => !batchIds.has(row.id));
  const { entries: withDividends } = await applyStockDividends(remaining.map(toLedgerEntry), deps);
  const { oversold } = projectHoldings(withDividends);
  if (oversold.length > 0) {
    return { ok: false, shortfalls: oversold.map(toShortfall) };
  }

  return { ok: true, deleted: await deps.transactions.removeByImportId(firebaseUid, importId) };
}
