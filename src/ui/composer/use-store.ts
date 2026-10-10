import { useSyncExternalStore } from "react";
import type { Entry } from "../../core/entry";
import type { EntryStore, StoreState } from "../../core/store";

/** The store's state, re-rendering when it changes. `StoreState` is immutable, so this is tear-free. */
export function useStoreState(store: EntryStore): StoreState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** Entries of the current session, ordered by number. */
export function useEntries(store: EntryStore): readonly Entry[] {
  return useStoreState(store).entries;
}
