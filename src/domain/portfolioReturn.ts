import type { LedgerEntry } from "@/domain/holdingProjection.js";

/**
 * 持股組合在一段期間的**時間加權報酬（TWR）**，用來跟大盤比（使用者 2026-10-05 要求，經 web-nuxt）。
 *
 * 為什麼是 TWR 不是資金加權（XIRR）：要跟指數比，就得排除「什麼時候投入多少錢」的影響——指數沒有
 * 申購贖回，TWR 才是同一把尺。為什麼在 bff-ts 算而不是 analysis-ts：交易紀錄是這個服務擁有的使用者
 * 資料，analysis-ts 不該知道任何使用者的持股；它只提供公開的收盤價。
 *
 * 純函式：不碰網路、不碰資料庫。收盤價由呼叫端取好、整理成 `closes` 傳進來。
 *
 * ## 每日報酬：流入算開盤前，流出算收盤後
 *
 *     gain_t = V_t − V_{t−1} − CF_t
 *     r_t    = gain_t ÷ (V_{t−1} + max(CF_t, 0))
 *
 * V_t 是當天收盤後的持股市值，CF_t 是當天淨流入（買進金額＋手續費 − 賣出淨收入）。
 *
 * **刻意不用「現金流全在收盤後」的 (V_t − CF_t) ÷ V_{t−1} − 1**（web-nuxt 原本提的）：那個分母不含
 * 當天投入的錢，所以前一天持股很小、當天大筆買進時會爆掉——持有 3 萬的 ETF、盤中買進 100 萬的 2330、
 * 收盤漲 1%，單日就算出 +33%，而且這一天會一路連乘進累積報酬。這裡的分母永遠包含當天流入，所以
 * 單日報酬的大小被當天的價格變動夾住。V_{t−1} = 0（期間內第一次買進、或出清後重新進場）也不需要特判：
 * 那天就是 gain ÷ 流入。
 *
 * 代價：剛好以**收盤價**買進的那一天，新資金被當成整天都在場，當天報酬會被稀釋。反過來說，以**前一天
 * 收盤價**買進、以**當天收盤價**賣出時，這個公式是精確的——單一個股不論怎麼加減碼，TWR 都等於
 * 收盤價的漲跌幅。測試就釘在這個性質上。真實成交價落在兩者之間，所以誤差有上限；另一個公式的誤差沒有。
 *
 * ## 其他規則
 *
 * - **不含息**：股利不計入，跟價格型的加權指數口徑一致。
 * - 某檔某天沒有收盤價（沒成交、停牌、上游還沒更新）就沿用最近一個收盤價；連一個都沒有（例如價格
 *   資料回溯不到那麼早），就用那檔最近一筆**交易價**當市值。兩種情況都計入 `missingPriceDays`，讓前端
 *   照實註明，而不是悄悄把那檔當成 0 元——那會在買進日算出一筆巨大的假虧損。
 * - 期間開始前就持有的部位，用「期間前最後一個交易日」的收盤價當起點（`baseDate`）。
 * - 交易日不在交易日曆上（例如手動輸入了週末的日期）就歸到它之後的第一個交易日。
 * - 賣超被夾掉、實際賣出 0 股的那一筆整筆略過：它的手續費沒有對應的部位，算進來會在一個空的組合上
 *   憑空產生 −100%。（寫入路徑已經擋賣超，這只會發生在併發寫入的極端情況。）
 */

export interface PortfolioReturnInput {
  /** 整本帳（不只是期間內的）——期初部位要靠期間前的交易推出來。 */
  entries: readonly LedgerEntry[];
  /** 期間內的交易日，升冪，第一天之前的那個交易日是 baseDate。 */
  calendar: readonly string[];
  /** 期間前最後一個交易日；它的收盤市值是起點。 */
  baseDate: string;
  /** symbol → (tradeDate → close)。只放真的有收盤價的日子，null 的不要放。 */
  closes: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

export interface PortfolioReturn {
  /**
   * 期間累積報酬（小數）。整段期間都沒有任何曝險（沒持股也沒買進）時是 null——那不是「報酬 0」，
   * 而是「沒有東西可以算」。
   */
  twr: number | null;
  /**
   * 每個交易日收盤後的累積報酬。**第一次有曝險之前的日子是 null**：使用者期間中才開始投資時，
   * 前面那段不應該畫成一條 0% 的水平線（那會讀成「那段時間報酬持平」）。出清後重新進場之間的空檔
   * 則延續當時的累積值，這是 TWR 的定義。
   */
  series: { date: string; cumulative: number | null }[];
  /** symbol → 期間內「有持股但當天沒有收盤價」的天數。0 的不列。 */
  missingPriceDays: Map<string, number>;
}

function byReplayOrder(a: LedgerEntry, b: LedgerEntry): number {
  return a.tradeDate === b.tradeDate ? a.createdAt.localeCompare(b.createdAt) : a.tradeDate.localeCompare(b.tradeDate);
}

export function computePortfolioReturn(input: PortfolioReturnInput): PortfolioReturn {
  const entries = [...input.entries].sort(byReplayOrder);
  const quantities = new Map<string, number>();
  /** 完全沒有收盤價可沿用時的後備：那檔最近一筆交易價。 */
  const lastTradePrice = new Map<string, number>();
  const missingPriceDays = new Map<string, number>();

  /**
   * 每檔的收盤價序列（升冪）與一個只會往前走的指標。查「當天或之前最近一個收盤價」要看**整條**序列，
   * 而不只是有持股的那些天：買進當天剛好沒成交時，該沿用的是買進前一天的收盤價，不是交易價；期間
   * 開始前的收盤價也一樣。因為查詢的日期只會遞增（起點、然後逐日），指標不必回頭。
   */
  const closeSeries = new Map<string, [string, number][]>();
  for (const [symbol, byDate] of input.closes) {
    closeSeries.set(symbol, [...byDate].sort(([a], [b]) => a.localeCompare(b)));
  }
  const closeCursor = new Map<string, number>();
  function closeOnOrBefore(symbol: string, date: string): { price: number; exact: boolean } | undefined {
    const series = closeSeries.get(symbol);
    if (!series) {
      return undefined;
    }
    let index = closeCursor.get(symbol) ?? -1;
    while (index + 1 < series.length && series[index + 1]![0] <= date) {
      index++;
    }
    closeCursor.set(symbol, index);
    return index >= 0 ? { price: series[index]![1], exact: series[index]![0] === date } : undefined;
  }

  let cursor = 0;
  /** 把交易日 ≤ date 的交易全部套用，回傳淨流入。 */
  function applyThrough(date: string): number {
    let netFlow = 0;
    while (cursor < entries.length && entries[cursor]!.tradeDate <= date) {
      const entry = entries[cursor++]!;
      const held = quantities.get(entry.symbol) ?? 0;
      lastTradePrice.set(entry.symbol, entry.price);
      if (entry.action === "BUY") {
        quantities.set(entry.symbol, held + entry.quantity);
        netFlow += entry.quantity * entry.price + entry.fee;
      } else {
        const sold = Math.min(entry.quantity, held);
        if (sold === 0) {
          continue;
        }
        quantities.set(entry.symbol, held - sold);
        netFlow -= sold * entry.price - entry.fee - entry.tax;
      }
    }
    return netFlow;
  }

  /** 收盤後的持股市值。`countMissing` 只在期間內的日子為真——起點那天的缺價不算進報表。 */
  function marketValue(date: string, countMissing: boolean): number {
    let value = 0;
    for (const [symbol, quantity] of quantities) {
      if (quantity === 0) {
        continue;
      }
      const close = closeOnOrBefore(symbol, date);
      if (!close?.exact && countMissing) {
        missingPriceDays.set(symbol, (missingPriceDays.get(symbol) ?? 0) + 1);
      }
      value += quantity * (close?.price ?? lastTradePrice.get(symbol) ?? 0);
    }
    return value;
  }

  // 起點：期間前的交易全部當成期初部位，不算現金流。
  applyThrough(input.baseDate);
  let previousValue = marketValue(input.baseDate, false);

  let growth = 1;
  let invested = false;
  const series: PortfolioReturn["series"] = [];
  for (const date of input.calendar) {
    const netFlow = applyThrough(date);
    const value = marketValue(date, true);
    const denominator = previousValue + Math.max(netFlow, 0);
    if (denominator > 0) {
      growth *= 1 + (value - previousValue - netFlow) / denominator;
      invested = true;
    }
    series.push({ date, cumulative: invested ? growth - 1 : null });
    previousValue = value;
  }

  return { twr: invested ? growth - 1 : null, series, missingPriceDays };
}
