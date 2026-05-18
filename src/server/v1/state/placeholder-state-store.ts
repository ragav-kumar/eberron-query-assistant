import { createDefaultRuntimeState, type RuntimeStateLoadResult, type StateStore } from './state-store.js';

export const createPlaceholderStateStore = (): StateStore => ({
    load: (): Promise<RuntimeStateLoadResult> => Promise.resolve({
        state: createDefaultRuntimeState()
      }),

    save: (): Promise<void> => Promise.resolve()
  });
