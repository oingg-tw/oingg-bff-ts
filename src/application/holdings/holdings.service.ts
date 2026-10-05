import { AppError } from "@/domain/appError.js";
import { projectHoldings, type LedgerEntry, type ProjectedHolding } from "@/domain/holdingProjection.js";
import { toLedgerEntry } from "@/application/transactions/transactions.service.js";
import { applyStockDividends } from "@/application/holdings/stockDividendLedger.js";
import type { AppDeps } from "@/application/deps.js";
import type { Holding, RealizedProfitLossReport } from "@/application/holdings/holdings.types.js";

/**
 * **這個切片不再有自己的 port。** 持股是交易紀錄的投影（2026-10-05），所以它要的依賴就是
 * `transactions`——`HoldingsPort` 與 prismaHoldings 連同那張表的讀寫一起刪掉了。
 */
export type HoldingsDeps = Pick<AppDeps, "transactions" | "stockGateway">;

/** 對齊 `Decimal(18,4)`：交易紀錄存 4 位小數，算出來的均價也就只在那個精度上有意義。 */
const DECIMAL_PLACES = 4;

function toHolding(position: ProjectedHolding): Holding {
  return {
    symbol: position.symbol,
    quantity: position.quantity,
    costUnknownQuantity: position.costUnknownQuantity,
    // 全部都成本不明時沒有均價可言；回 "0.0000" 會被讀成「免費」。
    averageCost: position.costUnknownQuantity === position.quantity ? null : position.averageCost.toFixed(DECIMAL_PLACES),
    totalCost: position.totalCost.toFixed(DECIMAL_PLACES),
    realizedProfitLoss: position.realizedProfitLoss.toFixed(DECIMAL_PLACES),
  };
}

/**
 * 一組交易 → 對外的持股清單。**GET /holdings 與匯入的 dryRun 預覽共用這一支**，所以兩邊的
 * 成本法、過濾規則與小數位永遠一致——這正是 web-nuxt 不在前端另寫一份 replay 的理由。
 *
 * 已出清（股數 0）的代號不列入：這是「持股明細」，不是「交易過的代號清單」。排序用代號，
 * 因為投影出來的順序取決於 Map 的插入順序（也就是最早交易日），那不是使用者預期的清單順序。
 */
export function holdingsFromLedger(entries: readonly LedgerEntry[]): Holding[] {
  return projectHoldings(entries)
    .holdings.filter((position) => position.quantity > 0)
    .map(toHolding)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export async function getHoldings(firebaseUid: string, deps: HoldingsDeps): Promise<Holding[]> {
  const rows = await deps.transactions.list(firebaseUid);
  const { entries } = await applyStockDividends(rows.map(toLedgerEntry), deps);
  return holdingsFromLedger(entries);
}

/**
 * 指定區間的已實現損益（使用者 2026-10-05 要求「主動交易的績效」，不依年度拆、可自選區間）。
 *
 * **區間只用來篩選賣出日，不能拿來截斷 replay**：成本基礎必須來自整段重算的批次（FIFO），區間開始前的
 * 買進照樣計入成本。所以整段照常重算，再挑出賣出日落在 [from, to] 的那幾筆（兩端都含）。
 * 截斷輸入看起來更省事，但會讓區間內第一筆賣出的成本基礎變成 0、已實現損益整筆灌水。
 *
 * 已出清的代號也會出現——它們正是這個端點存在的理由（web-nuxt 用使用者的真實檔案模擬：59 檔
 * 裡 33 檔已出清，那些的已實現損益合計 +389,025，在 GET /holdings 完全看不到）。
 */
export async function getRealizedProfitLoss(
  firebaseUid: string,
  from: string | undefined,
  to: string | undefined,
  deps: HoldingsDeps,
): Promise<RealizedProfitLossReport> {
  const rows = await deps.transactions.list(firebaseUid);
  const { entries } = await applyStockDividends(rows.map(toLedgerEntry), deps);
  const bySymbol = new Map<string, { profitLoss: number; excludedSellCount: number; excludedShares: number }>();
  for (const realization of projectHoldings(entries).realizations) {
    if ((from && realization.tradeDate < from) || (to && realization.tradeDate > to)) {
      continue;
    }
    const row = bySymbol.get(realization.symbol) ?? { profitLoss: 0, excludedSellCount: 0, excludedShares: 0 };
    row.profitLoss += realization.profitLoss;
    if (realization.excludedShares > 0) {
      row.excludedSellCount += 1;
      row.excludedShares += realization.excludedShares;
    }
    bySymbol.set(realization.symbol, row);
  }

  const symbols = [...bySymbol]
    .map(([symbol, row]) => ({
      symbol,
      realizedProfitLoss: row.profitLoss.toFixed(DECIMAL_PLACES),
      excludedSellCount: row.excludedSellCount,
      excludedShares: row.excludedShares,
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  const total = symbols.reduce((sum, row) => sum + Number(row.realizedProfitLoss), 0);

  return {
    from: from ?? null,
    to: to ?? null,
    symbols,
    totalRealizedProfitLoss: total.toFixed(DECIMAL_PLACES),
    excludedSellCount: symbols.reduce((sum, row) => sum + row.excludedSellCount, 0),
    excludedShares: symbols.reduce((sum, row) => sum + row.excludedShares, 0),
  };
}

/**
 * DELETE /holdings/:symbol。持股是算出來的，所以「刪掉一檔持股」只能是**刪掉它底下所有的交易**——
 * 這是 web-nuxt 2026-10-05 明確要求保留的語意（他們的「可復原刪除」是把這個請求延到提示關閉才送，
 * 所以伺服器端不需要任何復原機制）。要刪單獨一筆交易走 DELETE /transactions/:id。
 *
 * 404 的條件是「這個代號你沒有任何交易」，跟舊契約「那一列不存在」對使用者是同一件事。
 */
export async function removeHoldingSymbol(firebaseUid: string, symbol: string, deps: HoldingsDeps): Promise<void> {
  const deleted = await deps.transactions.removeBySymbol(firebaseUid, symbol);
  if (deleted === 0) {
    throw new AppError(`You have no transactions for "${symbol}"`, 404);
  }
}
