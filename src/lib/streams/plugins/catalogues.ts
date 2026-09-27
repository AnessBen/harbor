import type { Meta, MetaType } from "@/lib/cinemeta";
import { runnableStreamPlugins } from "./addon";
import { extensionsSupported, warmBridge } from "./extension/bridge";
import {
  extensionCatalogueMetas,
  listExtensionCatalogues,
  parseExtensionCatalogueBase,
} from "./extension/catalogue";
import { acquire, release } from "./gate";
import { pushLog } from "./runtime";
import { installedStreamPluginsSync, loadInstalledStreamPlugins, streamPluginById } from "./store";
import type { InstalledStreamPlugin, PluginCatalogue } from "./types";

const TTL_MS = 5 * 60_000;
const LIST_TIMEOUT_MS = 25_000;
const PAGE_TIMEOUT_MS = 20_000;

const subs = new Set<() => void>();
let cache: PluginCatalogue[] = [];
let checkedAt = 0;
let print = "";
let inflight: Promise<PluginCatalogue[]> | null = null;

function nativePlugins(): InstalledStreamPlugin[] {
  if (!extensionsSupported()) return [];
  return runnableStreamPlugins().filter((p) => p.format === "android-extension");
}

function fingerprint(plugins: InstalledStreamPlugin[]): string {
  return plugins.map((p) => `${p.id}@${p.hash}`).join("|");
}

function keys(list: PluginCatalogue[]): string {
  return list.map((c) => `${c.pluginId}|${c.providerId}|${c.row}`).join("|");
}

function notify(): void {
  for (const cb of subs) cb();
}

export function subscribeExtensionCatalogues(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

export function extensionCataloguesSync(): PluginCatalogue[] {
  return cache;
}

function budget(plugin: InstalledStreamPlugin, ceiling: number): number {
  return plugin.timeoutMs ? Math.min(plugin.timeoutMs, ceiling) : ceiling;
}

/** Gives [work] a deadline of its own. Every browse surface asks for a page through a plain fetcher
 * with no signal to carry, so the deadline is all there is to stop a dead provider holding a row. */
function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** Shares the one plugin gate and the plugin's own log, and deliberately leaves the health record
 * alone: that ledger answers how a search for a title went, and a browse would overwrite it with a
 * count for a row nobody asked about, which the picker reads back as an outage. */
async function gated<T>(
  plugin: InstalledStreamPlugin,
  what: string,
  ms: number,
  work: () => Promise<T>,
): Promise<T> {
  await acquire();
  const started = performance.now();
  try {
    const value = await within(work(), ms, what);
    pushLog(plugin.id, "info", `${what} in ${((performance.now() - started) / 1000).toFixed(1)}s`);
    return value;
  } catch (e) {
    pushLog(plugin.id, "warn", `${what}: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  } finally {
    release();
  }
}

async function collect(plugins: InstalledStreamPlugin[]): Promise<PluginCatalogue[]> {
  await warmBridge();
  const settled = await Promise.allSettled(
    plugins.map((plugin) =>
      gated(plugin, "catalogue rows", budget(plugin, LIST_TIMEOUT_MS), () =>
        listExtensionCatalogues(plugin, (level, text) => pushLog(plugin.id, level, text)),
      ),
    ),
  );
  const out: PluginCatalogue[] = [];
  for (const r of settled) if (r.status === "fulfilled") out.push(...r.value);
  return out;
}

async function look(): Promise<PluginCatalogue[]> {
  // The first look can land before the installed set has been read back, and stamping an empty
  // answer then would hold that emptiness for the whole session.
  if (!checkedAt && !installedStreamPluginsSync().length) {
    await loadInstalledStreamPlugins().catch(() => []);
  }
  const plugins = nativePlugins();
  const next = fingerprint(plugins);
  if (next === print && checkedAt && Date.now() - checkedAt < TTL_MS) return cache;
  const found = plugins.length ? await collect(plugins) : [];
  const changed = keys(found) !== keys(cache);
  cache = found;
  print = next;
  checkedAt = Date.now();
  if (changed) notify();
  return cache;
}

/** The rows a plugin offers change when it is installed or updated, not while it is browsed, so a
 * fresh look is skipped until the installed set changes or the last answer goes stale. */
export function refreshExtensionCatalogues(): Promise<PluginCatalogue[]> {
  inflight ??= look()
    .catch(() => cache)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function extensionCataloguePage(
  base: string,
  row: string,
  type: MetaType,
  page: number,
): Promise<Meta[]> {
  const parsed = parseExtensionCatalogueBase(base);
  if (!parsed || !extensionsSupported()) return [];
  const plugin = streamPluginById(parsed.pluginId);
  if (!plugin || plugin.format !== "android-extension") return [];
  await warmBridge();
  const cat: PluginCatalogue = {
    pluginId: plugin.id,
    pluginName: plugin.name,
    pluginIcon: plugin.icon,
    providerId: parsed.providerId,
    type,
    row,
  };
  return gated(plugin, `${row} page ${page}`, budget(plugin, PAGE_TIMEOUT_MS), () =>
    extensionCatalogueMetas(cat, page),
  );
}
