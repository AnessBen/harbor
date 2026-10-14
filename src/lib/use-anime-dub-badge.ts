import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  animeDubVersion,
  ensureAnimeDubData,
  getAnimeDubStatus,
  subscribeAnimeDub,
} from "./providers/anime-dub-availability";
import { animeDubLabel, type DubTitle } from "./providers/anime-dub-status";

export function useAnimeDubBadge(
  title: DubTitle | null,
  enabled: boolean,
  t: (key: string) => string,
): string {
  const subscribe = useCallback(
    (fn: () => void) => (enabled ? subscribeAnimeDub(fn) : () => {}),
    [enabled],
  );
  useSyncExternalStore(subscribe, animeDubVersion, animeDubVersion);
  useEffect(() => {
    if (enabled) void ensureAnimeDubData();
  }, [enabled]);
  return enabled && title ? animeDubLabel(getAnimeDubStatus(title), t) : "";
}
