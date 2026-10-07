/**
 * GET /holdings 的一列。
 *
 * **2026-10-05 起這不是一列資料庫紀錄，而是交易紀錄的投影**（見 domain/holdingProjection.ts）。
 * 所以舊契約的 `id`、`note`、`createdAt`、`updatedAt` 都消失了：它們是那一列的屬性，而那一列不存在了。
 * 這個資源現在的鍵是 symbol——本來也是（舊表的 unique constraint 就是 (firebaseUid, symbol)）。
 *
 * 金額維持字串，跟舊契約一樣：前端照字串顯示就不會踩到 JSON number 的精度，而且跟
 * StockTransaction 的 price/fee/tax 一致。小數位固定 4 位，對齊交易紀錄的 `Decimal(18,4)` 欄位。
 */
export interface Holding {
  symbol: string;
  /** 總股數，含自動配股與成本不明的股數。 */
  quantity: number;
  /** 其中成本不明的股數（使用者 2026-10-05 決定的「成本不明」）。平常是 0。 */
  costUnknownQuantity: number;
  /**
   * 剩下的**成本已知那幾批**的平均成本（總成本 ÷ 股數），含買進手續費。成本法是先進先出。
   *
   * 全部股數都成本不明時是 **null**，不是 "0.0000"——0 會被讀成「免費取得」，而成本不明的意思是
   * 「不知道」。部分成本不明時，這個均價只代表 `quantity − costUnknownQuantity` 那幾股。
   */
  averageCost: string | null;
  /** 成本已知那部分的總成本（`(quantity − costUnknownQuantity) × averageCost`）。 */
  totalCost: string;
  /**
   * 這個代號到目前為止的已實現損益（賣出價金 − 賣出手續費 − 交易稅 − 賣出股數 × 當時均價）。
   * 可以是負數。**已出清的代號不會出現在清單裡**，所以它那段已實現損益在這裡看不到——
   * 要看已出清的、或只看某段期間的，用 GET /holdings/realized。
   */
  realizedProfitLoss: string;
}

/**
 * GET /holdings/realized 的回應：指定區間內**每一檔有賣出**的已實現損益，含已出清的代號。
 *
 * 跟 GET /holdings 分開的理由：GET /holdings 的每一列是「現在」的部位（股數、均價），而這裡是一個
 * **區間**的損益。把兩個時間尺度塞進同一列（web-nuxt 原本提的 includeClosed + from/to 方案）會讓
 * 「股數是今天的、已實現損益是去年的」並排出現，讀的人很難不誤會。
 */
export interface RealizedProfitLossReport {
  /** 原樣回傳請求的區間；省略時是 null（＝全部期間）。 */
  from: string | null;
  to: string | null;
  /**
   * 依 symbol 升冪。只有區間內至少一筆賣出的代號才會出現。
   *
   * `excludedSellCount`／`excludedShares`：賣掉的股數裡有成本不明的部分，那部分**不計入**
   * realizedProfitLoss（使用者 2026-10-05 決定）。一筆賣出只要碰到成本不明的股數就算一筆；
   * 同時碰到成本已知的股數時，已知那部分照常計入。
   */
  symbols: { symbol: string; realizedProfitLoss: string; excludedSellCount: number; excludedShares: number }[];
  /** 上面各列（已四捨五入到 4 位）的加總，所以畫面上的列一定加得起來等於它。 */
  totalRealizedProfitLoss: string;
  /** 全部代號合計。前端用來顯示「N 筆成本不明，未計入」。 */
  excludedSellCount: number;
  excludedShares: number;
  /**
   * 區間內賣出的描述統計（2026-10-07）。只算成本已知的部分；整筆成本不明的賣出不計勝負。金額 4 位、
   * 比率 6 位小數字串，平均持有天數依股數加權（配股那一批從除權日起算）。沒有賣出時數值都是 null。
   * profitFactor ＝ 賺錢總額 ÷ |賠錢總額|，沒有賠錢的筆數時是 null。
   */
  tradeStats: {
    sellCount: number;
    winCount: number;
    lossCount: number;
    winRate: string | null;
    averageWin: string | null;
    averageLoss: string | null;
    profitFactor: string | null;
    averageHoldingDays: string | null;
  };
}

/**
 * GET /holdings/performance 的回應：持股組合在一段期間的時間加權報酬（TWR），用來跟大盤比。
 * 計算規則見 domain/portfolioReturn.ts。報酬率都是**小數字串**（"0.123456" = 12.3456%），6 位。
 */
export interface PortfolioPerformanceReport {
  /** 實際採用的期間（套用預設值之後），兩端都含。 */
  from: string;
  to: string;
  /** 整段期間都沒有曝險時是 null——那不是「報酬 0」，是沒有東西可以算。 */
  twr: string | null;
  /**
   * 期間內每個交易日（以加權指數的交易日為準，所以跟 /market/taiex-daily-price 逐日對得上）收盤後的
   * 累積報酬，舊到新。第一次有曝險之前的日子是 null。
   */
  series: { date: string; cumulative: string | null }[];
  /** 有持股但當天沒有收盤價（沿用前一個收盤價、或退回交易價）的天數，依 symbol 升冪。 */
  missingPrices: { symbol: string; dates: number }[];
  /**
   * 資金加權報酬（IRR），換算成整段期間的報酬、跟 twr 同一個尺度。twr 是「選股的報酬」，mwr 是「你的錢
   * 實際賺了多少」，差距就是進出場時機的影響。現金流口徑同 twr（不含現金股利）。算不出來時是 null。
   */
  mwr: string | null;
  /**
   * 年化值。**期間不滿 365 天時兩個都是 null**：把幾個月的報酬年化會把運氣放大成看起來穩定的年報酬。
   */
  annualized: { twr: string | null; mwr: string | null };
  /**
   * 期間內的交易與成本（元，整數字串）。買進只算真的成交，成本不明的取得與配股不算。
   * turnover ＝ min(買進, 賣出) ÷ 平均市值；costRatio ＝ (手續費 ＋ 證交稅) ÷ 平均市值，都是整段期間的值、
   * 不年化。沒有曝險時這兩個是 null。
   */
  trading: {
    buyAmount: string;
    sellAmount: string;
    fees: string;
    taxes: string;
    averageMarketValue: string | null;
    turnover: string | null;
    costRatio: string | null;
  };
  /**
   * 跟加權指數逐日比較（只用實際績效）。上漲／下跌捕獲率：大盤上漲（下跌）那些天，組合的幾何平均日報酬 ÷
   * 大盤的幾何平均日報酬（Morningstar 定義，不受期間長短與複利放大影響）；Omega（門檻 0）：賺錢日報酬總和 ÷ 賠錢日報酬總和。sampleDays 是兩邊都有報酬的天數，
   * 少於 120 天時三個值都是 null。
   */
  benchmarkComparison: { sampleDays: number; upCapture: string | null; downCapture: string | null; omega: string | null };
  /**
   * 經風險調整的報酬（只用實際績效，全部年化，6 位小數字串）：夏普、索提諾、卡瑪（年化 twr ÷ |實際最大跌幅|，
   * 期間不滿 365 天時是 null）、M²（年化報酬）、beta 與詹森 α（對大盤超額報酬回歸）、追蹤誤差、資訊比率。
   * sampleDays 少於 120、或無風險利率取不到（riskFree 是 null）時，全部是 null。
   */
  riskAdjusted: {
    sampleDays: number;
    sharpe: string | null;
    sortino: string | null;
    calmar: string | null;
    m2: string | null;
    beta: string | null;
    jensenAlpha: string | null;
    trackingError: string | null;
    informationRatio: string | null;
  };
  /**
   * 實際用到的無風險利率：五大銀行一年期定存（年利率 %，1.7 ＝ 1.7%）。`rates` 逐月列出期間內每個月套用的
   * 利率；`sourcePeriod` 跟 `period` 不同就是那個月還沒有資料、沿用了較早的月份（CBC 月報落後一到兩個月）。
   * 取不到時整個是 null——那時 riskAdjusted 全是 null，其他欄位照常。
   */
  riskFree: {
    source: "five-major-bank-1y-deposit";
    latestPeriod: string | null;
    rates: { period: string; ratePct: number; sourcePeriod: string }[];
  } | null;
  /**
   * 月報酬與年報酬表（2026-10-07），組合對加權指數。同一列的兩個數字涵蓋同一批交易日（兩邊都有報酬的
   * 日子）；期間頭尾可能不是整月／整年，看 tradingDays。報酬是 6 位小數字串。
   */
  periodReturns: {
    monthly: { period: string; portfolio: string; benchmark: string; tradingDays: number }[];
    yearly: { period: string; portfolio: string; benchmark: string; tradingDays: number }[];
  };
  /**
   * 實際組合的回撤期間統計。peakDate 可能是期間起點（第一個有報酬那天的前一個交易日）。underwaterDays：
   * 在前高下方的交易日數；longestUnderwaterDays：最長一段連續在前高下方的交易日數；currentDrawdown：期末距前高
   * （≤ 0）。沒有曝險時整個是 null。
   */
  drawdown: {
    maxDrawdown: string;
    peakDate: string | null;
    troughDate: string | null;
    recoveryDate: string | null;
    underwaterDays: number;
    longestUnderwaterDays: number;
    currentDrawdown: string;
  } | null;
  /** 滾動 60 個交易日的年化波動與 beta（實際組合對大盤），第 60 天起才有點。 */
  rolling: { windowDays: number; series: { date: string; volatility: string; beta: string | null }[] };
}

/**
 * GET /holdings/risk 的回應：**用現在的持股回推**的風險指標（使用者 2026-10-05 選的做法）。算法見
 * domain/portfolioRisk.ts。小數都是 6 位小數字串；波動度、回撤是小數（"0.234567" = 23.4567%）。
 *
 * 刻意沒有報酬與夏普比率：這組持股是事後選的，回推的報酬會偏高。報酬請看 /holdings/performance。
 */
export interface PortfolioRiskReport {
  from: string;
  to: string;
  /** 用來計算的交易日數。統計誤差跟它有關，前端應該一起顯示（例如少於約 60 天時波動度參考價值很低）。 */
  tradingDays: number;
  /** 權重用的是哪一天的收盤價（各持股最新收盤日中最晚的那天）。沒有持股時是 null。 */
  weightsAsOf: string | null;
  /** 現在持股的總市值（股數 × 最新收盤，元，整數字串）。VaR／CVaR 的金額就是拿它乘的。 */
  marketValue: string | null;
  portfolio: {
    annualizedVolatility: string | null;
    beta: string | null;
    correlation: string | null;
    maxDrawdown: DrawdownView;
    /** VaR／CVaR 換成金額（元，整數字串，通常 ≤ 0）：以現在的市值，最差 5% 的日子單日會少多少。 */
    valueAtRisk95Amount: string | null;
    expectedShortfall95Amount: string | null;
  } & DistributionRiskView;
  /** 同一段期間的加權指數，給前端並排比較。 */
  benchmark: {
    annualizedVolatility: string | null;
    maxDrawdown: DrawdownView;
  } & DistributionRiskView;
  /**
   * 集中度，只看現在的市值權重（不需要股價歷史，所以永遠有值，除非沒有持股）。
   * effectiveHoldings ＝ 1 ÷ HHI：「有 26 檔，實際上等於平均分散在幾檔」。
   */
  concentration: { hhi: string; effectiveHoldings: string; topThreeWeight: string } | null;
  /**
   * 分散化比率 Σ w_i σ_i ÷ σ_p（≥ 1，純數）。樣本少於 120 個交易日時是 null——共變異數估不穩。
   */
  diversificationRatio: string | null;
  /**
   * 現在的每一檔持股與它在回推裡的權重。coverage：full＝整段都有股價；partial＝期間中才有（firstPriceDate
   * 之前不參與，權重分給其他持股）；none＝整段都沒有股價、沒參與（weight 也是 null）。
   */
  holdings: {
    symbol: string;
    weight: string | null;
    coverage: "full" | "partial" | "none";
    firstPriceDate: string | null;
    /**
     * 佔組合變異數的比例（小數，全部加總約為 1；期中才有股價的那幾檔讓它只近似成立）。權重 5% 的股票可能
     * 貢獻 20% 的波動。樣本少於 120 個交易日、或這一檔沒參與時是 null。
     */
    riskContribution: string | null;
  }[];
  /**
   * 類股配置（2026-10-07），依現在市值權重，權重大的在前。sectorCode／sectorName 是 null 的那組是查不到類股的
   * （ETF、還沒分類的公司）。effectiveSectors ＝ 1 ÷ Σ類股權重²。類股資料取不到時整個是 null。
   */
  sectors: {
    effectiveSectors: string | null;
    groups: { sectorCode: string | null; sectorName: string | null; weight: string; symbols: string[] }[];
  } | null;
  /**
   * 組合層級的基本面（2026-10-07），只描述數字。dividendIncome：近 12 個月每股股利 × 現有股數（元，整數字串，
   * 是過去實際配發，不是預估）；dividendYield ＝ 收入 ÷ 有股利資料那幾檔的市值。peRatio／pbRatio 是調和加權
   * （組合價格 ÷ 組合分到的盈餘／淨值），交易所不公布虧損公司的本益比，所以那幾檔不在本益比裡。
   * …Coverage 是有值那幾檔的市值佔比，前端要一起顯示。資料取不到時整個是 null。
   */
  fundamentals: {
    dividendIncome: string | null;
    dividendYield: string | null;
    dividendCoverage: string;
    peRatio: string | null;
    peCoverage: string;
    pbRatio: string | null;
    pbCoverage: string;
  } | null;
  /**
   * 兩兩之間的日報酬相關係數（回推），symbols 依權重由大到小，matrix[i][j] 對應 symbols[i] 與 symbols[j]、
   * 對角線是 "1.000000"。樣本少於 120 個交易日時整個是 null。
   */
  correlations: { symbols: string[]; matrix: (string | null)[][] } | null;
}

/**
 * 2026-10-07 加的分佈型風險。下行半標準差年化、門檻 0；潰瘍指數是每天距前高跌幅的均方根；VaR／CVaR 是
 * 單日 95% 歷史值（報酬，通常 ≤ 0），樣本少於 100 個交易日時是 null（尾端只剩不到 5 筆）。
 */
export interface DistributionRiskView {
  downsideDeviation: string | null;
  ulcerIndex: string | null;
  valueAtRisk95: string | null;
  expectedShortfall95: string | null;
}

/**
 * GET /holdings/stress 的回應（2026-10-07）：**用現在的持股**回推過去幾次大跌，各段是加權指數從高點到低點
 * （日期是實際收盤找出來的）。問的是「這組持股遇到那樣的跌勢會跌多少」，不是預測，也不是當時的你。
 * 權重每天維持現在的比例（等於每天再平衡），所以跟「當時買進後放著不動」不同：2026-10-07 使用者的組合在
 * 2022 那段回推是 +3.6%、不再平衡是 +9.1%，主因是 2364 那段期間漲了 355%（逐日上漲，不是減資跳空）。
 * 單一持股可以主導整段結果，前端最好一起顯示各持股自己的漲跌（目前回應沒有，需要再說）。
 *
 * coveredWeight：當時就已經有股價的持股佔現在市值的比例。還沒上市的那幾檔不參與、比例分給其他持股，
 * 列在 notCovered，前端要照實註明（例如「你現在 12% 的持股在 2020 年還沒上市」）。
 * 期間比股價能回溯的深度還早時 available 是 false，數值都是 null。
 */
export interface StressScenariosReport {
  weightsAsOf: string | null;
  scenarios: {
    key: string;
    name: string;
    peakDate: string;
    troughDate: string;
    available: boolean;
    portfolio: { periodReturn: string | null; maxDrawdown: string | null };
    benchmark: { periodReturn: string | null };
    coveredWeight: string | null;
    notCovered: { symbol: string; coverage: "partial" | "none"; firstPriceDate: string | null }[];
    /**
     * 每一檔的表現（2026-10-07，web-nuxt 要列出前三大貢獻）。weight 是現在的權重；periodReturn 是它自己在
     * 這段期間的報酬；contribution 是逐日歸因，**全部加總剛好等於 portfolio.periodReturn**（不是 weight ×
     * periodReturn——每天維持比例的回推裡那個加不回去）。依 |contribution| 由大到小，沒參與的排最後、兩個值是 null。
     */
    holdings: { symbol: string; weight: string; periodReturn: string | null; contribution: string | null }[];
  }[];
}

export interface DrawdownView {
  /** 最大跌幅（≤ 0）。期間內從來沒跌過時是 "0.000000"、日期都是 null。 */
  depth: string;
  peakDate: string | null;
  troughDate: string | null;
  /** 回到前高的那一天；期間結束時還沒回到就是 null。 */
  recoveryDate: string | null;
}
