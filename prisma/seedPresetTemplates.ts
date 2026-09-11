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
 * Run with: pnpm run seed:preset-templates
 */
import "dotenv/config";
import { getPrismaClient, closePrismaClient } from "../src/adapters/neon/prismaClient.js";
import type { PresetTemplateFilter } from "../src/domainBusiness/presetTemplates/presetTemplates.types.js";

interface TemplateSeed {
  name: string;
  category: string;
  description: string;
  tier: "FREE" | "PAID";
  status: "AVAILABLE" | "PENDING";
  pendingReason: string | null;
  filters: PresetTemplateFilter[];
}

const TEMPLATES: TemplateSeed[] = [
  {
    name: "價值型",
    category: "大師策略",
    description:
      "葛拉漢數字（Graham Number）< 22.5——Benjamin Graham 設定的本益比 15 倍 × 股價淨值比 1.5 倍上限（15 × 1.5 = 22.5），用來篩選相對於獲利與帳面資產而言股價偏低的公司。",
    tier: "FREE",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [{ field: "grahamNumber.TTM", min: null, max: 22.5, exclude: false }],
  },
  {
    name: "低波動",
    category: "量化因子",
    description:
      "貝他係數（beta，2 年週資料，業界常見的標準計算慣例）< 1——股價相對大盤波動較小的公司，波動度低於市場平均。",
    tier: "FREE",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [{ field: "beta.2Y_1W", min: null, max: 1, exclude: false }],
  },
  {
    name: "股利穩健",
    category: "存股主題",
    description:
      "股利發放率介於 40%–60%——出自 Fidelity Investments 2013 年投資人教育報告《Payout Ratio: The Most Influential Management Decision a Company Can Make?》劃定的最適區間，兼顧資本配置紀律與股利永續性，不是「越低越安全」的單邊門檻。",
    tier: "FREE",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [{ field: "dividendPayoutRatio.TTM", min: 40, max: 60, exclude: false }],
  },
  {
    name: "財務韌性",
    category: "大師策略",
    description:
      "同時通過 3 個財務危機預警模型的安全門檻：Altman Z-Score（Altman, 1968）> 2.99、Ohlson O-Score（Ohlson, 1980）< 0.5、Zmijewski Score（Zmijewski, 1984）< 0.5，三個獨立模型互相印證，降低單一模型誤判的風險。",
    tier: "FREE",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [
      { field: "altmanZScore.TTM", min: 2.99, max: null, exclude: false },
      { field: "ohlsonOScore.TTM", min: null, max: 0.5, exclude: false },
      { field: "zmijewskiScore.TTM", min: null, max: 0.5, exclude: false },
    ],
  },
  {
    name: "獲利品質",
    category: "大師策略",
    description:
      "Beneish M-Score（Beneish, 1999）< -1.78——用來偵測財報是否存在盈餘操縱跡象的模型，低於此門檻代表財報數字出現操縱跡象的機率較低（不等於已認定財報造假，是統計上的量化呈現）。",
    tier: "FREE",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [{ field: "beneishMScore.Q", min: null, max: -1.78, exclude: false }],
  },
  {
    name: "轉機股",
    category: "大師策略",
    description:
      "Piotroski F-Score（Piotroski, 2000）≥ 7 分（滿分 9 分）且應計項目比率（Sloan, 1996）絕對值 < 10%——財務體質改善訊號多、盈餘品質不過度依賴會計估計調整的公司，高分不保證未來獲利，是體質正在改善的統計訊號。",
    tier: "FREE",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [
      { field: "piotroskiFScore.Q", min: 7, max: null, exclude: false },
      { field: "accrualsRatio.TTM", min: -10, max: 10, exclude: false },
    ],
  },
  {
    name: "成長動能",
    category: "量化因子",
    description:
      "標準化未預期盈餘（SUE，Foster/Olsen/Shevlin 1984；Bernard/Thomas 1989）> 2——本季獲利遠超市場預期的公司，PEAD（盈餘公告後漂移）文獻發現這類股票的超額報酬往往在接下來數季持續同方向漂移。",
    tier: "FREE",
    status: "AVAILABLE",
    pendingReason: null,
    filters: [{ field: "sue.Q", min: 2, max: null, exclude: false }],
  },
];

async function main() {
  const prisma = getPrismaClient();

  for (const [index, template] of TEMPLATES.entries()) {
    await prisma.presetTemplate.upsert({
      where: { name: template.name },
      create: { ...template, position: index },
      update: { ...template, position: index },
    });
  }

  console.log(`Seeded ${TEMPLATES.length} preset templates.`);
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
