import type { Meta } from "@/lib/cinemeta";
import { PLUGIN_ADDON_PREFIX } from "../addon";
import { capstanId } from "./detail";
import { metaType, providerMetaType } from "./meta-type";
import type { InstalledStreamPlugin, PluginCatalogue } from "../types";
import type { BridgeProvider, BridgeSearchItem } from "./bridge";
import { bridgeCatalogue, bridgeCataloguePage, bridgeProviders } from "./bridge";

const MAX_PROVIDERS = 4;
const MAX_ROWS_PER_PROVIDER = 12;
const MAX_ROWS_PER_PLUGIN = 24;
const MAX_ITEMS = 60;
const EXHAUSTED_MAX = 200;

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
export function providersOf(plugin: InstalledStreamPlugin, all: BridgeProvider[]): BridgeProvider[] {
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

/** A provider names a row after everything it carries -- the season range, the audio, the quality,
 * the size -- so the title it is actually about has to be taken back out of it before the row can
 * be shown, or searched for by name. In practice that trailing detail begins at the first bracket,
 * or at a release marker standing on its own. */
const TITLE_BREAK = /[({\[]/;
const RELEASE_BREAK =
  /(?:\s|^)(?:web-?dl|webrip|bluray|bdrip|hdtv|hdrip|dvdrip|remux|[a-z]{2,3}rip|[sh][0-9]{1,2}(?:e[0-9]{1,3})?|[0-9]{3,4}[pi])(?=\s|$)/i;

export function listingTitle(name: string): string {
  const raw = name.trim();
  if (!raw) return raw;
  const marks = [raw.search(TITLE_BREAK), raw.search(RELEASE_BREAK)].filter((at) => at >= 0);
  if (!marks.length) return raw;
  const head = raw
    .slice(0, Math.min(...marks))
    .replace(/[\s\-–—|·:,]+$/u, "")
    .trim();
  // "(500) Days of Summer" starts with a bracket and would leave nothing behind, so too short a
  // cut is refused rather than guessed at.
  return head.length >= 2 ? head : raw;
}

export function metaFor(cat: PluginCatalogue, item: BridgeSearchItem): Meta | null {
  const name = listingTitle(text(item.name)).slice(0, 300);
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
