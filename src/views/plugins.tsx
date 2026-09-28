import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Puzzle, Search, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  listBrowseCatalogs,
  subscribeBrowseCatalogs,
  type BrowseCatalog,
} from "@/lib/catalog-browse";
import { isExtensionCatalogueBase, subscribeStreamPlugins } from "@/lib/streams/plugins";
import { searchPlugins, type PluginSearchGroup } from "@/lib/streams/plugins/extension/search";
import { useView } from "@/lib/view";
import { useT } from "@/lib/i18n";
import { useContentDrag } from "@/lib/window-drag";
import { FeedShelf } from "@/components/feed-shelf";
import { CatalogShelf } from "./catalogs/catalog-shelf";
import { PluginPicker, ALL_PLUGINS } from "./plugins/plugin-picker";
import { PluginHero } from "./plugins/plugin-hero";

const SEARCH_DEBOUNCE_MS = 350;

/** The plugin the tab was last left on, kept the way the other views keep a small choice. */
const PLUGIN_FILTER_KEY = "harbor.plugins.filter";

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
  const [query, setQuery] = useState("");
  const [pluginFilter, setPluginFilter] = useState(
    () => localStorage.getItem(PLUGIN_FILTER_KEY) ?? ALL_PLUGINS,
  );
  const [results, setResults] = useState<PluginSearchGroup[] | null>(null);
  const genRef = useRef(0);
  const searchGen = useRef(0);
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
    //
    // Both sources, because a plugin appearing or going is a change to the installed set, and the
    // catalogue look is told about the set rather than listening to it: it answers on its own
    // schedule, so without this the tab keeps showing the rails of whichever plugins were installed
    // when it was last opened.
    const stop = subscribeBrowseCatalogs(() => void load());
    const stopPlugins = subscribeStreamPlugins(() => void load());
    setLoading(true);
    void load();
    return () => {
      genRef.current += 1;
      stop();
      stopPlugins();
    };
  }, [load]);

  const grouped = new Map<string, BrowseCatalog[]>();
  for (const cat of catalogs) {
    const list = grouped.get(cat.addonName) ?? [];
    list.push(cat);
    grouped.set(cat.addonName, list);
  }

  const wanted = query.trim();

  useEffect(() => {
    localStorage.setItem(PLUGIN_FILTER_KEY, pluginFilter);
  }, [pluginFilter]);

  // A remembered plugin can be uninstalled between visits, and a name no row answers to would
  // leave the tab showing nothing at all. Only checked once the plugins are known, so an empty
  // first render cannot wipe the choice.
  useEffect(() => {
    if (loading || !pluginFilter || !catalogs.length) return;
    if (!catalogs.some((c) => c.addonName === pluginFilter)) setPluginFilter(ALL_PLUGINS);
  }, [catalogs, loading, pluginFilter]);

  // The picker and the hero read the same selection, so a chosen plugin's rows are what the tab
  // lists and what the hero is made of.
  const pickerPlugins = [...grouped.entries()].map(([name, list]) => ({
    name,
    icon: list[0]?.addonLogo,
  }));
  const shownGroups = pluginFilter
    ? [...grouped.entries()].filter(([name]) => name === pluginFilter)
    : [...grouped.entries()];
  const heroCatalogs = useMemo(
    () => shownGroups.flatMap(([, list]) => list),
    [catalogs, pluginFilter],
  );

  useEffect(() => {
    const gen = ++searchGen.current;
    if (!wanted) {
      setResults(null);
      return;
    }
    // Typing must not start a search per keystroke, and a slower search must not land after a
    // faster one and answer for what was typed two words ago.
    const timer = setTimeout(() => {
      void searchPlugins(wanted)
        .then((found) => {
          if (gen === searchGen.current) setResults(found);
        })
        .catch(() => {
          if (gen === searchGen.current) setResults([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [wanted]);

  useEffect(() => () => void (searchGen.current += 1), []);

  const searchingShelf = { id: "plugin-search", title: t("Results for {q}", { q: wanted }) };

  return (
    <main className="flex-1 overflow-y-auto px-12 pb-24 pt-28">
      <div {...contentDrag} className="flex flex-col gap-8">
        <header className="flex items-center justify-end gap-6">
          {!loading && catalogs.length > 0 && (
            <PluginPicker
              plugins={pickerPlugins}
              value={pluginFilter}
              onChange={setPluginFilter}
            />
          )}
        </header>

        {!loading && catalogs.length > 0 && !wanted && (
          <PluginHero catalogs={heroCatalogs} showOrigin={pluginFilter === ALL_PLUGINS} />
        )}

        {!loading && catalogs.length > 0 && (
          <div data-plugins-search className="relative h-11 w-full max-w-[420px]">
            <Search
              size={16}
              className="absolute start-3.5 top-1/2 -translate-y-1/2 text-ink-subtle"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search the plugins for a title")}
              spellCheck={false}
              className="h-full w-full rounded-full border border-edge-soft bg-elevated/40 ps-10 pe-9 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-subtle focus:border-edge"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label={t("Clear")}
                className="absolute end-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-canvas/60 hover:text-ink"
              >
                <X size={15} />
              </button>
            )}
          </div>
        )}

        {wanted ? (
          results === null ? (
            <FeedShelf shelf={searchingShelf} items={null} />
          ) : results.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-edge-soft bg-canvas/30 px-6 py-12 text-center text-[13.5px] text-ink-muted">
              {t("No plugin has anything for that title.")}
            </p>
          ) : (
            results.map((group) => (
              <FeedShelf
                key={group.pluginId}
                shelf={{
                  id: `plugin-search:${group.pluginId}`,
                  title: group.pluginName,
                  kicker: t("{n} results", { n: group.metas.length }),
                }}
                items={group.metas}
              />
            ))
          )
        ) : loading ? (
          <ShelfSkeletons />
        ) : catalogs.length === 0 ? (
          <EmptyState onOpenPlugins={() => openSettings("plugins")} />
        ) : (
          shownGroups.map(([pluginName, list]) => (
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
