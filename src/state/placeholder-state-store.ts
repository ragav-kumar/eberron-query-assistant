import { createDefaultRuntimeState, type RuntimeState, type StateStore } from "./state-store.js";

export class PlaceholderStateStore implements StateStore {
  load(): Promise<RuntimeState> {
    return Promise.resolve(createDefaultRuntimeState());
  }

  save(): Promise<void> {
    return Promise.resolve();
  }
}
