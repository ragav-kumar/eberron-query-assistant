import type { RuntimeState, StateStore } from "./state-store.js";

export class PlaceholderStateStore implements StateStore {
  load(): Promise<RuntimeState> {
    return Promise.resolve({ version: 1 });
  }
}
