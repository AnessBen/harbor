import type { Meta, MetaType } from "@/lib/cinemeta";
import { PLUGIN_ADDON_PREFIX } from "../addon";
import { capstanId } from "./detail";
import type { InstalledStreamPlugin, PluginCatalogue } from "../types";
import type { BridgeProvider, BridgeSearchItem } from "./bridge";
import { bridgeCatalogue, bridgeCataloguePage, bridgeProviders } from "./bridge";

const MAX_PROVIDERS = 4;
const MAX_ROWS_PER_PROVIDER = 12;
const MAX_ROWS_PER_PLUGIN = 24;
const MAX_ITEMS = 60;
const EXHAUSTED_MAX = 200;

/** A provider says what it carries, not what each row carries, so the provider's answer is a row's
 * opening guess and any item that names its own kind overrides it. */
const META_TYPES: Readonly<Record<string, MetaType>> = {
  movie: "movie",
  documentary: "movie",
  nsfw: "movie",
  tvseries: "series",
  cartoon: "series",
  asiandrama: "series",
  anime: "anime",
  animemovie: "anime",
  ova: "anime",
  live: "tv",
};

function metaType(raw: unknown, fallback: MetaType): MetaType {
  if (typeof raw !== "string") return fallback;
  return META_TYPES[raw.toLowerCase().replace(/[^a-z]/g, "")] ?? fallback;
}

function providerMetaType(types: string[]): MetaType {
  for (const ty of types) {
    const hit = metaType(ty, "other");
    if (hit !== "other") return hit;
  }
  return "movie";
}

/** The catalogue's identity folded into one url shaped string, because that is the field every
 * browse surface already persists for a catalogue and reads back to fetch it again. */
export function extensionCatalogueBase(pluginId: string, providerId: string): string {
  return `${PLUGIN_ADDON_PREFIX}${pluginId}/${providerId}`;
}

export function parseExtensionCatalogueBase(
  base: string,
): { pluginId: string; providerId: string } | null {
  if (!base.startsWith(PLUGIN_ADDON_PREFIX)) return null;
  const rest = base.slice(PLUGIN_ADDON_PREFIX.length);
  const cut = rest.indexOf("/");
  if (cut <= 0) return null;
  const pluginId = rest.slice(0, cut);
  const providerId = rest.slice(cut + 1);
  return pluginId && providerId ? { pluginId, providerId } : null;
}

export function isExtensionCatalogueBase(base: string): boolean {
  return parseExtensionCatalogueBase(base) != null;
}

/** Providers are not filtered by their declared home page flag: the layer stands a row up for a
 * provider that answers the call without declaring one, and that row is its only entry point. */
function providersOf(plugin: InstalledStreamPlugin, all: BridgeProvider[]): BridgeProvider[] {
  const named = new Set(plugin.native?.providerIds ?? []);
  const extensionId = plugin.native?.extensionId ?? plugin.entryId;
  return all
    .filter((p) => named.has(p.id) || p.extensionId === extensionId)
    .slice(0, MAX_PROVIDERS);
}

export async function listExtensionCatalogues(
  plugin: InstalledStreamPlugin,
  log: (level: string, text: string) => void,
): Promise<PluginCatalogue[]> {
  const providers = providersOf(plugin, await bridgeProviders());
  const out: PluginCatalogue[] = [];
  for (const provider of providers) {
    if (out.length >= MAX_ROWS_PER_PLUGIN) break;
    // One provider refusing is not the plugin refusing, so it costs its own rows and is said out
    // loud rather than leaving a plugin looking as though it offers nothing to browse.
    const rows = await bridgeCatalogue(provider.id).catch((e: unknown) => {
      log("warn", `${provider.name}: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    });
    const type = providerMetaType(provider.types ?? []);
    for (const row of rows.slice(0, MAX_ROWS_PER_PROVIDER)) {
      out.push({
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginIcon: plugin.icon,
        providerId: provider.id,
        providerName: provider.name,
        type,
        row: row.name,
      });
      if (out.length >= MAX_ROWS_PER_PLUGIN) break;
    }
  }
  return out;
}

function text(v: unknown): string {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex -- Strip protocol control characters from plugin text.
  return v.replace(/[\x00-\x1f\x7f]/g, "").trim();
}

function image(v: unknown): string | undefined {
  const s = text(v);
  return /^https?:\/\//i.test(s) ? s : undefined;
}

function metaFor(cat: PluginCatalogue, item: BridgeSearchItem): Meta | null {
  const name = text(item.name).slice(0, 300);
  const url = text(item.url);
  if (!name || !url) return null;
  return {
    id: capstanId(cat.providerId, url),
    type: metaType(item.type, cat.type),
    name,
    poster: image(item.posterUrl),
    pluginQuality: text(item.quality).slice(0, 40) || undefined,
    addonOrigin: { id: cat.pluginId, name: cat.pluginName, logo: cat.pluginIcon },
  };
}

/** The page a row said was its last. A provider that ignores the page number answers the same
 * items forever, and asking it again costs a real request into a real service. */
const exhausted = new Map<string, number>();

function rowKey(cat: PluginCatalogue): string {
  return `${cat.providerId}|${cat.row}`;
}

export async function extensionCatalogueMetas(
  cat: PluginCatalogue,
  page: number,
): Promise<Meta[]> {
  const asked = Math.max(1, Math.trunc(page));
  const key = rowKey(cat);
  const last = exhausted.get(key);
  if (last != null && asked > last) return [];
  const found = await bridgeCataloguePage(cat.providerId, cat.row, asked);
  if (!found.hasNext) {
    if (exhausted.size >= EXHAUSTED_MAX) exhausted.clear();
    exhausted.set(key, asked);
  } else {
    exhausted.delete(key);
  }
  const out: Meta[] = [];
  const seen = new Set<string>();
  for (const item of found.items.slice(0, MAX_ITEMS)) {
    const meta = metaFor(cat, item);
    if (!meta || seen.has(meta.id)) continue;
    seen.add(meta.id);
    out.push(meta);
  }
  return out;
}
