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

export type ValueChainLevel = "industry" | "subChain";

export interface ValueChainTreeChild {
  code: string;
  name: string;
  companyCount: number;
}

export type ValueChainMarket = "listed" | "otc" | "rotc";

export interface ValueChainTreeCompany {
  symbol: string;
  companyName: string;
  market: ValueChainMarket;
}

/**
 * TPEx's 產業價值鏈 (industry value-chain) classification, from GET /industries/value-chain, added
 * 2026-09-09 — a completely separate system from IndustryTree's gov-ts tax-registration tree, do not
 * conflate or merge them. Only 2 levels (industry -> subChain, 47 -> 422), and a company can belong to
 * MULTIPLE subChains (confirmed live, e.g. 台達電 maps to 64 subChains) — unlike IndustryTree's
 * single-classification-per-company model. `companies` is only ever populated when querying a subChain
 * code directly; there is no reverse (company -> its subChains) lookup on analysis-ts's side — a `symbol`
 * query param is silently ignored, confirmed live. Covers all three market tiers (上市/上櫃/興櫃, 6481 total
 * company-subChain relationships) via the `market` field, unlike IndustryTree's TWSE-listed-only scope.
 * No `companyCount` at the root/industry level itself (only inside each `children` entry) — unlike
 * IndustryTree, which aggregates companyCount at every level.
 */
export interface ValueChainTree {
  found: boolean;
  code: string | null;
  level: ValueChainLevel | null;
  name: string | null;
  children: ValueChainTreeChild[];
  companies: ValueChainTreeCompany[];
  /** Always "https://ic.tpex.org.tw" — the public TPEx source site, not an internal table name. */
  dataSource: string;
}
