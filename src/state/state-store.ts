import type { RuntimeConfig } from "../types.js";

export interface RuntimeState {
  version: 1;
}

export interface StateStore {
  load(config: RuntimeConfig): Promise<RuntimeState>;
}
