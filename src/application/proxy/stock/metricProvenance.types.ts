/**
 * Not a fixed enum — analysis-ts's supported metricCode set for this endpoint has grown from an initial
 * pilot of 3 (sue/chowderNumber/roe) to 112+ and keeps expanding (same growing-allowlist pattern as GET
 * /metrics' hasProvenance field, which flags which metricCodes support this endpoint — see
 * metricCatalog.types.ts). bff-ts used to hardcode the allowed set here and reject anything else with its
 * own 400 before ever calling analysis-ts, which meant every expansion on their side required a matching
 * code change here before it actually worked — caught 2026-09-15 when hasProvenance already listed 112
 * metricCodes but this endpoint only accepted 6. Validation is now analysis-ts's own — an unsupported
 * value gets analysis-ts's own 400 message relayed as-is (see metricProvenance.client.ts).
 *
 * 2026-10-01 補齊到**全集**：端點的白名單 164 支（型錄 161 支 ＋ 3 支已從目錄下架的 8 年窗口指標），
 * `hasProvenance` 161/161 全部 true。**所以「讀 hasProvenance 還是直接打」這個選擇現在無關緊要**——
 * 它恆為 true。這也讓 2026-09-15 那個不列舉的決定第三次付清：三次擴張（6 → 112 → 164）這裡都沒有改過一行。
 */
export type MetricProvenanceMetricCode = string;

export interface MetricProvenanceEntry {
  /**
   * 給人看的中文標籤，說明這一筆在計算裡的角色。**文字會變、不要解析它**：2026-09-21 把 "TTM" 改成
   * 「近四季」（68 支指標），2026-10-01 又改成「近一年 X（115 年第 2 季…）」，興櫃顯示「114 年下半年」
   * **而且興櫃的 entry 數量從 4 段變 2 段**（只有半年報）。
   *
   * bff-ts 對它零比對、純轉發，所以這些改動在這一層是零影響；但如果下游在抓格式（例如從「第 i/4 季」
   * 取出 i），那個格式已經不存在了。逐日指標的交易日也寫在這裡（`fiscalYear`/`fiscalQuarter` 是 null）。
   */
  role: string;
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  type: "statementField" | "other";
  /** Only set when type is "statementField". */
  statementType: "balanceSheet" | "incomeStatement" | "cashFlowStatement" | null;
  /** Only set when type is "statementField" — the raw statement line-item key this figure came from. */
  fieldKey: string | null;
  /** Only set when type is "other" — free-text description of the non-statement source (e.g. a TWSE/TPEx daily valuation snapshot or a capital-change filing). */
  sourceDescription: string | null;
  /**
   * Passed through with no type coercion. Most entries are bigint-serialized strings (raw statement
   * figures, e.g. "706561938"), but at least one confirmed-live case (chowderNumber's cash dividend
   * yield "market snapshot" entry) is a plain float (0.92) instead of a string — consumers must not
   * assume either type.
   */
  value: string | number | null;
}

/**
 * The raw-filing provenance trail behind one metric's computed value — backs web-nuxt's "trace this
 * badge's number back to the raw filing" feature. Validated by analysis-ts itself, not by a fixed enum on
 * this side (see MetricProvenanceMetricCode) — check GET /metrics' hasProvenance field for which
 * metricCodes currently support this. Confirmed with analysis-ts directly (2026-09-10) via real 2330
 * examples for the initial pilot set.
 */
export interface MetricProvenanceResult {
  symbol: string;
  metricCode: MetricProvenanceMetricCode;
  /** false for an unknown symbol or a year/season with no data — still a 200, not a 404. */
  found: boolean;
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  /** The metric's own computed value for this period (e.g. roe's 34.78) — always a number, unlike entries[].value. */
  value: number | null;
  /** Empty array (not null) when found is false. */
  entries: MetricProvenanceEntry[];
  /**
   * 這張溯源表描述的是哪個期別（上游 2026-10-01 新增）。`'Q' | 'YTD' | 'TTM' | 'FY'`，逐日或月頻指標是
   * null（交易所三率、beta、live*、sus）。型別不收斂成聯集：合法集合是上游的、而且每支指標支援的不同。
   *
   * **它是查詢參數 `periodType` 的偵測器，兩者必須一起接。** 上游同一次變更同時加了這兩樣，而對一個只接
   * 其中一邊的中間層，組合效果最糟：只接參數沒接欄位（就是 bff-ts 2026-10-01 當天的狀態），呼叫端拿到
   * TTM 的值卻以為是自己要求的期別、連 found 旗標都是 true；只接欄位沒接參數，則會看到 periodType:"TTM"
   * 而以為自己要的就是 TTM。
   */
  periodType: string | null;
  methodologyNote: string | null;
}
