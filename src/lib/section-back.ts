import { useEffect, useRef, useSyncExternalStore } from "react";
import { pushBackHandler } from "./back-intercept";

const listeners = new Set<() => void>();
let depth = 0;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function active(): boolean {
  return depth > 0;
}

function inactive(): boolean {
  return false;
}

export function useSectionBack(onBack: () => void, enabled: boolean) {
  const handler = useRef(onBack);
  handler.current = onBack;
  useEffect(() => {
    if (!enabled) return;
    depth += 1;
    emit();
    const remove = pushBackHandler(() => {
      handler.current();
      return true;
    });
    return () => {
      remove();
      depth -= 1;
      emit();
    };
  }, [enabled]);
}

export function useSectionBackActive(): boolean {
  return useSyncExternalStore(subscribe, active, inactive);
}
