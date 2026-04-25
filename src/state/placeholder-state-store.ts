import { createDefaultRuntimeState, type RuntimeStateLoadResult, type StateStore } from "./state-store.js";

export const createPlaceholderStateStore = (): StateStore => {
  return {
    load(): Promise<RuntimeStateLoadResult> {
      return Promise.resolve({
        state: createDefaultRuntimeState(),
        invalidated: false,
        invalidationReason: null
      });
    },

    save(): Promise<void> {
      return Promise.resolve();
    }
  };
};
