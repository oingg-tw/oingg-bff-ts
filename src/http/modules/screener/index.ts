import { Router } from "ultimate-express";
import { createColumnPresetTemplatesRouter } from "@/http/modules/columnPresetTemplates/route.js";
import { createPresetTemplatesRouter } from "@/http/modules/presetTemplates/route.js";
import { createColumnPresetsRouter } from "@/http/modules/columnPresets/route.js";
import { createScreenerRouter } from "@/http/modules/screener/route.js";
import { createScreenerPresetsRouter } from "@/http/modules/screenerPresets/route.js";
import type { ColumnPresetTemplatesDeps } from "@/application/columnPresetTemplates/columnPresetTemplates.service.js";
import type { PresetTemplatesDeps } from "@/application/presetTemplates/presetTemplates.service.js";
import type { RunPresetDeps } from "@/application/proxy/screener/runPreset.js";
import type { AuthMiddlewareDeps } from "@/http/middleware/auth.middleware.js";
import type { QuotaMiddlewareDeps } from "@/http/middleware/quota.middleware.js";

/**
 * /screener 底下五支路由的組合。它們各自是獨立的工廠函式，這裡只負責決定掛載順序與路徑。
 *
 * 這個檔案本身也跟著變成工廠：一旦子路由要吃 deps，組合它們的人就沒辦法還是個模組載入時就建好的常數。
 * 這是依賴注入沿著呼叫鏈往上傳的自然結果，一路傳到 src/routes.ts 再到 bootstrap——換句話說，「誰決定
 * 實作」這件事被逼著集中在 composition root，而不是散落在每個 import 的頂端。
 */
export type ScreenerRoutesDeps = RunPresetDeps &
  PresetTemplatesDeps &
  ColumnPresetTemplatesDeps &
  AuthMiddlewareDeps &
  QuotaMiddlewareDeps;

export function createScreenerRoutes(deps: ScreenerRoutesDeps): Router {
  const screenerRoutes = Router();
  screenerRoutes.use("/column-presets", createColumnPresetsRouter(deps));
  screenerRoutes.use("/column-preset-templates", createColumnPresetTemplatesRouter(deps));
  screenerRoutes.use("/presets", createScreenerPresetsRouter(deps));
  screenerRoutes.use("/templates", createPresetTemplatesRouter(deps));
  // Mounted last: "/" would otherwise swallow the named prefixes above.
  screenerRoutes.use("/", createScreenerRouter(deps));
  return screenerRoutes;
}
