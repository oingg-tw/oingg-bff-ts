/**
 * 持股明細的投影：由交易紀錄算出每個代號的現有股數、成本與已實現損益（先進先出）。
 *
 * **2026-10-05 的決定（使用者拍板，web-nuxt 提案）**：持股不再是一張自己維護的表，而是交易紀錄的純函式
 * 投影。原本 `Holding` 與 `StockTransaction` 是刻意獨立的（存量 vs 流量，2026-08-30 的決定），那個決定
 * 被推翻了——使用者要的是「交易紀錄可以影響持股明細」。
 *
 * **為什麼是算出來而不是物化成一張表**：物化表要在每一次交易的新增／修改／刪除時重算並寫回，那會多出一整
 * 類「兩邊不一致」的缺陷，而且已實現損益還得再加欄位。這裡改刪任何一筆過去的交易都是重跑同一個 fold，
 * 結構上不可能漂掉。代價是每次讀取都要重算，而一個散戶一生的交易筆數是幾百到幾千、用 firebaseUid 的索引
 * 一次查出來——這個規模下重算比維護一致性便宜太多。
 *
 * **成本法是先進先出（FIFO），2026-10-05 由移動平均改過來。** 使用者聽完 5314 的兩種算法說明後決定
 * 「那不然就比照券商就好」（經 web-nuxt 轉達原話）。每一筆買進——包括期初部位、自動配股（成本 0）、
 * 成本不明的取得——各自是一**批**，賣出時從最舊的一批開始扣。買進手續費計入那一批的成本；賣出的手續費
 * 與交易稅從那筆賣出的價金扣掉。
 *
 * 為什麼改：移動平均跟券商的**總額**一樣（全部賣完時必然相等），但**逐筆**不同——5314 除權後賣掉原本
 * 4,000 股，券商記 −200,962，移動平均記 +46,827，而使用者會拿 GET /holdings/realized 依月份跟對帳單比。
 * web-nuxt 用使用者的真實檔案模擬 FIFO：47 筆券商有成本的賣出裡 45 筆逐筆差距在 1 元以內，另 2 筆是
 * 他們推算期初成本的錯，不是 FIFO 的。
 *
 * **期初部位沒有旗標**：想表達「我在開始記帳之前就有 1000 股」就記一筆日期最早的 BUY，跟 web-nuxt 把
 * 配股記成價格 0 的買進是同一招。刻意不加 `isOpening` 欄位——replay 不需要知道哪一筆是期初（它只是
 * 最早的那一筆買進），加了就是第二份會漂的真相來源。
 *
 * 這個檔案在 domain 層，所以不 import 任何東西：它是純規則，拿得到的只有數字。金額用 double 運算，
 * 到邊界才轉成 4 位小數的字串（對齊 `Decimal(18,4)` 欄位）。
 * ponytail: double 運算，台股市值規模下 15-16 位有效數字綽綽有餘；真要逐分錢精確累加再換 decimal.js。
 */

export type LedgerAction = "BUY" | "SELL";

/** replay 的輸入。這是交易紀錄裡「會影響持股」的那幾個欄位，note 之類的不在這裡。 */
export interface LedgerEntry {
  symbol: string;
  action: LedgerAction;
  quantity: number;
  price: number;
  fee: number;
  tax: number;
  /** "YYYY-MM-DD"。只有日精度，所以同日的順序要靠 createdAt——見 byReplayOrder。 */
  tradeDate: string;
  /** ISO 字串。同日多筆時的第二排序鍵。 */
  createdAt: string;
  /**
   * 不透明的呼叫端識別字串，原封不動出現在 `Oversold.ref` 裡。批次匯入用它把賣超對回券商的
   * `externalRef`，讓前端指得出是哪一列。domain 不解釋它的內容。
   */
  ref?: string;
  /**
   * **成本不明的取得**（使用者 2026-10-05 決定的 (a)）：股數真的有，但取得成本不知道——例如很久以前
   * 買的、券商紀錄已經過期刪除。`price` 會被忽略。
   *
   * 為什麼不直接記成價格 0：成本 0 是一個**主張**（這些股票是免費的），會把整筆賣出金額算成獲利。
   * 成本不明是**沒有主張**：庫存照算，已實現損益不計入，報酬率當成以當天市值轉入。FIFO 下它是一般的
   * 一批，依日期決定何時被賣到。
   */
  costUnknown?: boolean;
}

export interface ProjectedHolding {
  symbol: string;
  /** 總股數，含成本不明的部分。 */
  quantity: number;
  /** 其中成本不明的股數。 */
  costUnknownQuantity: number;
  /**
   * 剩下的**成本已知那幾批**的總成本 ÷ 股數。沒有成本已知的股數時是 0——呼叫端要看 costUnknownQuantity
   * 判斷那個 0 是「免費」還是「不知道」。
   */
  averageCost: number;
  /** 成本已知那部分的總成本。 */
  totalCost: number;
  /** 只含成本已知那部分的損益；成本不明的股數賣掉時不計入，見 Realization.excludedShares。 */
  realizedProfitLoss: number;
}

/** 一筆賣超的交易。`held` 是那個時點手上的股數，`attempted` 是那一筆想賣的股數。 */
export interface Oversold {
  symbol: string;
  tradeDate: string;
  held: number;
  attempted: number;
  /** `attempted - held`，也就是那個時點缺的股數。 */
  shortBy: number;
  /** 呼叫端給的識別字串（LedgerEntry.ref），沒給就是 undefined。 */
  ref?: string;
}

/**
 * 一筆賣出實現的損益。`profitLoss` ＝ 賣出價金 − 賣出手續費 − 交易稅 − 被賣掉的那幾批（FIFO，從最舊開始）的成本。
 *
 * 為什麼要逐筆留下而不只是累加進 ProjectedHolding.realizedProfitLoss：「指定日期區間的已實現損益」
 * 要的是**賣出日**落在區間內的那幾筆，但成本基礎必須來自整段重算的批次（區間開始前的買進照樣計入
 * 成本）。所以區間不能拿來截斷 replay 的輸入——那會讓均價算錯——只能在 replay 之後依賣出日篩選。
 */
export interface Realization {
  symbol: string;
  tradeDate: string;
  /** 只含成本已知那部分的損益。 */
  profitLoss: number;
  /** 這筆賣出裡成本不明、所以沒有計入 profitLoss 的股數。0 代表整筆都計入。 */
  excludedShares: number;
  /** 實際賣出的股數（賣超被夾掉的部分不算）。 */
  shares: number;
  /**
   * 賣掉的那幾批從買進到賣出的天數，依股數加權平均（2026-10-07，交易統計的平均持有天數用）。
   * 自動入帳的配股那一批從除權日起算。賣出 0 股時是 null。
   */
  holdingDays: number | null;
}

/**
 * 已實現交易的描述統計（2026-10-07，使用者要求）。只算**成本已知**的部分：整筆都是成本不明的賣出
 * （profitLoss 只剩 0）不計入勝負，否則會被當成「打平」拉低勝率。損益剛好是 0 的那筆也不算勝也不算負。
 *
 * - winRate ＝ 賺錢筆數 ÷（賺錢＋賠錢筆數）
 * - averageWin／averageLoss：賺錢（賠錢）那幾筆的平均金額，averageLoss ≤ 0
 * - profitFactor ＝ 賺錢總額 ÷ |賠錢總額|；沒有賠錢的筆數時是 null（不是無限大）
 * - averageHoldingDays：依股數加權
 */
export function tradeStatistics(realizations: readonly Realization[]): {
  sellCount: number;
  winCount: number;
  lossCount: number;
  winRate: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  profitFactor: number | null;
  averageHoldingDays: number | null;
} {
  const counted = realizations.filter((r) => r.shares > 0 && r.excludedShares < r.shares);
  const wins = counted.filter((r) => r.profitLoss > 0).map((r) => r.profitLoss);
  const losses = counted.filter((r) => r.profitLoss < 0).map((r) => r.profitLoss);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const withDays = realizations.filter((r) => r.holdingDays !== null && r.shares > 0);
  const shareTotal = sum(withDays.map((r) => r.shares));
  return {
    sellCount: counted.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: wins.length + losses.length > 0 ? wins.length / (wins.length + losses.length) : null,
    averageWin: wins.length > 0 ? sum(wins) / wins.length : null,
    averageLoss: losses.length > 0 ? sum(losses) / losses.length : null,
    profitFactor: losses.length > 0 ? sum(wins) / Math.abs(sum(losses)) : null,
    averageHoldingDays: shareTotal > 0 ? sum(withDays.map((r) => r.holdingDays! * r.shares)) / shareTotal : null,
  };
}

const MS_PER_DAY = 86_400_000;

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY;
}

export interface Projection {
  holdings: ProjectedHolding[];
  /** 每一筆賣出的已實現損益，依 replay 順序。賣超被夾掉的那一筆只算實際賣得出去的股數。 */
  realizations: Realization[];
  /**
   * **每一筆**賣超，依 replay 順序；空陣列代表整段合法。
   *
   * 刻意不是「第一筆」：批次匯入要一次把所有缺的期初部位請使用者補完，只回第一筆的話那會變成
   * 補一檔、重匯、再被擋一次的來回。單筆寫入的路徑只看 `[0]`。
   *
   * **同一檔有多筆賣超時，要補的期初股數是同一檔 `shortBy` 的加總**，不是最大值。每一筆賣超之後
   * 部位被夾成 0，等於把那段缺口「免除」了，所以下一筆量到的是**額外的**缺口；期初部位要把每一段
   * 都補上。加總剛好是讓整段不賣超的**最小**期初股數（對 1,998 組隨機序列暴力驗證過，取最大值只對
   * 18 組，也就是只有一筆賣超的時候）。
   *
   * 2026-10-05 更正：這裡原本寫「取最大值、不要相加」，那是錯的，而且我照那句話給過 web-nuxt
   * 指引。他們用使用者的真實檔案抓到：5314 同日賣 12,000 股與零股 628 股、兩筆都賣超，取最大值
   * 會少補 628 股；11 檔裡有 5 檔少補。
   */
  oversold: Oversold[];
}

/**
 * `tradeDate` 是 `@db.Date`（只有日精度），所以同一天的多筆交易沒有天然的全序。順序會決定同一天的賣出
 * 有沒有股票可賣（「先賣後買」在沒有舊部位時是賣超），也決定那筆賣出扣到的是哪一批。
 *
 * 所以第二排序鍵用 `createdAt`（寫入順序）。**刻意不用 id**：id 是 uuid v4，排序是隨機的——
 * 現有的 listTransactions 用 `id desc` 當 tiebreaker 只是為了讓輸出穩定，不代表時間順序。
 */
function byReplayOrder(a: LedgerEntry, b: LedgerEntry): number {
  return a.tradeDate === b.tradeDate ? a.createdAt.localeCompare(b.createdAt) : a.tradeDate.localeCompare(b.tradeDate);
}

/**
 * 把一組交易（可以跨代號）算成每個代號的持股。各代號的部位互不相干，所以整組一起排序沒問題。
 *
 * **不丟錯、也不在賣超時中斷**，因為三個呼叫端要的不一樣：單筆寫入看 `oversold[0]` 回 400、批次匯入
 * 要整份清單回 422、而讀取路徑（GET /holdings）必須照樣回得出東西——併發寫入理論上能讓兩筆賣出同時
 * 通過檢查，那時候讓「看自己的持股」整個失敗是最糟的反應。賣超時把那一筆夾成「把手上的全部賣掉」
 * 繼續算下去。
 */
export function projectHoldings(entries: readonly LedgerEntry[]): Projection {
  const positions = new Map<string, ProjectedHolding>();
  /** 每個代號的批次，最舊的在前。`cost` 是那一批剩下股數的總成本；成本不明的批次是 0 且不參與均價。 */
  const lotsBySymbol = new Map<string, { quantity: number; cost: number; costUnknown: boolean; acquiredOn: string }[]>();
  const oversold: Oversold[] = [];
  const realizations: Realization[] = [];

  for (const entry of [...entries].sort(byReplayOrder)) {
    let position = positions.get(entry.symbol);
    if (!position) {
      position = { symbol: entry.symbol, quantity: 0, costUnknownQuantity: 0, averageCost: 0, totalCost: 0, realizedProfitLoss: 0 };
      positions.set(entry.symbol, position);
      lotsBySymbol.set(entry.symbol, []);
    }
    const lots = lotsBySymbol.get(entry.symbol)!;

    if (entry.action === "BUY") {
      const costUnknown = entry.costUnknown === true;
      lots.push({ quantity: entry.quantity, cost: costUnknown ? 0 : entry.quantity * entry.price + entry.fee, costUnknown, acquiredOn: entry.tradeDate });
    } else {
      const sold = Math.min(entry.quantity, position.quantity);
      if (sold < entry.quantity) {
        oversold.push({
          symbol: entry.symbol,
          tradeDate: entry.tradeDate,
          held: position.quantity,
          attempted: entry.quantity,
          shortBy: entry.quantity - position.quantity,
          ...(entry.ref === undefined ? {} : { ref: entry.ref }),
        });
      }
      /**
       * 從最舊的一批開始扣。賣到成本不明的批次時，那些股數不計入損益（計入 excludedShares）；一筆賣出
       * 同時碰到兩種批次時，價金與費用依股數比例分攤，只有成本已知那部分進 profitLoss。
       *
       * 整批賣完時直接扣掉那一批的總成本，而不是 單價 × 股數：後者在 double 下會留下 1e-10 等級的殘值。
       */
      let remaining = sold;
      let knownSold = 0;
      let unknownSold = 0;
      let costRemoved = 0;
      let shareDays = 0;
      while (remaining > 0) {
        const lot = lots[0]!;
        const take = Math.min(remaining, lot.quantity);
        shareDays += take * daysBetween(lot.acquiredOn, entry.tradeDate);
        const portion = take === lot.quantity ? lot.cost : (lot.cost * take) / lot.quantity;
        if (lot.costUnknown) {
          unknownSold += take;
        } else {
          knownSold += take;
          costRemoved += portion;
        }
        if (take === lot.quantity) {
          lots.shift();
        } else {
          lot.quantity -= take;
          lot.cost -= portion;
        }
        remaining -= take;
      }
      const netProceeds = sold * entry.price - entry.fee - entry.tax;
      // sold 為 0（賣超被夾成 0 股）時維持原本的行為：手續費與稅照樣記成損失。
      const profitLoss = sold === 0 ? netProceeds : (netProceeds * knownSold) / sold - costRemoved;
      position.realizedProfitLoss += profitLoss;
      realizations.push({
        symbol: entry.symbol,
        tradeDate: entry.tradeDate,
        profitLoss,
        excludedShares: unknownSold,
        shares: sold,
        holdingDays: sold === 0 ? null : shareDays / sold,
      });
    }

    // 摘要欄位每次都從批次重算，而不是增量加減：批次很少（一檔幾十筆），重算就不可能跟批次漂開。
    position.quantity = 0;
    position.costUnknownQuantity = 0;
    position.totalCost = 0;
    for (const lot of lots) {
      position.quantity += lot.quantity;
      if (lot.costUnknown) {
        position.costUnknownQuantity += lot.quantity;
      } else {
        position.totalCost += lot.cost;
      }
    }
    const knownQuantity = position.quantity - position.costUnknownQuantity;
    position.averageCost = knownQuantity === 0 ? 0 : position.totalCost / knownQuantity;
  }

  return { holdings: [...positions.values()], realizations, oversold };
}
