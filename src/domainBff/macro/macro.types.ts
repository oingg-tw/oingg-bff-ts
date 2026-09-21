/**
 * One CBC (中央銀行) policy-rate adjustment — an event-series row (one per rate change), NOT a daily series.
 * All three rates are percentages as plain numbers (2 = 2%), passed through as the JSON numbers
 * analysis-ts sends (not string-normalized like the market domain's Decimal-backed price fields — these
 * are the upstream contract as given, see feedback_proxy_apis_no_transformation). `changeBp` is the
 * discount-rate delta vs. the previous adjustment in basis points (12.5 = 半碼) — null only on the very
 * first row of the full history (1989-04-01, nothing earlier to compare against); with a `from` window
 * the first returned row still has a real value, since its predecessor exists upstream.
 */
export interface CbcPolicyRateEntry {
  effectiveDate: string;
  discountRate: number;
  collateralAccommodationRate: number;
  unsecuredAccommodationRate: number;
  changeBp: number | null;
}

/** Oldest to newest — 77 events from 1989-04-01 as of 2026-09-21 when unfiltered. */
export interface CbcPolicyRateResult {
  entries: CbcPolicyRateEntry[];
}
