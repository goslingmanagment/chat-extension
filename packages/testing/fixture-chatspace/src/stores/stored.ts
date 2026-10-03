// A ref persisted in localStorage under a `chat-space:*` key (ChatSpace uses
// vueuse useStorage for the same keys). Reads once, writes on every change.

import { ref, watch, type Ref } from 'vue';

export function storedRef<T>(key: string, initial: () => T): Ref<T> {
  let value = initial();
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) value = JSON.parse(raw) as T;
  } catch {
    value = initial();
  }
  const state = ref(value) as Ref<T>;
  watch(
    state,
    (next) => {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage full or blocked: the stand keeps working in memory.
      }
    },
    { deep: true },
  );
  return state;
}
