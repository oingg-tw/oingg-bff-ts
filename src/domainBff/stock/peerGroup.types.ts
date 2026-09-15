/**
 * Which level of the supply-chain drill-down tree (GET /industries/chain-tree, same underlying data
 * source) this comparison actually used — replaced PeerGroupClassificationLevel (category/coarseGroup)
 * 2026-09-15 when analysis-ts switched the peer-selection algorithm to prefer the tree's finest leaf level
 * first, falling back toward the root only when there aren't enough peers (see PeerGroupResult).
 */
export type PeerGroupLevel = "coarse_group" | "category" | "segment";

/**
 * Why `found` is false — added 2026-09-15 alongside the peer-selection algorithm rewrite, distinguishing
 * two previously-conflated cases: "not_classified" (the symbol isn't in the supply-chain tree at all) vs.
 * "insufficient_peers" (it IS classified, but even falling all the way back to the tree's root level still
 * doesn't reach `minPeers`) — the old behavior silently returned a coarseGroup-level result regardless of
 * whether it actually met minPeers; now an unmet minPeers at every level is a genuine `found: false`
 * rather than a forced result.
 */
export type PeerGroupNotFoundReason = "not_classified" | "insufficient_peers";

/**
 * How this symbol's classification was determined — replaced confidence/sampleSize 2026-09-15 when
 * playwright-py switched methodology (analysis-ts's own words: a single confidence score/sample-size pair
 * wasn't meaningful once classification could come from two very different processes). "keyword" means
 * classified by free keyword rules alone; "gemini" means additionally validated/corrected by Gemini
 * semantic review — confirmed live, ~99% of companies (1966/1984) are "gemini". Treat as a single quality
 * tier, not something to threshold-filter on.
 */
export type PeerGroupClassificationSource = "keyword" | "gemini";

export interface PeerGroupCompany {
  symbol: string;
  companyName: string | null;
}

/**
 * Supply-chain-derived peer comparison for one symbol, from analysis-ts's GET /companies/peer-group
 * (added 2026-09-14, replacing an earlier gov-ts-tax-registry-based version — a breaking change on their
 * side, but bff-ts never had a proxy for the old version, so there was nothing to migrate here). Industry
 * classification comes from oingg-playwright-py's real supply-chain relationships, not the Ministry of
 * Finance's tax-registration scheme (see industries.client.ts's GET /industries/tree, a completely
 * separate, unrelated classification this endpoint does not touch).
 *
 * Peer-selection algorithm rewritten 2026-09-15: previously drew from a flat ~33-category scheme that
 * mixed unrelated business models under one label (e.g. "資訊設備" lumped notebook ODMs, brand owners,
 * thermal-component makers, and server makers together, 113 companies deep). Now draws from GET
 * /industries/chain-tree's finer drill-down leaves first — `peerGroupLevel`/`peerGroupNodeId`/
 * `peerGroupLabel` describe whichever tree level actually got used for THIS comparison (falling back
 * toward the tree's root only when there aren't enough peers at a finer level; `warnings` explains a
 * fallback in Traditional Chinese, meant to be shown to the user as-is, not parsed). `peerGroupNodeId` is
 * NOT a stable id — same instability as GET /industries/chain-tree's own nodeId; never cache, bookmark, or
 * share-link it.
 *
 * `category`/`coarseGroup`/`source`/`updatedAt` are carried over from the OLD flat scheme and downgraded
 * to a purely informational "industry tag" display value — they no longer describe the level this
 * comparison's peers were drawn from (that's `peerGroupLevel` now).
 *
 * `found: false` no longer means simply "unclassified" — see `notFoundReason` (added the same day) for the
 * two distinct cases. Still always 200, never a 404, same convention as this domain's other per-symbol
 * endpoints; every other field is null and peers/warnings are empty arrays when `found` is false.
 */
export interface PeerGroupResult {
  symbol: string;
  companyName: string | null;
  found: boolean;
  notFoundReason: PeerGroupNotFoundReason | null;
  peerGroupLevel: PeerGroupLevel | null;
  peerGroupNodeId: string | null;
  peerGroupLabel: string | null;
  /** Informational "industry tag" only as of 2026-09-15 — does NOT describe the level peers were drawn from; see peerGroupLevel for that. */
  category: string | null;
  /** Informational "industry tag" only as of 2026-09-15 — see category. */
  coarseGroup: string | null;
  source: PeerGroupClassificationSource | null;
  updatedAt: string | null;
  peers: PeerGroupCompany[];
  warnings: string[];
}
