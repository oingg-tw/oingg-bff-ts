import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Must run before any `.openapi(...)` call anywhere in the codebase — imported first thing by
// registry.ts, which every domain's *.openapi.ts imports transitively.
extendZodWithOpenApi(z);
