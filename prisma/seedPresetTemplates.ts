/**
 * Seeds PresetTemplate. Previously held 21 templates derived from a competitor-research report
 * (oingg-conductor-ts/docs/compass_artifact_wf-3e795a7d-..., 2026-08-30) — confirmed by the user
 * 2026-09-08 to have all been placeholder/demo seed data, not a real requested feature, and removed
 * (including the live DB rows, deleted separately from this file).
 *
 * Real templates (2026-09-11): 7 filter combos grounded in metrics that have real academic/methodology
 * backing (GET /metrics' academicSourceUrl + badge fields), not arbitrary thresholds — designed with the
 * user and confirmed with web-nuxt (categories/naming/beta token all their call). Two candidates were
 * deliberately left out because the current screener has no way to express them yet, not because a
 * threshold couldn't be found: ncav's badge threshold is "市值 < NCAV" (field-vs-field comparison, the
 * screener only supports field-vs-constant), and assetGrowth's academic definition (Cooper/Gulen/Schill
 * 2008) is "bottom decile of the market" (relative ranking, not a fixed value) — revisit both if the
 * screener ever gains that capability.
 *
 * Idempotent: upserts by `name` (unique), safe to re-run after editing. Note this only upserts what's
 * listed below — it does NOT delete rows removed from this array (see feedback_no_destructive_syncs);
 * removing a template here requires a separate explicit delete against the live DB.
 *
 * `isDefault` (2026-09-11): exactly one template is shown/pre-selected when a user opens the screener
 * for the first time with no filters chosen yet — same isDefault convention as
 * ColumnPresetTemplate/prisma/seedColumnPresetTemplates.ts, but a frontend discoverability signal only
 * (bff-ts does not auto-apply this filter server-side — POST /screener still requires at least one
 * explicit filter). "股利連續性" (originally named "股利穩健" until a 2026-09-20 compliance rename, see
 * below) was picked by the user as the default: the most broadly familiar/accepted strategy among
 * Taiwanese retail investors (存股領息), unlike the more specialist/niche distress-scoring or higher-risk
 * turnaround templates. Enforced by an assertion in main() before writing anything, not just by convention.
 *
 * 2026-09-20: web-nuxt flagged two strings against their public-finance-site compliance wording rules
 * (no investment-performance claims) — "股利穩健"'s name (implies a performance judgment: "sound/stable")
 * and "價值型"'s description ("...股價偏低的公司", implies a valuation judgment: "underpriced"). Both
 * updated in place against the live DB (PresetTemplate.name is the upsert key, so the rename was applied
 * directly rather than via re-seed, which would have inserted a duplicate row under the new name and left
 * the old one orphaned) and mirrored here so future re-seeds stay consistent: "股利穩健" -> "股利連續性"
 * (name only, category/filters/isDefault unchanged), and the value template's description now states the
 * factual threshold ("葛拉漢數字低於 22.5 的公司") instead of the evaluative "股價偏低".
 *
 * Same day, same incident's real fallout: that rename silently broke web-nuxt's /screener/{slug} routing
 * — they had been keying it off `name` (the only string identifier available at the time), and a rename
 * is exactly the kind of change `name` was never safe to be used for. Added `slug` (2026-09-20 migration
 * 20260920120000_add_slug_to_preset_template) as a stable identifier decoupled from `name` — values below
 * are copied verbatim from web-nuxt's own shared/utils/hub-slugs.ts SCREENER_TEMPLATE_SLUGS (the
 * authoritative source; not chosen independently, to avoid a second mismatch). `name`/`description` can
 * now be revised freely without notice; changing `slug` itself is still a breaking change for web-nuxt and
 * needs the same advance-notice treatment renaming `name` used to require.
 *
 * 2026-09-21: web-nuxt had NOT yet cut over to reading `slug` (deliberately held off after the previous
 * rename incident — see their message), so "財務韌性" -> "安全韌性" (a site-wide terminology change,
 * matching analysis-ts's own `resilience` category rename in GET /metrics the same day — coincidentally
 * the same Chinese wording, not an actual dependency between the two tables) still needed the advance-
 * notice handshake: notified web-nuxt first, they pushed their key-mapping update, then this rename was
 * applied. `slug` stays "financial-resilience" unchanged (same page/URL, just a label swap, same treatment
 * as the "股利穩健"->"股利連續性" rename's `dividend-stability` slug).
 *
 * Run with: pnpm run seed:preset-templates
 */
import "dotenv/config";
import { getPrismaClient, closePrismaClient } from "../src/infrastructure/prisma/prismaClient.js";
import type { PresetTemplateFilter } from "../src/application/presetTemplates/presetTemplates.types.js";

interface TemplateSeed {
  name: string;
  slug: string;
  category: string;
  description: string;
  status: "AVAILABLE" | "PENDING";
  pendingReason: string | null;
  filters: PresetTemplateFilter[];
  isDefault: boolean;
}

const TEMPLATES: TemplateSeed[] = [
  {
    name: "價值型",
    slug: "value",
    category: "大師策略",
    description:
      "葛拉漢數字（Graham Number）< 22.5——Benjamin Graham 設定的本益比 15 倍 × 股價淨值比 1.5 倍上限（15 × 1.5 = 22.5），用來篩選葛拉漢數字低於 22.5 的公司。",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [{ field: "grahamNumber.TTM", min: null, max: 22.5, exclude: false }],
    isDefault: false,
  },
  {
    name: "低波動",
    slug: "low-volatility",
    category: "量化因子",
    description:
      "貝他係數（beta，2 年週資料，業界常見的標準計算慣例）< 1——股價相對大盤波動較小的公司，波動度低於市場平均。",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [{ field: "beta.2Y_1W", min: null, max: 1, exclude: false }],
    isDefault: false,
  },
  {
    name: "股利連續性",
    slug: "dividend-stability",
    category: "存股主題",
    description:
      "股利發放率介於 40%–60%——出自 Fidelity Investments 2013 年投資人教育報告《Payout Ratio: The Most Influential Management Decision a Company Can Make?》劃定的最適區間，兼顧資本配置紀律與股利永續性，不是「越低越安全」的單邊門檻。",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [{ field: "dividendPayoutRatio.TTM", min: 40, max: 60, exclude: false }],
    isDefault: true,
  },
  {
    name: "安全韌性",
    slug: "financial-resilience",
    category: "大師策略",
    description:
      "同時通過 3 個財務危機預警模型的安全門檻：Altman Z-Score（Altman, 1968）> 2.99、Ohlson O-Score（Ohlson, 1980）< 0.5、Zmijewski Score（Zmijewski, 1984）< 0.5，三個獨立模型互相印證，降低單一模型誤判的風險。",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [
      { field: "altmanZScore.TTM", min: 2.99, max: null, exclude: false },
      { field: "ohlsonOScore.TTM", min: null, max: 0.5, exclude: false },
      { field: "zmijewskiScore.TTM", min: null, max: 0.5, exclude: false },
    ],
    isDefault: false,
  },
  {
    name: "獲利品質",
    slug: "earnings-quality",
    category: "大師策略",
    description:
      "Beneish M-Score（Beneish, 1999）< -1.78——用來偵測財報是否存在盈餘操縱跡象的模型，低於此門檻代表財報數字出現操縱跡象的機率較低（不等於已認定財報造假，是統計上的量化呈現）。",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [{ field: "beneishMScore.Q", min: null, max: -1.78, exclude: false }],
    isDefault: false,
  },
  {
    name: "轉機股",
    slug: "turnaround",
    category: "大師策略",
    description:
      "Piotroski F-Score（Piotroski, 2000）≥ 7 分（滿分 9 分）且應計項目比率（Sloan, 1996）絕對值 < 10%——財務體質改善訊號多、盈餘品質不過度依賴會計估計調整的公司，高分不保證未來獲利，是體質正在改善的統計訊號。",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [
      { field: "piotroskiFScore.Q", min: 7, max: null, exclude: false },
      { field: "accrualsRatio.TTM", min: -10, max: 10, exclude: false },
    ],
    isDefault: false,
  },
  {
    name: "成長動能",
    slug: "growth-momentum",
    category: "量化因子",
    description:
      "標準化未預期盈餘（SUE，Foster/Olsen/Shevlin 1984；Bernard/Thomas 1989）> 2——本季獲利遠超市場預期的公司，PEAD（盈餘公告後漂移）文獻發現這類股票的超額報酬往往在接下來數季持續同方向漂移。",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [{ field: "sue.Q", min: 2, max: null, exclude: false }],
    isDefault: false,
  },
];

async function main() {
  const defaults = TEMPLATES.filter((t) => t.isDefault);
  if (defaults.length !== 1) {
    throw new Error(`Expected exactly one isDefault template, found ${defaults.length}`);
  }

  const prisma = getPrismaClient();

  for (const [index, template] of TEMPLATES.entries()) {
    await prisma.presetTemplate.upsert({
      where: { name: template.name },
      create: { ...template, position: index },
      update: { ...template, position: index },
    });
  }

  console.log(`Seeded ${TEMPLATES.length} preset templates (default: "${defaults[0]!.name}").`);
  const available = TEMPLATES.filter((t) => t.status === "AVAILABLE").length;
  console.log(`  ${available} AVAILABLE, ${TEMPLATES.length - available} PENDING.`);
}

main()
  .catch((error: unknown) => {
    console.error("Seeding preset templates failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePrismaClient();
  });
