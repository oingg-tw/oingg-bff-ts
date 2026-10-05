import { AppError } from "@/domain/appError.js";
import { projectHoldings, type LedgerEntry } from "@/domain/holdingProjection.js";
import type { AppDeps } from "@/application/deps.js";
import type {
  StockTransaction,
  TransactionAction,
  TransactionInput,
  TransactionUpdate,
} from "@/application/transactions/transactions.types.js";

export type TransactionsDeps = Pick<AppDeps, "transactions">;

const TRADE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertValidAction(action: unknown): asserts action is TransactionAction {
  if (action !== "BUY" && action !== "SELL") {
    throw new AppError('"action" must be "BUY" or "SELL"', 400);
  }
}

/** 上界對齊資料庫欄位——理由與 holdings.service.ts 的同名常數相同（缺上界時溢出會變 500 而非 400）。 */
const MAX_INT32 = 2_147_483_647;
/**
 * `Decimal(18,4)` 的真正上限是 99999999999999.9999，但那個字面值在 double 裡**不可精確表示**
 * （14 位整數加 4 位小數超過 53 bit 尾數，oxlint 的 no-loss-of-precision 抓到的就是這個）。
 * 所以改用可精確表示的 1e14 當**開區間**上界：小於 1e14 的值整數部分一定在 14 位內，必然放得下。
 * 代價是多擋掉 [99999999999999.9999, 1e14) 這個寬度 0.0001 的縫，那個範圍沒有真實用途。
 */
const DECIMAL_18_4_EXCLUSIVE_MAX = 1e14;

function assertValidQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_INT32) {
    throw new AppError(`"quantity" must be a positive integer no greater than ${MAX_INT32}`, 400);
  }
}

function assertValidAmount(value: number, field: string, { allowZero }: { allowZero: boolean }): void {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0) || value >= DECIMAL_18_4_EXCLUSIVE_MAX) {
    throw new AppError(`"${field}" must be a ${allowZero ? "non-negative" : "positive"} number within the column precision`, 400);
  }
}

function assertValidTradeDate(tradeDate: string): void {
  if (!TRADE_DATE_PATTERN.test(tradeDate) || Number.isNaN(Date.parse(tradeDate))) {
    throw new AppError('"tradeDate" must be a valid date in "YYYY-MM-DD" format', 400);
  }
}

/**
 * 交易紀錄 DTO → domain 的 replay 輸入。字串轉數字只發生在這裡，持股投影（holdings.service.ts）
 * 也用這一支，所以兩邊讀出來的一定是同一組數字。
 *
 * 這幾個欄位在資料庫都是 NOT NULL（price/fee/tax 有 default 0），所以 `Number()` 在這裡是安全的。
 * 它對 null 會回 0 而不是 NaN，**不要**把這個模式搬去處理上游可能缺欄位的回應。
 */
export function toLedgerEntry(row: StockTransaction): LedgerEntry {
  return {
    symbol: row.symbol,
    action: row.action,
    quantity: row.quantity,
    price: Number(row.price),
    fee: Number(row.fee),
    tax: Number(row.tax),
    tradeDate: row.tradeDate,
    createdAt: row.createdAt,
  };
}

/**
 * **寫入時驗證的是「整段 replay 還成不成立」，不是「這一筆合不合法」。**
 *
 * 持股是交易的投影（2026-10-05）之後這是必然的：改掉一筆過去的買進、或刪掉它，都可能讓**之後**某一筆
 * 賣出變成賣超。所以每個寫入路徑都要先把這個代號現有的交易取出來、套上候選變更、整段重跑一次。
 * 只檢查當下那一筆的話，使用者可以用「先新增賣出、再刪掉買進」繞出一個負部位。
 *
 * 賣超回 400 而不是 409：錯在呼叫端送了一筆手上股數不夠的賣出。訊息帶上那個時點的股數，
 * 否則前端只能說「不行」卻說不出為什麼。
 *
 * ponytail: 讀出來驗證再寫入，中間沒有鎖——同一使用者同一代號的併發寫入可能各自通過檢查、合起來賣超。
 * 單人投資組合的視窗極小，而且投影在賣超時會把那一筆夾成「全賣」而不是壞掉（見 projectHoldings）。
 * 真的要擋就把驗證與寫入包進一個 serializable transaction，那需要 port 多一個方法。
 */
function assertReplayStaysValid(entries: readonly LedgerEntry[]): void {
  // 單筆寫入只需要第一筆賣超：訊息是給人看的，列出全部沒有幫助。批次匯入走的是 422 加完整清單。
  const [oversold] = projectHoldings(entries).oversold;
  if (oversold) {
    // `code` 是刻意加的，而且是這個回應裡唯一穩定的部分：web-nuxt 2026-10-05 說他們用正則從下面那句
    // 英文抽數字再翻成中文。訊息的措辭是給人看的、會變；要分辨「這是賣超」請判斷 code。
    // 數字目前只在訊息裡（AppError 的 details 在 production 會被整個拿掉），要結構化的話整條路徑
    // 就跟匯入一樣改成 422 加 shortfalls——他們要就換，不要為了「以後可能要」先長出來。
    throw new AppError(
      `Selling ${oversold.attempted} shares of "${oversold.symbol}" on ${oversold.tradeDate} would exceed the ${oversold.held} you hold at that point`,
      400,
      undefined,
      "LEDGER_OVERSOLD",
    );
  }
}

/**
 * 一筆交易的欄位驗證。`addTransaction` 與批次匯入共用——匯入時少驗一項，整批就會帶著壞資料進資料庫，
 * 而 replay 之後每次讀取都會重現那個錯誤。
 *
 * `price` 允許 0（配股／分割記成價格 0 的買進，web-nuxt 2026-10-05 提的表達方式，比加一個新的 action
 * 列舉值便宜——replay 不需要知道股數是買來的還是配來的）。**負數仍然擋。**
 */
export function assertValidTransactionInput(
  input: Pick<TransactionInput, "action" | "quantity" | "price" | "fee" | "tax" | "tradeDate">,
): void {
  assertValidAction(input.action);
  assertValidQuantity(input.quantity);
  assertValidAmount(input.price, "price", { allowZero: true });
  assertValidAmount(input.fee, "fee", { allowZero: true });
  assertValidAmount(input.tax, "tax", { allowZero: true });
  assertValidTradeDate(input.tradeDate);
}

export async function getTransactions(
  firebaseUid: string,
  symbol: string | undefined,
  deps: TransactionsDeps,
): Promise<StockTransaction[]> {
  return deps.transactions.list(firebaseUid, symbol);
}

export async function getTransactionOrThrow(
  firebaseUid: string,
  id: string,
  deps: TransactionsDeps,
): Promise<StockTransaction> {
  const transaction = await deps.transactions.find(firebaseUid, id);
  if (!transaction) {
    throw new AppError(`Transaction ${id} not found`, 404);
  }
  return transaction;
}

/**
 * Symbol existence is validated by the caller (transactions.routes.ts, via bff-ts's
 * stock.assertSymbolExists) before this is invoked — this domain's own service has no reason to reach
 * across into the stock pass-through's live quote data itself.
 *
 * `price` 允許 0：配股／股票分割記成「價格 0 的買進」，這是 web-nuxt 2026-10-05 提的表達方式，比加一個
 * 新的 action 列舉值便宜——replay 不需要知道股數是買來的還是配來的，成本 0、股數增加就是對的。
 */
export async function addTransaction(
  firebaseUid: string,
  input: TransactionInput,
  deps: TransactionsDeps,
): Promise<StockTransaction> {
  assertValidTransactionInput(input);

  const existing = await deps.transactions.list(firebaseUid, input.symbol);
  // 候選交易的 createdAt 取「現在」：它是同日最後寫入的那一筆，跟落地之後的排序一致。
  assertReplayStaysValid([...existing.map(toLedgerEntry), { ...input, createdAt: new Date().toISOString() }]);

  return deps.transactions.create(firebaseUid, input);
}

export async function editTransaction(
  firebaseUid: string,
  id: string,
  update: TransactionUpdate,
  deps: TransactionsDeps,
): Promise<StockTransaction> {
  if (update.action !== undefined) {
    assertValidAction(update.action);
  }
  if (update.quantity !== undefined) {
    assertValidQuantity(update.quantity);
  }
  if (update.price !== undefined) {
    assertValidAmount(update.price, "price", { allowZero: true });
  }
  if (update.fee !== undefined) {
    assertValidAmount(update.fee, "fee", { allowZero: true });
  }
  if (update.tax !== undefined) {
    assertValidAmount(update.tax, "tax", { allowZero: true });
  }
  if (update.tradeDate !== undefined) {
    assertValidTradeDate(update.tradeDate);
  }

  // find 先行是為了拿到 symbol（只有它知道要重跑哪個代號）。找不到就是 404，跟改之前一樣。
  const existing = await deps.transactions.find(firebaseUid, id);
  if (!existing) {
    throw new AppError(`Transaction ${id} not found`, 404);
  }
  const siblings = await deps.transactions.list(firebaseUid, existing.symbol);
  const edited: LedgerEntry = { ...toLedgerEntry(existing), ...update };
  assertReplayStaysValid([...siblings.filter((row) => row.id !== id).map(toLedgerEntry), edited]);

  const transaction = await deps.transactions.update(firebaseUid, id, update);
  if (!transaction) {
    throw new AppError(`Transaction ${id} not found`, 404);
  }
  return transaction;
}

/**
 * 清空這個使用者的整本帳（使用者 2026-10-05 要求的「一個按鈕清除所有持股明細」）。
 *
 * 不需要驗 replay：空的帳本永遠合法。單一 deleteMany 本身就是原子的，所以不會只清掉一部分——
 * 這正是它取代前端「逐檔送 DELETE /holdings/:symbol」的理由（那樣 50 檔是 50 個請求，中途失敗就
 * 只清一半）。沒有任何交易時回 0 而不是 404，讓清空是冪等的。
 */
export async function removeAllTransactions(firebaseUid: string, deps: TransactionsDeps): Promise<number> {
  return deps.transactions.removeAll(firebaseUid);
}

export async function removeTransaction(firebaseUid: string, id: string, deps: TransactionsDeps): Promise<void> {
  // 刪一筆買進同樣可能讓之後的賣出變成賣超，所以 DELETE 也要驗整段 replay。
  const existing = await deps.transactions.find(firebaseUid, id);
  if (!existing) {
    throw new AppError(`Transaction ${id} not found`, 404);
  }
  const siblings = await deps.transactions.list(firebaseUid, existing.symbol);
  assertReplayStaysValid(siblings.filter((row) => row.id !== id).map(toLedgerEntry));

  const deleted = await deps.transactions.remove(firebaseUid, id);
  if (!deleted) {
    throw new AppError(`Transaction ${id} not found`, 404);
  }
}
