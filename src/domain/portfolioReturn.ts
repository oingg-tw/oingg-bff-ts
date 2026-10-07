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
  /**
   * 資金加權報酬（IRR）換算成整段期間的報酬，跟 twr 同一個尺度（不是年化）。TWR 是「選股的報酬」，
   * 這個是「你的錢實際賺了多少」，兩者的差距就是進出場時機（何時投入多少）的影響。現金流的口徑跟 TWR
   * 完全一樣：成本不明的取得以當天市值轉入、配股流入 0、不含現金股利。算不出來（沒有曝險、或現金流
   * 找不到解）時是 null。
   */
  mwr: number | null;
  /** 有曝險的每個交易日的單日報酬（跟 twr 連乘的是同一串）。 */
  dailyReturns: { date: string; r: number }[];
  /**
   * 期間內（不含起點以前）的交易。買進只算真的成交（成本不明的取得與配股不算——那不是交易）；
   * averageMarketValue 是第一次有曝險之後每天收盤市值的平均，沒有曝險時是 null。
   */
  trading: { buyAmount: number; sellAmount: number; fees: number; taxes: number; averageMarketValue: number | null };
}

const MS_PER_DAY = 86_400_000;

function yearsBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY / 365;
}

/**
 * 解 Σ CF_k × (1 + x)^(−t_k ÷ T) = 0，x 是**整段期間**的報酬（等於年化 IRR 換算回期間），t_k 是第 k 筆
 * 現金流距 startDate 的時間、T 是到 endDate 的時間。投入是負的、取回與期末市值是正的。
 *
 * 直接解期間報酬而不是年化利率：短期間（幾天）漲幾 % 換算成年化會是天文數字，任何固定的搜尋範圍都框不住
 * （2026-10-07 測試抓到：5 天的期間二分法找不到解）。期間報酬的範圍跟期間長短無關。
 *
 * ponytail: 二分法、只找一個根。現金流正負號交錯很多次時 IRR 理論上可能有多個解；個人持股幾乎不會遇到。
 * 兩端點同號（找不到解）就回 null，不硬給一個數字。
 */
export function moneyWeightedReturn(flows: readonly { date: string; amount: number }[], startDate: string, endDate: string): number | null {
  const horizon = yearsBetween(startDate, endDate);
  if (horizon <= 0 || !flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0)) {
    return null;
  }
  const npv = (x: number) => flows.reduce((sum, f) => sum + f.amount * (1 + x) ** -(yearsBetween(startDate, f.date) / horizon), 0);
  let low = -0.9999;
  let high = 1e6;
  if (Math.sign(npv(low)) === Math.sign(npv(high))) {
    return null;
  }
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    if (Math.sign(npv(mid)) === Math.sign(npv(low))) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

/** 組合的日報酬配上同一天的加權指數日報酬；大盤當天或前一天沒有收盤的日子不列。 */
function pairWithBenchmark(
  daily: readonly { date: string; r: number }[],
  marketCloses: ReadonlyMap<string, number>,
  calendar: readonly string[],
  baseDate: string,
): { date: string; p: number; b: number }[] {
  const previous = new Map(calendar.map((date, i) => [date, i === 0 ? baseDate : calendar[i - 1]!]));
  const pairs: { date: string; p: number; b: number }[] = [];
  for (const { date, r } of daily) {
    const before = marketCloses.get(previous.get(date) ?? "");
    const close = marketCloses.get(date);
    if (before !== undefined && close !== undefined && before > 0) {
      pairs.push({ date, p: r, b: close / before - 1 });
    }
  }
  return pairs;
}

const TRADING_DAYS_PER_YEAR = 252;

/**
 * 月利率（年利率 %）→ 每個交易日的單日無風險報酬 (1 + y)^(1/252) − 1。
 *
 * 用的是五大銀行**一年期定存**（使用者 2026-10-07 經 GOV 定案）：期限配一年的窗口，也是散戶真正做得到的
 * 無風險替代；台灣基金實務的夏普值也用定存。十年期公債是錯的期限（含存續期溢酬），隔夜拆款是同業利率。
 *
 * 某個月還沒有資料（CBC 月報落後一到兩個月）就**沿用最近一個有資料的月份，缺口長度不寫死**。這支序列是
 * 階梯函數、只在央行理監事會的 3／6／9／12 月動（GOV 實測：2024-03 起連續 30 個月 1.70%），所以沿用
 * 在非理監事會月份誤差是 0。`used` 逐月列出實際套用的利率與它來自哪個月，讓呼叫端照實揭露。
 * 比最早的資料還早的月份沒有利率，那幾天不列入（1987-01 起，實務上碰不到）。
 */
export function dailyRiskFreeRates(
  dates: readonly string[],
  monthly: readonly { period: string; annualPct: number }[],
): { byDate: Map<string, number>; used: { period: string; annualPct: number; sourcePeriod: string }[] } {
  const sorted = [...monthly].sort((a, b) => a.period.localeCompare(b.period));
  const byDate = new Map<string, number>();
  const used = new Map<string, { period: string; annualPct: number; sourcePeriod: string }>();
  let cursor = -1;
  for (const date of [...dates].sort()) {
    const period = date.slice(0, 7);
    while (cursor + 1 < sorted.length && sorted[cursor + 1]!.period <= period) {
      cursor++;
    }
    if (cursor < 0) {
      continue;
    }
    const source = sorted[cursor]!;
    byDate.set(date, (1 + source.annualPct / 100) ** (1 / TRADING_DAYS_PER_YEAR) - 1);
    used.set(period, { period, annualPct: source.annualPct, sourcePeriod: source.period });
  }
  return { byDate, used: [...used.values()] };
}

function average(xs: readonly number[]): number {
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

function sampleCovariance(xs: readonly number[], ys: readonly number[]): number {
  const mx = average(xs);
  const my = average(ys);
  return xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i]! - my), 0) / (xs.length - 1);
}

/**
 * 經風險調整的報酬，**只用實際績效**（回推的報酬帶事後挑股的偏誤，見 portfolioRisk.ts）。全部年化：
 * 平均 × 252、標準差 × √252。超額報酬 e = 日報酬 − 當天的單日無風險報酬。
 *
 * - 夏普 ＝ 平均(e) ÷ 標準差(e)；索提諾把分母換成 e 的下行半標準差（門檻 0）。
 * - M² ＝ 平均無風險 ＋ 夏普 × 大盤波動：把組合的風險調到跟大盤一樣時的年化報酬，可以直接跟大盤比。
 * - Beta、詹森 α：組合超額報酬對大盤超額報酬回歸；α 是扣掉大盤那部分之後的年化超額報酬。
 * - 追蹤誤差 ＝ 標準差(組合 − 大盤)；資訊比率 ＝ 平均(組合 − 大盤) ÷ 追蹤誤差。
 * - maxDrawdown：實際組合的最大跌幅（≤ 0），給呼叫端算卡瑪比率。
 *
 * 只用三樣都有的日子（組合、大盤、無風險利率）。樣本門檻由呼叫端決定。
 */
export function riskAdjustedReturns(
  daily: readonly { date: string; r: number }[],
  marketCloses: ReadonlyMap<string, number>,
  calendar: readonly string[],
  baseDate: string,
  riskFreeByDate: ReadonlyMap<string, number>,
): {
  sampleDays: number;
  sharpe: number | null;
  sortino: number | null;
  m2: number | null;
  beta: number | null;
  jensenAlpha: number | null;
  trackingError: number | null;
  informationRatio: number | null;
  maxDrawdown: number;
} {
  const rows = pairWithBenchmark(daily, marketCloses, calendar, baseDate).flatMap((x) => {
    const rf = riskFreeByDate.get(x.date);
    return rf === undefined ? [] : [{ ...x, rf }];
  });

  let level = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const { r } of daily) {
    level *= 1 + r;
    peak = Math.max(peak, level);
    maxDrawdown = Math.min(maxDrawdown, level / peak - 1);
  }

  const n = rows.length;
  if (n < 2) {
    return { sampleDays: n, sharpe: null, sortino: null, m2: null, beta: null, jensenAlpha: null, trackingError: null, informationRatio: null, maxDrawdown };
  }
  const excess = rows.map((x) => x.p - x.rf);
  const marketExcess = rows.map((x) => x.b - x.rf);
  const active = rows.map((x) => x.p - x.b);
  const yearly = TRADING_DAYS_PER_YEAR;
  const rootYear = Math.sqrt(TRADING_DAYS_PER_YEAR);

  const excessSd = Math.sqrt(sampleCovariance(excess, excess));
  const sharpe = excessSd > 0 ? (average(excess) / excessSd) * rootYear : null;
  const downside = Math.sqrt(average(excess.map((e) => Math.min(e, 0) ** 2)));
  const marketVar = sampleCovariance(marketExcess, marketExcess);
  const beta = marketVar > 0 ? sampleCovariance(excess, marketExcess) / marketVar : null;
  const trackingError = Math.sqrt(sampleCovariance(active, active)) * rootYear;
  const marketSd = Math.sqrt(sampleCovariance(rows.map((x) => x.b), rows.map((x) => x.b))) * rootYear;
  return {
    sampleDays: n,
    sharpe,
    sortino: downside > 0 ? (average(excess) * yearly) / (downside * rootYear) : null,
    m2: sharpe === null ? null : average(rows.map((x) => x.rf)) * yearly + sharpe * marketSd,
    beta,
    jensenAlpha: beta === null ? null : (average(excess) - beta * average(marketExcess)) * yearly,
    trackingError,
    // 組合幾乎就是大盤時，追蹤誤差只剩浮點雜訊（~1e-17），雜訊 ÷ 雜訊會算出一個看起來正常的比率。
    informationRatio: trackingError > 1e-9 ? (average(active) * yearly) / trackingError : null,
    maxDrawdown,
  };
}

/**
 * 月報酬與年報酬表（2026-10-07，使用者要求）：每個月（年）組合與大盤各自的複利報酬。只用兩邊都有報酬的
 * 日子，所以同一列的兩個數字涵蓋同一批交易日；期間頭尾的月份可能不是整月，tradingDays 照實給。
 * 沒有曝險的月份不列。
 */
export function periodReturns(
  daily: readonly { date: string; r: number }[],
  marketCloses: ReadonlyMap<string, number>,
  calendar: readonly string[],
  baseDate: string,
): { monthly: PeriodReturn[]; yearly: PeriodReturn[] } {
  const pairs = pairWithBenchmark(daily, marketCloses, calendar, baseDate);
  const group = (keyLength: number) => {
    const rows = new Map<string, PeriodReturn>();
    for (const { date, p, b } of pairs) {
      const period = date.slice(0, keyLength);
      const row = rows.get(period) ?? { period, portfolio: 0, benchmark: 0, tradingDays: 0 };
      row.portfolio = (1 + row.portfolio) * (1 + p) - 1;
      row.benchmark = (1 + row.benchmark) * (1 + b) - 1;
      row.tradingDays += 1;
      rows.set(period, row);
    }
    return [...rows.values()];
  };
  return { monthly: group(7), yearly: group(4) };
}

export interface PeriodReturn {
  /** "YYYY-MM" 或 "YYYY" */
  period: string;
  portfolio: number;
  benchmark: number;
  tradingDays: number;
}

/**
 * 實際組合的回撤期間統計（2026-10-07）：最大回撤與它的日期、在前高下方的交易日數、最長一段連續在
 * 前高下方的交易日數，以及期末距前高多少。水位從 1 開始，startDate（期間起點）也算前高。從沒跌過時
 * maxDrawdown 是 0、三個日期都是 null。
 */
export function drawdownStatistics(daily: readonly { date: string; r: number }[], startDate: string): {
  maxDrawdown: number;
  peakDate: string | null;
  troughDate: string | null;
  recoveryDate: string | null;
  underwaterDays: number;
  longestUnderwaterDays: number;
  currentDrawdown: number;
} {
  let level = 1;
  let peak = 1;
  // 起點（第一個有報酬那天的前一個交易日）也算前高，跟 portfolioRisk 的 maxDrawdown 一致。
  let peakDate: string | null = startDate;
  let worst = { depth: 0, peakDate: null as string | null, troughDate: null as string | null, peakLevel: 1 };
  let recoveryDate: string | null = null;
  let underwaterDays = 0;
  let run = 0;
  let longest = 0;
  for (const { date, r } of daily) {
    level *= 1 + r;
    if (level >= peak) {
      if (worst.troughDate !== null && recoveryDate === null && level >= worst.peakLevel) {
        recoveryDate = date;
      }
      peak = level;
      peakDate = date;
      run = 0;
      continue;
    }
    underwaterDays += 1;
    run += 1;
    longest = Math.max(longest, run);
    const depth = level / peak - 1;
    if (depth < worst.depth) {
      worst = { depth, peakDate, troughDate: date, peakLevel: peak };
      recoveryDate = null;
    }
  }
  return {
    maxDrawdown: worst.depth,
    peakDate: worst.troughDate === null ? null : worst.peakDate,
    troughDate: worst.troughDate,
    recoveryDate,
    underwaterDays,
    longestUnderwaterDays: longest,
    currentDrawdown: level / peak - 1,
  };
}

/**
 * 滾動 N 日（預設 60）的年化波動與對大盤的 beta，畫成趨勢線用（2026-10-07）。只用兩邊都有報酬的日子；
 * 第 N 天起才有值。
 */
export function rollingRisk(
  daily: readonly { date: string; r: number }[],
  marketCloses: ReadonlyMap<string, number>,
  calendar: readonly string[],
  baseDate: string,
  window: number,
): { date: string; volatility: number; beta: number | null }[] {
  const pairs = pairWithBenchmark(daily, marketCloses, calendar, baseDate);
  const out: { date: string; volatility: number; beta: number | null }[] = [];
  for (let end = window; end <= pairs.length; end++) {
    const slice = pairs.slice(end - window, end);
    const ps = slice.map((x) => x.p);
    const bs = slice.map((x) => x.b);
    const varB = sampleCovariance(bs, bs);
    out.push({
      date: slice.at(-1)!.date,
      volatility: Math.sqrt(sampleCovariance(ps, ps)) * Math.sqrt(TRADING_DAYS_PER_YEAR),
      beta: varB > 0 ? sampleCovariance(ps, bs) / varB : null,
    });
  }
  return out;
}

/**
 * 跟加權指數逐日比較（只用實際績效，不用回推——回推的報酬帶著事後挑股的偏誤）。
 *
 * - 上漲／下跌捕獲率：大盤上漲（下跌）的那些天，組合的**幾何平均日報酬** ÷ 大盤的幾何平均日報酬
 *   （Morningstar 的定義）。上漲捕獲 > 1、下跌捕獲 < 1 代表漲時跟得多、跌時跌得少。
 *   **不是整段複利相比**（研究文件寫的那個）：2026-10-07 用使用者真實帳本實測，大盤一年 +86%、上漲日複利
 *   +543%，組合同一批日子 +98.7%，整段相比只有 18%；但組合波動只有大盤一半，那個 18% 是複利把大盤那一側
 *   放大的結果，不是「只跟上兩成」。幾何平均把期間長短與複利效應拿掉，同一份資料是約 37%。
 * - Omega（門檻 0）：組合賺錢日子的報酬總和 ÷ 賠錢日子的報酬總和（取絕對值），不假設任何分佈。
 *
 * 只用兩邊都有報酬的日子；樣本天數一起回傳，門檻由呼叫端決定。
 */
export function compareWithBenchmark(
  daily: readonly { date: string; r: number }[],
  marketCloses: ReadonlyMap<string, number>,
  calendar: readonly string[],
  baseDate: string,
): { sampleDays: number; upCapture: number | null; downCapture: number | null; omega: number | null } {
  const pairs = pairWithBenchmark(daily, marketCloses, calendar, baseDate);
  const geometricMean = (xs: number[]) => Math.exp(xs.reduce((sum, x) => sum + Math.log1p(x), 0) / xs.length) - 1;
  const capture = (selected: { p: number; b: number }[]) => {
    if (selected.length === 0) {
      return null;
    }
    const benchmark = geometricMean(selected.map((x) => x.b));
    // 組合某天 −100%（全部歸零）時 log1p 是 −∞，幾何平均就是 −1，照實回傳。
    return benchmark === 0 ? null : geometricMean(selected.map((x) => x.p)) / benchmark;
  };
  const gains = pairs.reduce((sum, x) => sum + Math.max(x.p, 0), 0);
  const losses = pairs.reduce((sum, x) => sum + Math.max(-x.p, 0), 0);
  return {
    sampleDays: pairs.length,
    upCapture: capture(pairs.filter((x) => x.b > 0)),
    downCapture: capture(pairs.filter((x) => x.b < 0)),
    omega: losses > 0 ? gains / losses : null,
  };
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
  /** 起點之後才累計：期初部位是「本來就有」，不是這段期間的交易。 */
  let countingTrades = false;
  const trading = { buyAmount: 0, sellAmount: 0, fees: 0, taxes: 0 };
  /** 把交易日 ≤ date 的交易全部套用，回傳淨流入。 */
  /**
   * 回傳當天的**總流入**與**總流出**，分開算。2026-10-05 修過一次：原本只回淨額，同一天又買又賣
   * （當沖，或成本不明的取得與它要補的那筆賣出）會先互相抵銷，分母只剩手續費那一點點——收盤價高於
   * 賣價時算出 −100%，低於時整天被當成沒投資而跳過。流入算開盤前投入，所以分母要用總流入。
   */
  function applyThrough(date: string): { inflow: number; outflow: number } {
    let inflow = 0;
    let outflow = 0;
    while (cursor < entries.length && entries[cursor]!.tradeDate <= date) {
      const entry = entries[cursor++]!;
      const held = quantities.get(entry.symbol) ?? 0;
      // 只有真的成交價才能當後備估值：配股與成本不明的列價格是 0，記下來會讓沒有收盤價的那幾天市值變 0。
      if (entry.price > 0 && !entry.costUnknown) {
        lastTradePrice.set(entry.symbol, entry.price);
      }
      if (entry.action === "BUY") {
        quantities.set(entry.symbol, held + entry.quantity);
        // 成本不明的取得當成「以當天市值轉入」：流入等於轉入的市值，所以它本身不產生報酬。照價格 0 算的話，
        // 這些股票會像憑空出現，整筆市值變成當天的獲利（2026-10-05 實測：股價全不動的組合算出 +25%）。
        // 配股則照 0 算：它的流入真的是 0，剛好抵銷除權當天的股價下跌。
        const unitValue = entry.costUnknown
          ? (closeOnOrBefore(entry.symbol, date)?.price ?? lastTradePrice.get(entry.symbol) ?? 0)
          : entry.price;
        inflow += entry.quantity * unitValue + (entry.costUnknown ? 0 : entry.fee);
        if (countingTrades && !entry.costUnknown && entry.price > 0) {
          trading.buyAmount += entry.quantity * entry.price;
          trading.fees += entry.fee;
        }
      } else {
        const sold = Math.min(entry.quantity, held);
        if (sold === 0) {
          continue;
        }
        quantities.set(entry.symbol, held - sold);
        outflow += sold * entry.price - entry.fee - entry.tax;
        if (countingTrades) {
          trading.sellAmount += sold * entry.price;
          trading.fees += entry.fee;
          trading.taxes += entry.tax;
        }
      }
    }
    return { inflow, outflow };
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
  countingTrades = true;

  // 資金加權報酬的現金流（投資人角度：投入為負、取回為正）。期初部位當成起點那天投入。
  const flows: { date: string; amount: number }[] = previousValue > 0 ? [{ date: input.baseDate, amount: -previousValue }] : [];

  let growth = 1;
  let invested = false;
  const series: PortfolioReturn["series"] = [];
  const dailyReturns: PortfolioReturn["dailyReturns"] = [];
  const exposedValues: number[] = [];
  for (const date of input.calendar) {
    const { inflow, outflow } = applyThrough(date);
    const value = marketValue(date, true);
    const denominator = previousValue + inflow;
    if (denominator > 0) {
      const r = (value - previousValue - inflow + outflow) / denominator;
      growth *= 1 + r;
      invested = true;
      dailyReturns.push({ date, r });
    }
    if (inflow !== 0 || outflow !== 0) {
      flows.push({ date, amount: outflow - inflow });
    }
    if (invested) {
      exposedValues.push(value);
    }
    series.push({ date, cumulative: invested ? growth - 1 : null });
    previousValue = value;
  }

  const endDate = input.calendar.at(-1);
  if (endDate !== undefined && previousValue > 0) {
    flows.push({ date: endDate, amount: previousValue });
  }

  return {
    twr: invested ? growth - 1 : null,
    series,
    missingPriceDays,
    mwr: invested && endDate !== undefined ? moneyWeightedReturn(flows, input.baseDate, endDate) : null,
    dailyReturns,
    trading: {
      ...trading,
      averageMarketValue: exposedValues.length > 0 ? exposedValues.reduce((sum, v) => sum + v, 0) / exposedValues.length : null,
    },
  };
}
