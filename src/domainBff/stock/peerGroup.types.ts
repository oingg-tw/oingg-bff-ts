export type PeerGroupClassificationLevel = "category" | "coarseGroup";

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
 * classification comes from oingg-playwright-py's Gemini-parsed real supply-chain relationships, not the
 * Ministry of Finance's tax-registration scheme (see industries.client.ts's GET /industries/tree, a
 * completely separate, unrelated classification this endpoint does not touch).
 *
 * `classificationLevel` has only 2 tiers (category/coarseGroup), unlike the 4-level gov-ts scheme —
 * analysis-ts falls back from category to coarseGroup when there aren't enough peers at the finer level.
 * `source` describes the TARGET symbol's own classification method — see PeerGroupClassificationSource.
 * `confidence`/`sampleSize` fields existed briefly (2026-09-14) and were replaced by `source` the next day
 * when playwright-py changed methodology. `warnings` carries human-readable Traditional Chinese
 * explanations (e.g. a fallback-level notice) meant to be shown to the user as-is, not parsed.
 *
 * `found: false` (unknown/not-yet-classified symbol) still returns 200 with every other field null and
 * empty peers/warnings arrays, not a 404 — confirmed live, same convention as this domain's other
 * per-symbol endpoints.
 */
export interface PeerGroupResult {
  symbol: string;
  companyName: string | null;
  found: boolean;
  classificationLevel: PeerGroupClassificationLevel | null;
  industryCode: string | null;
  industryName: string | null;
  source: PeerGroupClassificationSource | null;
  updatedAt: string | null;
  peers: PeerGroupCompany[];
  warnings: string[];
}
