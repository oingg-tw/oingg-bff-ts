import { AppError } from "@/domain/appError.js";
import { projectHoldings, type LedgerEntry, type ProjectedHolding } from "@/domain/holdingProjection.js";
import { toLedgerEntry } from "@/application/transactions/transactions.service.js";
import type { AppDeps } from "@/application/deps.js";
import type { Holding } from "@/application/holdings/holdings.types.js";

/**
 * **這個切片不再有自己的 port。** 持股是交易紀錄的投影（2026-10-05），所以它要的依賴就是
 * `transactions`——`HoldingsPort` 與 prismaHoldings 連同那張表的讀寫一起刪掉了。
 */
export type HoldingsDeps = Pick<AppDeps, "transactions">;

/** 對齊 `Decimal(18,4)`：交易紀錄存 4 位小數，算出來的均價也就只在那個精度上有意義。 */
const DECIMAL_PLACES = 4;

function toHolding(position: ProjectedHolding): Holding {
  return {
    symbol: position.symbol,
    quantity: position.quantity,
    averageCost: position.averageCost.toFixed(DECIMAL_PLACES),
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
  return holdingsFromLedger(rows.map(toLedgerEntry));
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
