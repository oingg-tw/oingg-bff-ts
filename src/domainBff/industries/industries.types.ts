import type { PeerGroupClassificationSource } from "@/domainBff/stock/peerGroup.types.js";

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
 * cache (real supply-chain relationships) — same underlying cache as GET /companies/peer-group
 * (see peerGroup.types.ts), NOT the gov-ts tax-registration scheme above (IndustryTree/IndustryFlatList) —
 * a completely separate, unrelated classification. `category`/`coarseGroup` mirror
 * PeerGroupResult.industryName/PeerGroupResult's coarser fallback level, but at the company-list scale
 * (~1984 companies, TWSE+TPEx+KY, including ones with `category: null` — not filtered out, unlike
 * IndustryFlatList's TWSE-only tax-registered scope). `source`/`updatedAt` are this company's own
 * classification quality, same semantics as peer-group's fields (see PeerGroupResult) — there is no
 * scheduled re-scrape, so `updatedAt` doesn't imply freshness beyond "whenever this cache was last built."
 */
export interface ChainClassificationCompany {
  symbol: string;
  companyName: string;
  category: string | null;
  coarseGroup: string | null;
  source: PeerGroupClassificationSource | null;
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

export interface ChainClusterMember {
  code: string;
  name: string;
  /** False for a supply-chain node with no Taiwan stock listing (e.g. Apple, NVIDIA) — no stock-detail
   * page to link to for these; callers must branch on this before treating `code` as a stock symbol. */
  isListed: boolean;
}

export interface ChainSubCluster {
  /**
   * NOT a stable id — playwright-py's clustering re-run reshuffles these numbers across an entirely
   * different set of companies. Never cache, bookmark, share-link, or otherwise persist this value across
   * requests; treat it as valid only within the response it came from. Same caveat as ChainCluster.clusterId.
   */
  subClusterId: number;
  subLabel: string;
  members: ChainClusterMember[];
}

export interface ChainCluster {
  /** NOT a stable id — see ChainSubCluster.subClusterId's note; the same instability applies here. */
  clusterId: number;
  label: string;
  /** Populated only for top-level clusters small enough (<=100 nodes) to skip sub-clustering entirely — otherwise empty and members live under subClusters instead. */
  directMembers: ChainClusterMember[];
  subClusters: ChainSubCluster[];
}

/**
 * The full supply-chain cluster tree (113 top-level clusters, 475 sub-clusters as of 2026-09-14) from
 * analysis-ts's GET /industries/chain-clusters — a completely independent grouping concept from
 * ChainClassificationList's flat category/coarseGroup scheme above (both are served in parallel, neither
 * replaces the other). Includes non-listed international supply-chain nodes (customers/suppliers like
 * Apple/NVIDIA — ~5,654 of the ~7,566 total member nodes), not just TWSE/TPEx-listed companies.
 */
export interface ChainClusterTree {
  clusters: ChainCluster[];
}

