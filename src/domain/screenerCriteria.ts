/**
 * The vocabulary both sides of the screener speak: one numeric condition on a field, and one field
 * chosen for display.
 *
 * These used to live in `application/proxy/screener/screener.types.ts`, which made the two saved-preset
 * services (screenerPresets/columnPresets — 業務中台, this service's own data) import from the BFF proxy
 * layer to describe their own stored rows. That is exactly the direction the `business-not-import-bff`
 * rule forbids: the proxy may build on what the business slices own, never the reverse, or "this service
 * doesn't own the computation" erodes one convenient import at a time.
 *
 * Moving them here rather than picking a side resolves it honestly, because neither side owns them: a
 * ScreenerPreset stores these shapes, and the proxy sends them to analysis-ts — same two structs, two
 * different jobs. `domain` is the one place both layers are allowed to depend on, and these qualify for
 * it on their own merits: they are plain shared vocabulary that survives swapping the database and the
 * upstream API alike, with no behaviour attached.
 *
 * The proxy's screener.types.ts re-exports both names, so the analysis-ts client and the response types
 * that sit beside it keep their existing import site.
 */

export interface ScreenerFilter {
  /** "<metricKey>.<fieldKey>", e.g. "margins.grossMarginTtm" */
  field: string;
  min: number | null;
  max: number | null;
  /** false (default): keep rows within [min, max]. true: keep rows OUTSIDE [min, max] instead. */
  exclude: boolean;
}

export interface ScreenerColumnRef {
  field: string;
}
