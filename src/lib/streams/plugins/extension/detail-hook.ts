import { useEffect, useState } from "react";
import type { Meta } from "@/lib/cinemeta";
import { isCapstanId, loadCapstanMeta } from "./detail";

/** The provider's own description of an item, for a detail page that has no addon meta to read.
 * Null for every other id, and while the bridge is still answering. */
export function useCapstanMeta(meta: Meta): Meta | null {
  const id = meta.id;
  const type = meta.type;
  const [loaded, setLoaded] = useState<Meta | null>(null);
  useEffect(() => {
    setLoaded(null);
    if (!isCapstanId(id)) return;
    let cancelled = false;
    void loadCapstanMeta(id, type).then((found) => {
      if (!cancelled) setLoaded(found);
    });
    return () => {
      cancelled = true;
    };
  }, [id, type]);
  return isCapstanId(id) ? loaded : null;
}
