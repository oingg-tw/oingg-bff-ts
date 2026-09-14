export type PeerGroupClassificationLevel = "category" | "coarseGroup";

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
 * `confidence`/`sampleSize` describe the TARGET symbol's own classification quality (how concentrated its
 * supply-chain edges are, and how many of them are classified) — not a property of each peer. `warnings`
 * carries human-readable Traditional Chinese explanations (e.g. a confidence-below-threshold or
 * fallback-level notice) meant to be shown to the user as-is, not parsed.
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
  confidence: number | null;
  sampleSize: number | null;
  updatedAt: string | null;
  peers: PeerGroupCompany[];
  warnings: string[];
}
