import type { Meta } from "@/lib/cinemeta";
import { budget, gated } from "../catalogues";
import { pluginCatalogueSources } from "../runnable";
import type { InstalledStreamPlugin, PluginCatalogue } from "../types";
import { bridgeProviders, bridgeSearch, warmBridge, type BridgeProvider } from "./bridge";
import { metaFor, providersOf } from "./catalogue";
import { relevanceScore } from "./match";
import { providerMetaType } from "./meta-type";

const SEARCH_TIMEOUT_MS = 20_000;
const MAX_PER_PROVIDER = 30;
const MAX_PER_PLUGIN = 60;

/** One plugin's providers, asked for a title. Providers answer in parallel; the plugin's own
 * deadline covers the lot, because it is the plugin's budget rather than any one provider's. */
async function searchOne(
  plugin: InstalledStreamPlugin,
  providers: BridgeProvider[],
  query: string,
): Promise<Meta[]> {
  const settled = await Promise.allSettled(
    providers.map(async (provider) => {
      const cat: PluginCatalogue = {
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginIcon: plugin.icon,
        providerId: provider.id,
        providerName: provider.name,
        type: providerMetaType(provider.types ?? []),
        row: query,
      };
      // A provider that declares a quick search is asked with it, which is what that flag is for;
      // one that does not gets the ordinary search rather than a quick search it never wrote.
      const found = await bridgeSearch(provider.id, query, provider.hasQuickSearch);
      return { cat, items: found.items };
    }),
  );
  const out: Meta[] = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value.items.slice(0, MAX_PER_PROVIDER)) {
      const made = metaFor(result.value.cat, item);
      if (made) out.push(made);
    }
  }
  // Sorted before anything is capped, so the cap keeps the answers that were asked for rather than
  // whichever the provider happened to list first.
  return out
    .map((meta) => ({ meta, score: relevanceScore(meta.name, query) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.meta);
}

/** One plugin's answer, kept apart from every other plugin's. A provider is a source of a title,
 * not a source of the plugin's identity, so what one plugin found is read as that plugin's. */
export type PluginSearchGroup = {
  pluginId: string;
  pluginName: string;
  pluginIcon?: string;
  metas: Meta[];
};

/** Every plugin's hits as one list, with an item reached through more than one provider appearing
 * once: the same poster twice on a rail is a rail the reader has to read twice. */
export function mergeHits(groups: readonly Meta[][], max: number): Meta[] {
  const out: Meta[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const meta of group) {
      if (seen.has(meta.id)) continue;
      seen.add(meta.id);
      out.push(meta);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** One group per plugin that found something, in the order the plugins answered.
 *
 * The same title found by two plugins stays two groups: they are different sources of it, and
 * folding them together would hide which one has it. A plugin that found nothing gets no group,
 * and a plugin that failed gets none either, so neither leaves an empty rail behind. */
export function searchGroups(
  plugins: readonly { id: string; name: string; icon?: string }[],
  hits: readonly (Meta[] | null)[],
  maxPerPlugin: number,
): PluginSearchGroup[] {
  const out: PluginSearchGroup[] = [];
  plugins.forEach((plugin, i) => {
    const found = hits[i];
    if (!found) return;
    const metas = mergeHits([found], maxPerPlugin);
    if (!metas.length) return;
    out.push({
      pluginId: plugin.id,
      pluginName: plugin.name,
      pluginIcon: plugin.icon,
      metas,
    });
  });
  return out;
}

/** What the installed plugins have for a title, each plugin's answer kept apart.
 *
 * The searches run together because a search is one round trip per provider, not one per plugin,
 * and the bridge takes eight calls at once. A plugin that fails costs only its own group. */
export async function searchPlugins(query: string): Promise<PluginSearchGroup[]> {
  const wanted = query.trim();
  if (!wanted) return [];
  const plugins = pluginCatalogueSources();
  if (!plugins.length) return [];
  await warmBridge();
  const providers = await bridgeProviders().catch(() => [] as BridgeProvider[]);
  if (!providers.length) return [];
  const settled = await Promise.allSettled(
    plugins.map((plugin) =>
      gated(plugin, `"${wanted}"`, budget(plugin, SEARCH_TIMEOUT_MS), () =>
        searchOne(plugin, providersOf(plugin, providers), wanted),
      ),
    ),
  );
  return searchGroups(
    plugins,
    settled.map((result) => (result.status === "fulfilled" ? result.value : null)),
    MAX_PER_PLUGIN,
  );
}
