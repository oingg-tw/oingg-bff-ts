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
 * ## 2026-10-07 加的第一批（使用者要求，依 conductor 的「全面投資組合評估指標體系」研究挑的）
 *
 * 全部是**風險或結構**，沒有報酬類——理由同上。這裡只算數學；「樣本太少就不給」的門檻是呈現規則，
 * 在 holdingsRisk.service.ts，所以這裡用短序列就能驗證每個指標的定義性質。
 *
 * - 下行半標準差：只算跌的日子，門檻 0（不是無風險利率——那要等利率來源定案，見 GOV 的回覆）。
 * - 潰瘍指數：每天距前高的跌幅取均方根，跌得深、泡得久都會讓它變大；最大回撤只看最深那一點。
 * - 歷史 VaR／CVaR（95%，單日）：直接取實際日報酬的第 5 百分位與它以下的平均，不假設常態分佈。
 *   康尼許－費雪修正不做：一年約 250 筆估偏態與峰態不穩（研究本身也提到極端值下會失效）。
 * - 風險貢獻：w_i × Cov(r_i, r_p) ÷ Var(r_p)，全部持股加總為 1（期中才上市的那幾檔讓它只近似成立）。
 * - 分散化比率：Σ w_i σ_i ÷ σ_p，≥ 1；越大代表相關性低、分散省掉越多波動。
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

/** 只看報酬分佈本身的風險（組合與大盤各一份）。報酬都是小數；VaR／CVaR 是報酬，通常 ≤ 0。 */
export interface DistributionRisk {
  /** 年化下行半標準差：√(平均 min(r, 0)²) × √252。 */
  downsideDeviation: number | null;
  /** 每天距前高跌幅（≤ 0）的均方根，小數。 */
  ulcerIndex: number | null;
  /** 單日 95% 歷史 VaR：日報酬由小到大第 ⌈5% × n⌉ 筆。 */
  valueAtRisk95: number | null;
  /** 單日 95% 歷史 CVaR：最差的那 ⌈5% × n⌉ 筆的平均。 */
  expectedShortfall95: number | null;
}

export interface PortfolioRisk {
  /** 同時有組合報酬與大盤報酬的交易日數。少於 2 天時所有指標都是 null。 */
  tradingDays: number;
  portfolio: {
    annualizedVolatility: number | null;
    beta: number | null;
    correlation: number | null;
    maxDrawdown: Drawdown;
  } & DistributionRisk;
  benchmark: {
    annualizedVolatility: number | null;
    maxDrawdown: Drawdown;
  } & DistributionRisk;
  /** Σ w_i σ_i ÷ σ_p。組合沒有波動時是 null。 */
  diversificationRatio: number | null;
  /** symbol → 佔組合變異數的比例，加總約為 1。沒參與（coverage none）的不列。 */
  riskContributions: Map<string, number>;
  /**
   * 兩兩之間的日報酬相關係數（2026-10-07），只用兩檔都有報酬的日子；少於 2 天的那一對是 null。
   * symbols 依權重由大到小，matrix[i][j] 對應 symbols[i] 與 symbols[j]，對角線是 1。
   */
  correlations: { symbols: string[]; matrix: (number | null)[][] };
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

const TAIL_PROBABILITY = 0.05;

function distributionRisk(returns: readonly number[]): DistributionRisk {
  if (returns.length < 2) {
    return { downsideDeviation: null, ulcerIndex: null, valueAtRisk95: null, expectedShortfall95: null };
  }
  const downside = Math.sqrt(mean(returns.map((r) => Math.min(r, 0) ** 2))) * Math.sqrt(TRADING_DAYS_PER_YEAR);

  let level = 1;
  let peak = 1;
  const squaredDrawdowns: number[] = [];
  for (const r of returns) {
    level *= 1 + r;
    peak = Math.max(peak, level);
    squaredDrawdowns.push((level / peak - 1) ** 2);
  }

  const sorted = [...returns].sort((a, b) => a - b);
  const tail = sorted.slice(0, Math.max(1, Math.ceil(returns.length * TAIL_PROBABILITY)));
  return {
    downsideDeviation: downside,
    ulcerIndex: Math.sqrt(mean(squaredDrawdowns)),
    valueAtRisk95: tail.at(-1)!,
    expectedShortfall95: mean(tail),
  };
}

/**
 * 類股配置（2026-10-07）：依現在的市值權重加總到每個類股，權重大的在前；有效類股數 ＝ 1 ÷ Σ類股權重²。
 * 查不到類股的（ETF、還沒分類的公司）歸在 sectorCode null 那一組，照實列出，不猜。
 */
export function sectorAllocation(
  weights: ReadonlyMap<string, number>,
  sectorOf: ReadonlyMap<string, { sectorCode: string | null; sectorName: string | null }>,
): { sectors: { sectorCode: string | null; sectorName: string | null; weight: number; symbols: string[] }[]; effectiveSectors: number | null } {
  const groups = new Map<string, { sectorCode: string | null; sectorName: string | null; weight: number; symbols: string[] }>();
  for (const [symbol, weight] of weights) {
    const sector = sectorOf.get(symbol) ?? { sectorCode: null, sectorName: null };
    const key = sector.sectorCode ?? "";
    const group = groups.get(key) ?? { sectorCode: sector.sectorCode, sectorName: sector.sectorName, weight: 0, symbols: [] };
    group.weight += weight;
    group.symbols.push(symbol);
    groups.set(key, group);
  }
  const sectors = [...groups.values()].sort((a, b) => b.weight - a.weight);
  const hhi = sectors.reduce((sum, g) => sum + g.weight ** 2, 0);
  return { sectors, effectiveSectors: hhi > 0 ? 1 / hhi : null };
}

/**
 * 組合層級的基本面（2026-10-07），全部只描述數字：
 *
 * - 近 12 個月股利收入 ＝ Σ 股數 × 每股股利（近 12 個月實際配發，不是預估）；殖利率 ＝ 收入 ÷ 有股利資料
 *   那幾檔的市值。
 * - 本益比、股價淨值比用**調和加權**：Σ市值 ÷ Σ(市值 ÷ 倍數)，等於「整個組合的價格 ÷ 整個組合分到的
 *   盈餘（淨值）」。算術平均會被一兩檔高本益比的股票拉高。交易所不公布虧損公司的本益比，所以那幾檔
 *   不在本益比裡——coverage 是有值那幾檔的市值佔比，前端要一起顯示。
 */
export function portfolioFundamentals(
  holdings: readonly { quantity: number; marketValue: number; dividendPerShare: number | null; peRatio: number | null; pbRatio: number | null }[],
): {
  dividendIncome: number | null;
  dividendYield: number | null;
  dividendCoverage: number;
  peRatio: number | null;
  peCoverage: number;
  pbRatio: number | null;
  pbCoverage: number;
} {
  const total = holdings.reduce((sum, h) => sum + h.marketValue, 0);
  const share = (value: number) => (total > 0 ? value / total : 0);
  const withDividend = holdings.filter((h) => h.dividendPerShare !== null);
  const income = withDividend.reduce((sum, h) => sum + h.quantity * h.dividendPerShare!, 0);
  const dividendValue = withDividend.reduce((sum, h) => sum + h.marketValue, 0);
  const harmonic = (pick: (h: (typeof holdings)[number]) => number | null) => {
    const usable = holdings.filter((h) => (pick(h) ?? 0) > 0);
    const value = usable.reduce((sum, h) => sum + h.marketValue, 0);
    const earnings = usable.reduce((sum, h) => sum + h.marketValue / pick(h)!, 0);
    return { ratio: earnings > 0 ? value / earnings : null, coverage: share(value) };
  };
  const pe = harmonic((h) => h.peRatio);
  const pb = harmonic((h) => h.pbRatio);
  return {
    dividendIncome: withDividend.length > 0 ? income : null,
    dividendYield: dividendValue > 0 ? income / dividendValue : null,
    dividendCoverage: share(dividendValue),
    peRatio: pe.ratio,
    peCoverage: pe.coverage,
    pbRatio: pb.ratio,
    pbCoverage: pb.coverage,
  };
}

/** 有效持股數相關的集中度：HHI ＝ Σw²，有效持股數 ＝ 1 ÷ HHI，以及最大三檔的權重合計。 */
export function concentration(weights: readonly number[]): { hhi: number; effectiveHoldings: number; topThreeWeight: number } | null {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) {
    return null;
  }
  const normalized = weights.map((w) => w / total);
  const hhi = normalized.reduce((sum, w) => sum + w * w, 0);
  const topThreeWeight = [...normalized].sort((a, b) => b - a).slice(0, 3).reduce((sum, w) => sum + w, 0);
  return { hhi, effectiveHoldings: 1 / hhi, topThreeWeight };
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

function correlationMatrix(
  input: PortfolioRiskInput,
  perSymbol: ReadonlyMap<string, { returns: (number | null)[] }>,
  dayIndexes: readonly number[],
): { symbols: string[]; matrix: (number | null)[][] } {
  const symbols = [...input.weights].sort(([, a], [, b]) => b - a).map(([symbol]) => symbol);
  const matrix = symbols.map((a, i) =>
    symbols.map((b, j) => {
      if (i === j) {
        return 1;
      }
      const ra = perSymbol.get(a)!.returns;
      const rb = perSymbol.get(b)!.returns;
      const xs: number[] = [];
      const ys: number[] = [];
      for (const day of dayIndexes) {
        const x = ra[day];
        const y = rb[day];
        if (x !== null && x !== undefined && y !== null && y !== undefined) {
          xs.push(x);
          ys.push(y);
        }
      }
      if (xs.length < 2) {
        return null;
      }
      const vx = covariance(xs, xs);
      const vy = covariance(ys, ys);
      return vx > 0 && vy > 0 ? covariance(xs, ys) / Math.sqrt(vx * vy) : null;
    }),
  );
  return { symbols, matrix };
}

export function computePortfolioRisk(input: PortfolioRiskInput): PortfolioRisk {
  const perSymbol = new Map([...input.weights.keys()].map((symbol) => [symbol, dailyReturns(input, symbol)]));
  const market = marketReturns(input);

  const dates: string[] = [];
  const portfolio: number[] = [];
  const benchmark: number[] = [];
  /** 納入計算的那些天在 calendar 裡的位置，給風險貢獻對齊每一檔自己的報酬用。 */
  const dayIndexes: number[] = [];
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
      dayIndexes.push(i);
      portfolio.push(weighted / weightSum);
      benchmark.push(m);
    }
  });

  const n = portfolio.length;
  const coverage = new Map([...perSymbol].map(([symbol, s]) => [symbol, s.coverage]));
  if (n < 2) {
    const flat: Drawdown = { depth: 0, peakDate: null, troughDate: null, recoveryDate: null };
    const none = distributionRisk([]);
    return {
      tradingDays: n,
      portfolio: { annualizedVolatility: null, beta: null, correlation: null, maxDrawdown: flat, ...none },
      benchmark: { annualizedVolatility: null, maxDrawdown: flat, ...none },
      diversificationRatio: null,
      riskContributions: new Map(),
      correlations: { symbols: [], matrix: [] },
      coverage,
    };
  }

  const varP = covariance(portfolio, portfolio);
  const varM = covariance(benchmark, benchmark);
  const cov = covariance(portfolio, benchmark);
  const annualize = Math.sqrt(TRADING_DAYS_PER_YEAR);

  // 每一檔跟組合的共變異數，只用它自己有報酬的那些天（期中才上市的那幾檔只有後段）。
  const riskContributions = new Map<string, number>();
  let weightedVolatility = 0;
  for (const [symbol, weight] of input.weights) {
    const own = perSymbol.get(symbol)!.returns;
    const xs: number[] = [];
    const ys: number[] = [];
    dayIndexes.forEach((dayIndex, k) => {
      const r = own[dayIndex];
      if (r !== null && r !== undefined) {
        xs.push(r);
        ys.push(portfolio[k]!);
      }
    });
    if (xs.length < 2) {
      continue;
    }
    weightedVolatility += weight * Math.sqrt(covariance(xs, xs));
    if (varP > 0) {
      riskContributions.set(symbol, (weight * covariance(xs, ys)) / varP);
    }
  }

  return {
    tradingDays: n,
    portfolio: {
      annualizedVolatility: Math.sqrt(varP) * annualize,
      beta: varM > 0 ? cov / varM : null,
      correlation: varP > 0 && varM > 0 ? cov / Math.sqrt(varP * varM) : null,
      maxDrawdown: maxDrawdown(startDate, dates, portfolio),
      ...distributionRisk(portfolio),
    },
    benchmark: {
      annualizedVolatility: Math.sqrt(varM) * annualize,
      maxDrawdown: maxDrawdown(startDate, dates, benchmark),
      ...distributionRisk(benchmark),
    },
    diversificationRatio: varP > 0 ? weightedVolatility / Math.sqrt(varP) : null,
    riskContributions,
    correlations: correlationMatrix(input, perSymbol, dayIndexes),
    coverage,
  };
}
