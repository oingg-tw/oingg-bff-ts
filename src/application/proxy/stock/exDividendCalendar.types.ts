import type { ExDividendNoticeEntry } from "@/application/proxy/stock/exDividendNotices.types.js";

/**
 * "announced" = a TWSE/TPEx advance notice for an ex-date >= today; "realized" = an actual MOPS dividend
 * distribution for an ex-date < today. Added by analysis-ts 2026-09-22 (cf1b752e) when the calendar
 * gained past-month coverage — before that every entry was implicitly an announcement.
 */
export type ExDividendCalendarStatus = "announced" | "realized";

/**
 * Same fields as ExDividendNoticeEntry (one entry = one company's one ex-dividend/ex-rights event), plus
 * `symbol`/`companyName` since this is a flat market-wide list, not grouped per symbol like
 * GET /stocks/ex-dividend-notices. `companyName` stays nullable for safety, but upstream now fills it for
 * ETFs too — 2026-09-30 re-measured 396/396 ETF rows across 2026-06~09 all have a name. (The old note here
 * said analysis-ts's company reference table didn't cover ETFs, measured 2026-09-10 on 00939/00984D; that
 * stopped being true at some point in between and nobody noticed, because a stale "this is always null"
 * note costs nothing until someone builds on it.)
 *
 * `status`/`paymentDate`/`fiscalYear` (2026-09-22): the two statuses come from different upstream sources
 * and carry different fields — `paymentDate`/`fiscalYear` are only populated on "realized" rows, and on
 * those rows the rights-offering fields inherited from ExDividendNoticeEntry (subscriptionRatio,
 * subscriptionPricePerShare, sharesOffered, sharesEmpOwner, sharesholderOwner, stockHoldingRatio) are
 * always null (MOPS distribution records don't carry them). Confirmed live on 2026-08 (268 realized rows)
 * vs. 2026-10 (17 announced rows).
 */
export interface ExDividendCalendarEntry extends ExDividendNoticeEntry {
  symbol: string;
  companyName: string | null;
  status: ExDividendCalendarStatus;
  /** "YYYY-MM-DD" — realized rows only, null on announced. */
  paymentDate: string | null;
  /** Fiscal year (西元) the dividend belongs to — realized rows only, null on announced. */
  fiscalYear: number | null;
  /**
   * "ETF" or "COMMON". 2026-09-30: the three fields below are populated for ETF rows and null for every
   * COMMON row (measured 110/110 COMMON rows null, 96/96 ETF rows populated, 2026-09).
   */
  securityType: ExDividendCalendarSecurityType | null;
  /** "YYYY-MM-DD" 基準日 — ETF rows only. */
  recordDate: string | null;
  /**
   * 每單位分配金額. **Read an ETF row's amount from here, never from `cashDividend`.** Until 2026-10-06 an
   * ETF's cashDividend was always null (96/96 in 2026-09), so a calendar reading cashDividend alone showed no
   * amount for roughly half the month's rows. Since analysis-ts fde1e48c an announced ETF row can also carry
   * the TWSE pre-announcement value in cashDividend, and they fill distributionPerUnit from it when sitca has
   * no amount yet (measured 2026-10-06 on DEV: 5 ETF rows had both, all equal; 0 had cashDividend without
   * distributionPerUnit). Null here still means the amount genuinely isn't published yet.
   */
  distributionPerUnit: number | null;
  composition: ExDividendCompositionBreakdown | null;
}

/**
 * ETF 配息組成，百分比。**三種狀態，不是兩種** —— `if (composition)` 那種檢查會在第二種上畫出一個空的圓餅：
 *
 * ```
 * composition === null          沒有組成。金額未公布的列，上游 2026-09-30 起一律給 null
 * 物件存在、五項全 null            金額公布了但組成還沒公告。00406A 主動中信台灣收益兩次配息都是這樣
 *                               （dpu 0.128 / 0.138，status 都是 realized），所以這不是暫態
 * 物件存在、有數值                真實的組成，但加總不保證是 100（見下）
 * ```
 *
 * 單一欄位的 `null` 是未揭露、`0` 是揭露了而且是零 —— **兩者不同**，而 0 是常態不是例外
 * （incomeEqualizationPct 在 2026-09 的 96 筆裡有 90 筆是 0），所以 falsy 判斷會把「這次配息沒有動用
 * 收益平準金」講成「不知道」。
 *
 * **加總不一定是 100，而且要看偏離的量級，不是看 ETF 類型。** 2026-06~10 共 410 筆 ETF、394 筆有數值，
 * 精確比對後 7 筆不等於 100：
 *
 * ```
 * +0.01      1 筆（00962 台新AI優息動能，被動型）      四捨五入
 * 0.8~68 點   6 筆（00404A 31.67、00985D 60.66/72.13/88.61、00401A 99.17/99.2）  真的沒揭露
 * ```
 *
 * 我第一次量的時候用 `abs(sum - 100) > 0.01` 當判準，於是 100.01 那一筆**被自己的容忍值藏起來**，並據此
 * 對外講了「被動型 347/347 全部加總 100」這個錯的結論（正確是 346/347）。analysis-ts 舉 00962 反駁
 * 「主動型揭露格式不同」時才發現。**挑容忍值就是在挑要不要看見某一類資料**——先看原始分布，再決定閾值。
 *
 * 大偏離那 6 筆在這份樣本裡剛好全是主動型，但**成因未知**（值是逐欄直讀、沒有計算，問題在 FundClear
 * 或投信端），所以不要當成「主動型才會」的規則。缺的部分請顯示成**「未揭露」**：不併進 otherIncomePct
 * （那是另一個真實存在且另有其值的欄位，把缺口折進去會造出一個來源端沒有的數字）、不反推、也
 * **不要拿「加總等於 100」去驗證資料**。
 *
 * 歷史（留著因為它解釋了為什麼這段話這麼長）：上游 09-23 加這個欄位時，announced（未來）列帶的是**上一次**
 * 配息的組成 —— 00939 的組成每次都不同（100/0 → 35.87/64.13 → 41.06/58.94 → 42.4/57.6），而它 2026-10-05
 * 的列帶著 09-01 的 42.4/57.6 逐字相同，且五項剛好加 100，所以下游從 payload 完全看不出來。sitca 比對
 * FundClear 原始回應後確認**來源本身就在預告列放上一次的組成**（不是 ingest 帶錯、也不是預測），analysis-ts
 * 於 2026-09-30 在 API 層處理：金額未公布的 ETF 列，composition 一律回 null。所以**不再需要靠 status 判斷**，
 * 但仍要處理上面第二種狀態。
 */
export interface ExDividendCompositionBreakdown {
  dividendIncomePct: number | null;
  interestIncomePct: number | null;
  incomeEqualizationPct: number | null;
  realizedCapitalGainPct: number | null;
  otherIncomePct: number | null;
}

export type ExDividendCalendarSecurityType = "ETF" | "COMMON";

export interface ExDividendCalendarResult {
  entries: ExDividendCalendarEntry[];
}
