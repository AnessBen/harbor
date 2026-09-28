import { useCallback, useEffect, useRef, useState } from "react";
import { Puzzle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  listBrowseCatalogs,
  subscribeBrowseCatalogs,
  type BrowseCatalog,
} from "@/lib/catalog-browse";
import { isExtensionCatalogueBase } from "@/lib/streams/plugins";
import { useView } from "@/lib/view";
import { useT } from "@/lib/i18n";
import { useContentDrag } from "@/lib/window-drag";
import { CatalogShelf } from "./catalogs/catalog-shelf";

/** Only the rows a plugin stood up itself. A plugin also registers a stream addon, but that addon
 * declares no catalogs, so every browsable row arrives as an extension catalogue base. */
function pluginCatalogs(all: BrowseCatalog[]): BrowseCatalog[] {
  return all.filter((c) => isExtensionCatalogueBase(c.base));
}

export function Plugins({ active = true }: { active?: boolean }) {
  const t = useT();
  const { authKey } = useAuth();
  const { openSettings } = useView();
  const contentDrag = useContentDrag();
  const [catalogs, setCatalogs] = useState<BrowseCatalog[]>([]);
  const [loading, setLoading] = useState(true);
  const genRef = useRef(0);
  void active;

  const load = useCallback(() => {
    const gen = ++genRef.current;
    return listBrowseCatalogs(authKey).then((list) => {
      // Two loads run at once on mount: this one and the one a runtime report triggers. Reading
      // the addons is the slow half, so the older call can land last and blank a filled list.
      if (gen !== genRef.current) return;
      setCatalogs(pluginCatalogs(list));
      setLoading(false);
    });
  }, [authKey]);

  useEffect(() => {
    // Subscribed before the first load, because a look that can answer synchronously would
    // otherwise report before anything was listening and the report would be lost.
    const stop = subscribeBrowseCatalogs(() => void load());
    setLoading(true);
    void load();
    return () => {
      genRef.current += 1;
      stop();
    };
  }, [load]);

  const grouped = new Map<string, BrowseCatalog[]>();
  for (const cat of catalogs) {
    const list = grouped.get(cat.addonName) ?? [];
    list.push(cat);
    grouped.set(cat.addonName, list);
  }

  return (
    <main className="flex-1 overflow-y-auto px-12 pb-24 pt-28">
      <div {...contentDrag} className="flex flex-col gap-8">
        <header className="flex flex-col gap-1.5">
          <h1 className="font-display text-[30px] font-medium tracking-tight text-ink">
            {t("Plugins")}
          </h1>
          <p className="text-[14px] text-ink-muted">
            {t("Poster rails that the installed plugins put up themselves.")}
          </p>
        </header>

        {loading ? (
          <ShelfSkeletons />
        ) : catalogs.length === 0 ? (
          <EmptyState onOpenPlugins={() => openSettings("plugins")} />
        ) : (
          [...grouped.entries()].map(([pluginName, list]) => (
            <section key={pluginName} className="flex flex-col gap-4">
              <div className="flex items-center gap-2.5">
                {list[0]?.addonLogo ? (
                  <img
                    src={list[0].addonLogo}
                    alt=""
                    draggable={false}
                    className="h-6 w-6 rounded-sm object-contain"
                  />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-elevated text-[11px] font-bold text-ink-subtle ring-1 ring-edge-soft">
                    {pluginName.charAt(0).toUpperCase()}
                  </span>
                )}
                <h2 className="text-[15.5px] font-semibold tracking-tight text-ink">{pluginName}</h2>
                <span className="text-[12px] text-ink-subtle">{list.length}</span>
              </div>
              <div className="flex flex-col gap-7">
                {list.map((c) => (
                  <CatalogShelf key={c.key} catalog={c} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </main>
  );
}

function ShelfSkeletons() {
  return (
    <div className="flex flex-col gap-10">
      {[0, 1, 2].map((s) => (
        <div key={s} className="flex flex-col gap-3">
          <div className="h-4 w-32 animate-pulse rounded-full bg-elevated/50" />
          <div className="flex gap-3 overflow-hidden">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="aspect-[2/3] w-36 shrink-0 animate-pulse rounded-xl bg-elevated/35"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onOpenPlugins }: { onOpenPlugins: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-edge-soft bg-canvas/30 px-8 py-16 text-center">
      <Puzzle size={30} strokeWidth={1.6} className="text-ink-subtle" />
      <div className="flex flex-col gap-1">
        <h2 className="text-[17px] font-semibold text-ink">{t("No plugin catalogs yet")}</h2>
        <p className="max-w-md text-[13px] leading-relaxed text-ink-muted">
          {t("Install a plugin that offers rows of its own and they show up here as poster rails.")}
        </p>
      </div>
      <button
        onClick={onOpenPlugins}
        className="flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-[13.5px] font-semibold text-canvas transition-opacity hover:opacity-90"
      >
        {t("Manage plugins")}
      </button>
    </div>
  );
}
