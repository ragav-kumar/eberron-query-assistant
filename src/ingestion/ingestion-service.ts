import type { RuntimeConfig, RuntimeOptions, StartupRefreshSummary } from "../types.js";

export interface IngestionService {
  refresh(config: RuntimeConfig, options: RuntimeOptions): Promise<StartupRefreshSummary>;
}
