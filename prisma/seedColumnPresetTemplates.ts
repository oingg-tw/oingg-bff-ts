/**
 * Seeds ColumnPresetTemplate. analysis-ts's own `columnPresets` field (the previous source of this
 * table) was dropped entirely 2026-09-08 and never came back — this table is now purely bff-ts-owned
 * and curated, same as PresetTemplate. There is no more startup sync pulling from analysis-ts (removed
 * alongside columnPresetTemplates.client.ts, 2026-09-11) so this script is the only thing that writes
 * to this table.
 *
 * These 9 templates are deliberately independent of PresetTemplate's 7 filter combos (價值型/低波動/
 * 股利穩健/財務韌性/獲利品質/轉機股/成長動能, see seedPresetTemplates.ts) — not paired 1:1 by user request,
 * so several of these (杜邦拆解/財務體質/營運效率/現金流品質) cover structural/comparative angles across the
 * catalog that the filter combos' narrow guru-methodology focus never touches at all.
 *
 * Exactly one row below MUST have isDefault: true ("總覽") — screener calls with no columnPresetId fall
 * back to it (see columnPresetTemplates.repository.ts's findDefaultColumnPresetTemplate and
 * columnPresets.service.ts's resolveScreenerColumns). Enforced by an assertion in main() before writing
 * anything, not just by convention.
 *
 * Idempotent and destructive-safe: replaceColumnPresetTemplates upserts by key and deletes only rows
 * absent from TEMPLATES below (never wipe+recreate) — re-run freely after editing this file.
 *
 * Every fieldKey was verified live against GET /metrics on 2026-09-11 — re-verify against a live
 * catalog before editing, field keys/tokens can change without notice. Caught live during this seed's
 * own authoring: the catalog shrank from 87 to 85 metrics between initial design and writing this file
 * (dupontDecomposedRoe/dupontExtendedRoe both disappeared), which is exactly the kind of drift a past
 * incident warned about (an old "overview" template once referenced dropped field names like
 * roe.roeTtmPct, silently degrading the screener's default columns until caught — resolveDefaultColumns
 * now defensively drops unresolvable fields with a warning, but don't rely on that safety net).
 *
 * Run with: pnpm run seed:column-preset-templates
 */
import "dotenv/config";
import { closePrismaClient } from "../src/adapters/neon/prismaClient.js";
import { replaceColumnPresetTemplates } from "../src/domainBusiness/columnPresetTemplates/columnPresetTemplates.repository.js";
import type { ColumnPresetTemplate } from "../src/domainBusiness/columnPresetTemplates/columnPresetTemplates.types.js";

const TEMPLATES: ColumnPresetTemplate[] = [
  {
    key: "overview",
    name: "總覽",
    description: "價格、規模、估值、獲利、股利、成長的第一眼欄位組合——沒有指定欄位組合時，screener 預設顯示的就是這組。",
    isDefault: true,
    fieldKeys: [
      "stock.price",
      "marketCap.Q",
      "peRatio.TTM",
      "pbRatio.Q",
      "dividendYield.EOD",
      "roe.TTM",
      "eps.TTM",
      "epsGrowthRate.Q",
    ],
  },
  {
    key: "valuation",
    name: "估值比較",
    description: "常見估值倍數並排比較，方便同時看本益比、股價淨值比、股價營收比等不同角度的估值水位。",
    isDefault: false,
    fieldKeys: ["peRatio.TTM", "pbRatio.Q", "psr.TTM", "evEbitda.TTM", "pegRatio.TTM", "earningsYield.TTM"],
  },
  {
    key: "dividendIncome",
    name: "存股與股利",
    description: "現在的殖利率，加上發放率、連續配息年數等股利穩定度與永續性的觀察欄位。",
    isDefault: false,
    fieldKeys: [
      "dividendYield.EOD",
      "dividendPayoutRatio.TTM",
      "consecutiveDividendYears.FY",
      "chowderNumber.FY",
      "dividendCoverageRatio.TTM",
    ],
  },
  {
    key: "profitability",
    name: "獲利能力",
    description: "核心報酬率與利潤率指標，純粹看賺錢能力本身，不涉及財務危機評分。",
    isDefault: false,
    // grossMargin -> operatingMargin -> netProfitMargin is deliberate order, matching the income
    // statement's own top-down structure (營收 -> 毛利 -> 減營業費用 -> 營業利益 -> 加減業外/稅 -> 淨利) —
    // a user flagged netProfitMargin-before-operatingMargin as breaking this reading order (2026-09-11).
    fieldKeys: ["roe.TTM", "roa.TTM", "roic.TTM", "grossMargin.TTM", "operatingMargin.TTM", "netProfitMargin.TTM"],
  },
  {
    key: "dupont",
    name: "杜邦拆解",
    description: "把 ROE 拆解成利潤率、資產週轉率、權益乘數等結構性驅動因子，看獲利是靠什麼撐起來的。",
    isDefault: false,
    fieldKeys: [
      "roe.TTM",
      "netProfitMargin.TTM",
      "assetTurnover.TTM",
      "equityMultiplier.Q",
      "dupontEbitMargin.TTM",
      "dupontInterestBurden.TTM",
      "dupontTaxBurden.TTM",
    ],
  },
  {
    key: "balanceSheetHealth",
    name: "財務體質",
    description: "流動性與槓桿的基本會計比率快照，跟「財務韌性」篩選組合用的 Altman/Ohlson/Zmijewski 評分是不同角度。",
    isDefault: false,
    fieldKeys: ["currentRatio.Q", "quickRatio.Q", "cashRatio.Q", "debtRatio.Q", "deRatio.Q", "interestCoverage.TTM"],
  },
  {
    key: "operatingEfficiency",
    name: "營運效率",
    description: "資產與營運資金的週轉效率，跟其他組合完全沒有重疊的一個分類角度。",
    isDefault: false,
    fieldKeys: [
      "assetTurnover.TTM",
      "inventoryTurnover.TTM",
      "receivablesTurnover.TTM",
      "payablesTurnover.TTM",
      "cashConversionCycle.TTM",
    ],
  },
  {
    key: "growth",
    name: "成長動能",
    description: "營收、獲利、淨值等年增率一次看，比單一 SUE 篩選指標更完整的成長輪廓。",
    isDefault: false,
    fieldKeys: [
      "revenueGrowthRate.Q",
      "epsGrowthRate.Q",
      "netIncomeGrowthRate.Q",
      "operatingIncomeGrowthRate.Q",
      "equityGrowthRate.Q",
    ],
  },
  {
    key: "cashFlowQuality",
    name: "現金流品質",
    description: "每股現金流量與帳面獲利有沒有真的轉換成現金，跟「獲利品質」篩選組合的財報操縱偵測是不同焦點。",
    isDefault: false,
    fieldKeys: ["ocfPerShare.TTM", "fcfPerShare.TTM", "ownerEarnings.TTM", "ocfToNetIncome.TTM", "accrualsRatio.TTM"],
  },
];

async function main() {
  const defaults = TEMPLATES.filter((t) => t.isDefault);
  if (defaults.length !== 1) {
    throw new Error(`Expected exactly one isDefault template, found ${defaults.length}`);
  }

  await replaceColumnPresetTemplates(TEMPLATES);
  console.log(`Seeded ${TEMPLATES.length} column preset templates (default: "${defaults[0]!.name}").`);
}

main()
  .catch((error: unknown) => {
    console.error("Seeding column preset templates failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePrismaClient();
  });
