import type { LedgerEntry } from "@/domain/holdingProjection.js";

/**
 * 依除權紀錄自動入帳配股（使用者 2026-10-05 決定：要自動入帳）。
 *
 * **即時算、不存成交易列**：配股是從交易紀錄與除權資料推出來的，不是使用者的輸入。存成列的話，
 * 使用者改刪一筆除權日前的交易、或上游修正除權資料之後，那筆配股就過期了，而且沒有人知道要去改它。
 * 每次重算時產生，就永遠跟目前的帳本與資料一致。
 *
 * ## 比例的來源：除權息行事曆的 stockDividendRatio，不是 stockDividend ÷ 10
 *
 * `dividend-history` 的 `stockDividend` 是**元**，換算股數要除以**面額**——而面額不一定是 10 元
 * （5314 是 0.5 元，6415 是 2.5 元）。web-nuxt 一開始照 ÷10 推，5314 只算出 632 股，以為上游漏了
 * 「30 元的資本公積轉增資」並回報出去；實際上資料是對的，是面額假設錯了。
 *
 * 就算除以正確的面額也不夠準：`stockDividend` 四捨五入到兩位小數，面額 0.5 會把那個誤差放大 20 倍
 * （1.58 ÷ 0.5 × 4,000 = 12,640，實際是 12,628）。行事曆的 `stockDividendRatio` 已經是「每股配幾股」，
 * 而且精度足夠——2026-10-05 拿使用者的真實券商紀錄核對兩檔都完全吻合：
 *
 *     5314  3.157  × 4,000 = 12,628   實際賣出 12,628
 *     7740  0.1278 × 2,000 = 255.6 → 255   實際賣出 255
 *
 * ## 規則
 *
 * - 應配股數 ＝ **除權日前一天收盤後**的持股 × 比例，無條件捨去成整數（不足一股的部分券商配現金）。
 *   所以除權日當天才買進的股數不配，那天賣掉的照配。
 * - 配股記成一筆**價格 0 的買進**、排在除權日當天所有交易之前，在 FIFO 下就是一批成本 0 的股票——
 *   跟券商的記法一致（5314 逐筆對上券商）。報酬率那邊流入是 0，剛好抵銷除權當天的股價下跌。
 * - 持股算法跟 projectHoldings 一致（賣超夾成 0），否則兩邊會對「除權前持有多少」有不同答案。
 * - 不處理減資、現金增資認購：前者行事曆沒有資料；後者要付錢，是使用者自己記的買進。
 */

export interface StockDividendEvent {
  symbol: string;
  /** "YYYY-MM-DD" 除權日。 */
  exRightsDate: string;
  /** 每股配幾股（行事曆的 stockDividendRatio），已經跟面額無關。 */
  sharesPerShare: number;
}

/** 一筆實際入帳的配股，給交易紀錄顯示用。 */
export interface AppliedStockDividend {
  symbol: string;
  exRightsDate: string;
  sharesPerShare: number;
  /** 除權日前一天收盤後的持股。 */
  heldBefore: number;
  quantity: number;
}

/**
 * 合成列的 createdAt。replay 的同日第二排序鍵是 createdAt 字串，這個值比任何真實的 ISO 時間戳都小，
 * 所以配股一定排在除權日當天所有真實交易之前。
 */
const BEFORE_ANY_REAL_ROW = "0000-00-00T00:00:00.000Z";

/**
 * 浮點保險：0.29 × 100 在 double 裡是 28.999999999999996，直接 floor 會少一股（3.157 × 4000 剛好精確，
 * 不是每個比例都會出事，所以沒有測到不代表不需要）。這個容差
 * 遠小於任何真實比例能產生的小數部分（比例最多 4 位小數 × 整數股數，小數部分至少差 1e-4）。
 */
const FLOOR_EPSILON = 1e-6;

function byReplayOrder(a: LedgerEntry, b: LedgerEntry): number {
  return a.tradeDate === b.tradeDate ? a.createdAt.localeCompare(b.createdAt) : a.tradeDate.localeCompare(b.tradeDate);
}

/**
 * 回傳加入配股之後的完整帳本（原本的列加上合成的配股列），以及實際入帳的配股清單。
 * 只有應配股數 ≥ 1 的事件會產生列；持股為 0 的代號、或比例太小配不到一股的，都不會出現。
 */
export function withStockDividends(
  entries: readonly LedgerEntry[],
  events: readonly StockDividendEvent[],
): { entries: LedgerEntry[]; dividends: AppliedStockDividend[] } {
  const sorted = [...entries].sort(byReplayOrder);
  const pending = [...events].sort((a, b) => a.exRightsDate.localeCompare(b.exRightsDate));
  const held = new Map<string, number>();
  const synthetic: LedgerEntry[] = [];
  const dividends: AppliedStockDividend[] = [];

  function apply(entry: LedgerEntry): void {
    const current = held.get(entry.symbol) ?? 0;
    held.set(entry.symbol, entry.action === "BUY" ? current + entry.quantity : current - Math.min(entry.quantity, current));
  }

  let cursor = 0;
  for (const event of pending) {
    // 除權日「前一天收盤後」＝ 交易日嚴格早於除權日的都套用，當天的不算。
    while (cursor < sorted.length && sorted[cursor]!.tradeDate < event.exRightsDate) {
      apply(sorted[cursor++]!);
    }
    const heldBefore = held.get(event.symbol) ?? 0;
    const quantity = Math.floor(heldBefore * event.sharesPerShare + FLOOR_EPSILON);
    if (quantity < 1) {
      continue;
    }
    const entry: LedgerEntry = {
      symbol: event.symbol,
      action: "BUY",
      quantity,
      price: 0,
      fee: 0,
      tax: 0,
      tradeDate: event.exRightsDate,
      createdAt: BEFORE_ANY_REAL_ROW,
    };
    synthetic.push(entry);
    apply(entry);
    dividends.push({ symbol: event.symbol, exRightsDate: event.exRightsDate, sharesPerShare: event.sharesPerShare, heldBefore, quantity });
  }

  return { entries: [...entries, ...synthetic], dividends };
}
