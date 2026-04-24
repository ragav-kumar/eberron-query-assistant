import { createDefaultRuntimeState, type RuntimeStateLoadResult, type StateStore } from "./state-store.js";

export class PlaceholderStateStore implements StateStore {
  load(): Promise<RuntimeStateLoadResult> {
    return Promise.resolve({
      state: createDefaultRuntimeState(),
      invalidated: false,
      invalidationReason: null
    });
  }

  save(): Promise<void> {
    return Promise.resolve();
  }
}
