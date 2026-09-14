export type IndustryLevel = "section" | "division" | "group" | "class" | "subclass";

export interface IndustryTreeChild {
  code: string;
  level: IndustryLevel;
  name: string;
  companyCount: number;
  /** True whenever the classification dictionary has children here, even if none of the 999 tracked
   * companies currently fall under this node (companyCount can be 0 while hasChildren is still true). */
  hasChildren: boolean;
}

export interface IndustryTreeCompany {
  symbol: string;
  companyName: string;
}

/**
 * A single flat shape regardless of `found` — analysis-ts confirmed all 7 fields are always present.
 * Querying the root (no code) returns `code`/`level`/`name` as null with `children` being the 19 top-level
 * sections. `found: false` (unknown code) echoes back the requested `code`, `level`/`name` null,
 * `children`/`companies` empty, `companyCount` 0 — same shape, not a different one.
 *
 * `companies` is only ever non-empty at the "subclass" level — all 999 tracked companies are classified
 * at that leaf level, so section/division/group/class nodes always have an empty `companies` array (not
 * a bug: avoids the same company appearing at every ancestor level). Scope is the ~999 companies gov-ts
 * tracks tax-registration classification for — excludes KY-registered (foreign) companies, which have no
 * Taiwan tax registration to classify against.
 */
export interface IndustryTree {
  found: boolean;
  code: string | null;
  level: IndustryLevel | null;
  name: string | null;
  companyCount: number;
  children: IndustryTreeChild[];
  companies: IndustryTreeCompany[];
}

export interface IndustryPathNode {
  code: string;
  level: IndustryLevel;
  name: string;
}

export interface IndustryFlatCompany {
  symbol: string;
  companyName: string;
  /** Coarsest to finest — section, division, group, class, subclass, always all 5 levels. */
  path: IndustryPathNode[];
}

/**
 * All 999 gov-ts-tracked companies' symbol -> full classification path, added 2026-09-09 so a caller
 * doesn't have to recursively crawl GET /industries/tree to build a symbol/keyword search index. Only
 * TWSE-listed companies have data so far (TPEx/興櫃 pending on gov-ts's side) — same scope as
 * GET /industries/tree, this is just a flattened view of the same tree.
 */
export interface IndustryFlatList {
  companies: IndustryFlatCompany[];
}

export interface SecuritiesSector {
  code: string;
  name: string;
  companyCount: number;
}

/**
 * TWSE/TPEx's own securities-sector classification (證交所類股 — e.g. "24" = 半導體業), a completely
 * separate scheme from the gov-ts tax-registration industry tree above (IndustryTree/IndustryFlatList).
 * Two-digit codes, used by the screener's sectorCodes filter (union semantics across multiple codes).
 */
export interface SecuritiesSectorList {
  sectors: SecuritiesSector[];
}

/**
 * One company's supply-chain-derived industry classification, from analysis-ts's own oingg-playwright-py
 * cache (Gemini-parsed real supply-chain relationships) — same underlying cache as GET /companies/peer-group
 * (see peerGroup.types.ts), NOT the gov-ts tax-registration scheme above (IndustryTree/IndustryFlatList) —
 * a completely separate, unrelated classification. `category`/`coarseGroup` mirror
 * PeerGroupResult.industryName/PeerGroupResult's coarser fallback level, but at the company-list scale
 * (~1984 companies, TWSE+TPEx+KY, including ones with `category: null` — not filtered out, unlike
 * IndustryFlatList's TWSE-only tax-registered scope). `confidence`/`sampleSize`/`updatedAt` are this
 * company's own classification quality, same semantics as peer-group's fields — there is no scheduled
 * re-scrape, so `updatedAt` doesn't imply freshness beyond "whenever this cache was last built."
 */
export interface ChainClassificationCompany {
  symbol: string;
  companyName: string;
  category: string | null;
  coarseGroup: string | null;
  confidence: number | null;
  sampleSize: number | null;
  updatedAt: string | null;
}

/** One coarse group and the fine-grained categories that roll up into it — for a drill-down UI. */
export interface ChainClassificationGroup {
  coarseGroup: string;
  fineCategories: string[];
}

/**
 * Full supply-chain classification listing for web-nuxt's "產業追蹤" (industry tracking) page rebuild —
 * added 2026-09-14, a standalone addition alongside (not a replacement for) GET /industries/tree/flat,
 * which keep serving the gov-ts tax-registration scheme unchanged.
 */
export interface ChainClassificationList {
  companies: ChainClassificationCompany[];
  groups: ChainClassificationGroup[];
}

