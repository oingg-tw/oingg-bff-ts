/**
 * 「現在的持股」回推的風險指標（使用者 2026-10-05 要求，選了這個做法）。
 *
 * **做法**：拿現在每一檔的市值比例，當成整段期間每天都維持的比例，套用每一檔過去的日報酬，得到一條
 * 「如果這組持股一直都是這樣」的組合日報酬。描述的是**你現在手上這組**的風險，而不是過去那個組合——
 * 也不必等使用者自己累積持股歷史（使用者的帳本 22 個月，但前期只有一兩檔）。一般投資工具評估組合風險
 * 也是這樣做。
 *
 * **只給風險，刻意不給報酬與夏普比率**：這組持股是事後選的，回推的報酬會偏高（看起來比實際會選股），
 * 那是一個看起來正常的誤導數字。報酬請看 /holdings/performance 的真實期間報酬。
 *
 * ## 規則
 *
 * - **除權（配股）要還原**：除權當天股價依配股比例下跌（5314 從 61.3 掉到約 14.7），那不是虧損——股數同時
 *   變多了。所以除權那天的報酬是 收盤 × (1 + 每股配股數) ÷ 前一個收盤 − 1。**現金股利不還原**，跟價格型的
 *   加權指數口徑一致。除權日剛好沒成交時，還原延到下一個真的有收盤價的日子。
 * - 沒成交、停牌的日子沿用前一個收盤價（那天報酬 0），下一個有收盤價的日子補上整段變動。
 * - **期間內還沒上市（或還沒有股價）的那幾天**，那一檔不參與，其他持股的比例重新分配；每一檔的資料起始日
 *   會列出來，讓前端照實註明。
 * - 年化：日標準差 × √252（業界慣例；台股一年的交易日實際約 245～250 天，差異約 1%）。
 *
 * 純函式：不碰網路、不碰資料庫。
 */

export interface PortfolioRiskInput {
  /** symbol → 權重（現在的市值比例，加總為 1）。 */
  weights: ReadonlyMap<string, number>;
  /** 期間內的交易日，升冪；baseDate 是它前一個交易日。 */
  calendar: readonly string[];
  baseDate: string;
  /** symbol → (tradeDate → close)，只放真的有收盤價的日子。 */
  closes: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** symbol → [除權日, 每股配股數]。 */
  stockDividends: ReadonlyMap<string, readonly (readonly [string, number])[]>;
  /** 加權指數 tradeDate → close。 */
  marketCloses: ReadonlyMap<string, number>;
}

export interface Drawdown {
  /** 最大跌幅（≤ 0 的小數）。期間內從來沒跌過時是 0、日期都是 null。 */
  depth: number;
  peakDate: string | null;
  troughDate: string | null;
  /** 回到前高的那一天；期間結束時還沒回到前高就是 null。 */
  recoveryDate: string | null;
}

export interface PortfolioRisk {
  /** 同時有組合報酬與大盤報酬的交易日數。少於 2 天時所有指標都是 null。 */
  tradingDays: number;
  portfolio: {
    annualizedVolatility: number | null;
    beta: number | null;
    correlation: number | null;
    maxDrawdown: Drawdown;
  };
  benchmark: {
    annualizedVolatility: number | null;
    maxDrawdown: Drawdown;
  };
  /** 每一檔的資料涵蓋範圍，讓前端照實註明哪幾檔不是整段都有參與。 */
  coverage: Map<string, Coverage>;
}

/**
 * full：期間一開始就有股價。partial：期間中才有（例如中途上市），firstPriceDate 是它開始參與的那天。
 * none：整段都沒有股價，完全沒參與（權重分給其他持股）。
 */
export type Coverage = { kind: "full" } | { kind: "partial"; firstPriceDate: string } | { kind: "none" };

const TRADING_DAYS_PER_YEAR = 252;

function mean(xs: readonly number[]): number {
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

/** 樣本共變異數（n − 1）。 */
function covariance(xs: readonly number[], ys: readonly number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += (xs[i]! - mx) * (ys[i]! - my);
  }
  return sum / (xs.length - 1);
}

/**
 * 從 startDate（水位 1）開始逐日累乘，找出最深的一次下跌；再往後找回到那次前高的日子。
 * 起點也算前高：期間第一天就下跌時，前高是 startDate。
 */
function maxDrawdown(startDate: string, dates: readonly string[], returns: readonly number[]): Drawdown {
  const levels = [1];
  for (const r of returns) {
    levels.push(levels.at(-1)! * (1 + r));
  }
  const dateAt = (i: number) => (i === 0 ? startDate : dates[i - 1]!);

  let peakIndex = 0;
  let worst = { depth: 0, peakIndex: -1, troughIndex: -1 };
  for (let i = 1; i < levels.length; i++) {
    if (levels[i]! >= levels[peakIndex]!) {
      peakIndex = i;
      continue;
    }
    const depth = levels[i]! / levels[peakIndex]! - 1;
    if (depth < worst.depth) {
      worst = { depth, peakIndex, troughIndex: i };
    }
  }
  if (worst.troughIndex < 0) {
    return { depth: 0, peakDate: null, troughDate: null, recoveryDate: null };
  }
  const peakLevel = levels[worst.peakIndex]!;
  const recovery = levels.findIndex((level, i) => i > worst.troughIndex && level >= peakLevel);
  return {
    depth: worst.depth,
    peakDate: dateAt(worst.peakIndex),
    troughDate: dateAt(worst.troughIndex),
    recoveryDate: recovery < 0 ? null : dateAt(recovery),
  };
}

/**
 * 一檔的日報酬序列：在 [baseDate, ...calendar] 上沿用收盤價、還原除權。還沒有任何收盤價的日子是 null（不參與）。
 * 回傳的陣列對齊 calendar（不含 baseDate）。
 */
function dailyReturns(
  input: PortfolioRiskInput,
  symbol: string,
): { returns: (number | null)[]; coverage: Coverage } {
  const byDate = input.closes.get(symbol) ?? new Map<string, number>();
  const sorted = [...byDate].sort(([a], [b]) => a.localeCompare(b));
  const events = [...(input.stockDividends.get(symbol) ?? [])].sort(([a], [b]) => a.localeCompare(b));

  let cursor = 0;
  let last: number | undefined;
  // 起點的價格：baseDate 當天或之前最近的收盤（抓價時多抓了幾天，就是為了這裡）。
  while (cursor < sorted.length && sorted[cursor]![0] <= input.baseDate) {
    last = sorted[cursor++]![1];
  }
  let eventCursor = 0;
  while (eventCursor < events.length && events[eventCursor]![0] <= input.baseDate) {
    eventCursor++; // 起點以前的除權已經反映在起點價格裡
  }

  let pending = 1;
  const coveredFromStart = last !== undefined;
  let firstPriceDate: string | undefined;
  const returns: (number | null)[] = [];
  for (const date of input.calendar) {
    while (eventCursor < events.length && events[eventCursor]![0] <= date) {
      pending *= 1 + events[eventCursor++]![1];
    }
    const close = byDate.get(date);
    if (close === undefined) {
      // 沒成交或停牌：還沒有任何價格就不參與；有的話沿用，報酬 0（除權還原留到下一個真的收盤日）。
      returns.push(last === undefined ? null : 0);
      continue;
    }
    if (last === undefined) {
      // 這一檔在期間內的第一個收盤價：當作起點，這天本身沒有報酬。
      last = close;
      pending = 1;
      firstPriceDate ??= date;
      returns.push(null);
      continue;
    }
    returns.push((close * pending) / last - 1);
    last = close;
    pending = 1;
  }
  const coverage: Coverage = coveredFromStart
    ? { kind: "full" }
    : firstPriceDate === undefined
      ? { kind: "none" }
      : { kind: "partial", firstPriceDate };
  return { returns, coverage };
}

function marketReturns(input: PortfolioRiskInput): (number | null)[] {
  let last = input.marketCloses.get(input.baseDate);
  return input.calendar.map((date) => {
    const close = input.marketCloses.get(date);
    if (close === undefined || last === undefined) {
      if (close !== undefined) {
        last = close;
      }
      return null;
    }
    const r = close / last - 1;
    last = close;
    return r;
  });
}

export function computePortfolioRisk(input: PortfolioRiskInput): PortfolioRisk {
  const perSymbol = new Map([...input.weights.keys()].map((symbol) => [symbol, dailyReturns(input, symbol)]));
  const market = marketReturns(input);

  const dates: string[] = [];
  const portfolio: number[] = [];
  const benchmark: number[] = [];
  // 最大回撤的起點：第一個有報酬的交易日的前一天（通常就是 baseDate）。
  let startDate = input.baseDate;
  input.calendar.forEach((date, i) => {
    // 當天有報酬的持股依權重加權，權重在它們之間重新正規化（還沒上市的那幾檔不參與）。
    let weighted = 0;
    let weightSum = 0;
    for (const [symbol, weight] of input.weights) {
      const r = perSymbol.get(symbol)!.returns[i];
      if (r !== null && r !== undefined) {
        weighted += weight * r;
        weightSum += weight;
      }
    }
    const m = market[i];
    if (weightSum > 0 && m !== null && m !== undefined) {
      if (dates.length === 0) {
        startDate = i === 0 ? input.baseDate : input.calendar[i - 1]!;
      }
      dates.push(date);
      portfolio.push(weighted / weightSum);
      benchmark.push(m);
    }
  });

  const n = portfolio.length;
  const coverage = new Map([...perSymbol].map(([symbol, s]) => [symbol, s.coverage]));
  if (n < 2) {
    const flat: Drawdown = { depth: 0, peakDate: null, troughDate: null, recoveryDate: null };
    return {
      tradingDays: n,
      portfolio: { annualizedVolatility: null, beta: null, correlation: null, maxDrawdown: flat },
      benchmark: { annualizedVolatility: null, maxDrawdown: flat },
      coverage,
    };
  }

  const varP = covariance(portfolio, portfolio);
  const varM = covariance(benchmark, benchmark);
  const cov = covariance(portfolio, benchmark);
  const annualize = Math.sqrt(TRADING_DAYS_PER_YEAR);
  return {
    tradingDays: n,
    portfolio: {
      annualizedVolatility: Math.sqrt(varP) * annualize,
      beta: varM > 0 ? cov / varM : null,
      correlation: varP > 0 && varM > 0 ? cov / Math.sqrt(varP * varM) : null,
      maxDrawdown: maxDrawdown(startDate, dates, portfolio),
    },
    benchmark: {
      annualizedVolatility: Math.sqrt(varM) * annualize,
      maxDrawdown: maxDrawdown(startDate, dates, benchmark),
    },
    coverage,
  };
}
