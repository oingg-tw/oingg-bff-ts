/**
 * 從心理計量分布抽樣產生 persona（跟 retiree-personas.json / extended-personas.json 是不同性質的東西）。
 *
 * 手寫 persona 的根本限制：作者只寫得出「有特色」的人。真實母體大部分平凡，而平凡的那一段恰好是
 * 決定營收的那一段。這支腳本改成從分布抽，所以：
 *   - 每一位是獨立抽樣，不是同一個作者的變體
 *   - 會自然產生一堆不好寫、也不好記的中間值
 *   - 換 seed 就是另一組樣本，N 可調，過程可重現
 *
 * **用它產生輸入的變異，不要用它宣稱輸出的效度。** LLM 扮演這些 persona 時仍然會往平均回歸，
 * 抽樣只保證「給模型的設定是分散的」，不保證「模型的回答是分散的」。
 * persona-cognitive-profiles.md §3 的塌縮檢查照樣要做。
 *
 * 用法：node docs/pricing-research/generate-sampled-personas.mjs [N] [seed] > sampled-personas.json
 */

// ---------------------------------------------------------------------------
// 參數來源與可信度。**這裡沒有一個數字是為了好看湊的，但精度差異很大，分開標示：**
//
// [實證] 有文獻支持的方向與大致量級：
//   - 年齡效應：進入中老年後 C 與 A 上升、N 下降、E 與 O 略降。
//   - 性別差異：女性平均 N 與 A 較高。
//   - 特質與財務行為：O/C/E 正向影響風險承受度，N 負向；C 是儲蓄與淨值最強的正向預測因子；
//     N 帶來風險趨避與財務焦慮；O 帶來嘗試新事物的意願；A 偏向保守的家庭安全取向。
//     這些關係在控制收入、教育與財務知識之後仍然存在。
//
// [近似] 相關矩陣用的是常見的後設分析量級，不是特定某份研究的精確值。
//
// [假設] 特質 → 行為參數的**係數**（下面 derive() 裡的權重）是我依上述方向訂的，
//   文獻給的是方向與顯著性，不是可直接搬用的迴歸係數。**任何依賴這些係數精確值的結論都不成立**，
//   它們的用途只是讓抽出來的人彼此不同且方向合理。
// ---------------------------------------------------------------------------

const BIG_FIVE = ["O", "C", "E", "A", "N"];

/** [近似] 常見後設分析量級的五因素相關矩陣，順序同 BIG_FIVE。 */
const CORR = [
  [1.0, 0.1, 0.3, 0.1, -0.1],
  [0.1, 1.0, 0.2, 0.25, -0.25],
  [0.3, 0.2, 1.0, 0.2, -0.25],
  [0.1, 0.25, 0.2, 1.0, -0.2],
  [-0.1, -0.25, -0.25, -0.2, 1.0],
];

/** [實證] 55 歲以上相對於一般成年母體的平均位移，單位是 SD。量級刻意保守。 */
const AGE_SHIFT = { O: -0.25, C: 0.25, E: -0.15, A: 0.3, N: -0.3 };
/** [實證] 女性相對男性的平均位移，單位是 SD。 */
const FEMALE_SHIFT = { O: 0.0, C: 0.05, E: 0.1, A: 0.25, N: 0.35 };

// --- 可重現的亂數（mulberry32）與常態抽樣（Box-Muller） -------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(rand) {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
/** Cholesky 分解，用來把獨立常態變成有相關結構的常態。 */
function cholesky(m) {
  const n = m.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let s = 0;
      for (let k = 0; k < j; k += 1) s += L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(m[i][i] - s) : (m[i][j] - s) / L[j][j];
    }
  }
  return L;
}
const L = cholesky(CORR);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

function sampleTraits(rand, isFemale) {
  const z = BIG_FIVE.map(() => normal(rand));
  const correlated = L.map((row) => row.reduce((acc, coef, k) => acc + coef * z[k], 0));
  return Object.fromEntries(
    BIG_FIVE.map((t, i) => [t, round1(correlated[i] + AGE_SHIFT[t] + (isFemale ? FEMALE_SHIFT[t] : 0))]),
  );
}

/**
 * [假設] 特質 → 行為參數。方向取自文獻，權重是設定值。
 * 收入刻意獨立於特質抽樣：文獻說特質的解釋力是**在控制收入之後**才成立的，
 * 若讓特質決定收入，就會把兩個本該分開的效果混在一起，最後分不清是誰在驅動願付價格。
 */
function derive(t, ageYears, monthlyIncome) {
  const riskTolerance = clamp(Math.round(3 + 0.6 * t.O + 0.4 * t.E + 0.3 * t.C - 0.8 * t.N), 1, 5);
  const techLiteracy = clamp(Math.round(3.4 + 0.7 * t.O - (ageYears - 62) * 0.06), 1, 5);
  // 對「自動續扣」的抗拒：高 N（怕被扣款不知情）、低 O（不習慣新付款方式）
  const autoRenewAversion = round1(clamp(0.5 + 0.35 * t.N - 0.3 * t.O, 0, 1));
  // 願付上限：收入是主導項，特質是修正項——這個比重關係本身就是結論之一
  const affordableMonthly = Math.round(monthlyIncome * clamp(0.012 + 0.004 * t.O + 0.003 * t.C - 0.004 * t.N, 0.002, 0.03));
  return { riskTolerance, techLiteracy, autoRenewAversion, affordableMonthly };
}

// [近似] 台灣退休族月收入（月退＋股利）取對數常態，中位數約 45k，右尾拉長；
// 這是分布形狀的合理假設，不是取自單一官方統計。
function sampleIncome(rand) {
  return Math.round((45000 * Math.exp(0.55 * normal(rand))) / 1000) * 1000;
}

const CITIES = ["台北", "新北", "桃園", "台中", "台南", "高雄", "彰化", "新竹", "嘉義", "宜蘭"];
const STYLES = ["存股領息", "高股息 ETF", "指數化投資", "金融股存股", "價值選股", "被動持有不操作"];

function makePersona(i, rand) {
  const isFemale = rand() < 0.5;
  const age = Math.round(55 + rand() * 22);
  const traits = sampleTraits(rand, isFemale);
  const monthlyIncome = sampleIncome(rand);
  const derived = derive(traits, age, monthlyIncome);
  return {
    id: `samp-${String(i + 1).padStart(3, "0")}`,
    gender: isFemale ? "女" : "男",
    age,
    city: pick(rand, CITIES),
    traits,
    income: { monthlyTwd: monthlyIncome, monthlyLivingExpenseTwd: Math.round(monthlyIncome * (0.6 + rand() * 0.3)) },
    assets: { investableTwd: Math.round((monthlyIncome * 12 * (2 + rand() * 12)) / 100000) * 100000 },
    investing: { style: pick(rand, STYLES), riskTolerance: derived.riskTolerance },
    digital: { techLiteracy: derived.techLiteracy },
    billing: {
      autoRenewAversion: derived.autoRenewAversion,
      // 抗拒程度高的人偏好一次性年繳（ATM／超商），這條對應的是 MANUAL 續約分支
      prefersOneOffAnnual: derived.autoRenewAversion > 0.6,
    },
    affordableMonthlyTwd: derived.affordableMonthly,
  };
}

const n = Number(process.argv[2] ?? 60);
const seed = Number(process.argv[3] ?? 20260923);
const rand = rng(seed);
const personas = Array.from({ length: n }, (_, i) => makePersona(i, rand));

const mean = (f) => round1(personas.reduce((s, p) => s + f(p), 0) / personas.length);
console.log(
  JSON.stringify(
    {
      $comment:
        "由 generate-sampled-personas.mjs 抽樣產生，不是手寫的。參數來源與可信度分級（實證／近似／假設）寫在該腳本開頭。" +
        "用途是提供輸入的變異與平凡的中間值，不是宣稱輸出有統計效度——LLM 扮演時仍會往平均回歸，塌縮檢查照做。",
      generatedWith: { script: "generate-sampled-personas.mjs", n, seed },
      sanityCheck: {
        note: "抽樣後的實際均值，應該接近上面的位移設定；若明顯偏離代表抽樣或參數有誤。",
        traitMeans: Object.fromEntries(BIG_FIVE.map((t) => [t, mean((p) => p.traits[t])])),
        meanAge: mean((p) => p.age),
        meanAffordableMonthlyTwd: Math.round(personas.reduce((s, p) => s + p.affordableMonthlyTwd, 0) / n),
        prefersOneOffAnnualPct: Math.round((personas.filter((p) => p.billing.prefersOneOffAnnual).length / n) * 100),
      },
      personas,
    },
    null,
    2,
  ),
);
