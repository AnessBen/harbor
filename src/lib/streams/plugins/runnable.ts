import { adultContentHidden } from "@/lib/addons-store/adult-filter";
import { extensionsSupported } from "./extension/bridge";
import { installedStreamPluginsSync } from "./store";
import type { InstalledStreamPlugin } from "./types";

/** The plugins the stream pipeline would actually run: installed, switched on, and not stood down
 * by their repository, their own version, an outage, or the adult filter.
 *
 * This lives apart from the addon layer that consumes it because the navigation chrome needs the
 * same answer to decide whether a plugin tab is worth showing, and the addon layer reaches into
 * the worker runtime that chrome should not have to load. */
export function runnableStreamPlugins(): InstalledStreamPlugin[] {
  const hideAdult = adultContentHidden();
  return installedStreamPluginsSync().filter(
    (p) =>
      p.enabled &&
      !p.repoDisabled &&
      !p.incompatible &&
      !p.autoPaused &&
      p.listed &&
      !(p.nsfw && hideAdult),
  );
}

/** Of those, the ones that can stand up browsable rows of their own. Only a native extension
 * reaches the catalogue layer, and only where the bridge exists, which is the desktop app. */
export function pluginCatalogueSources(): InstalledStreamPlugin[] {
  if (!extensionsSupported()) return [];
  return runnableStreamPlugins().filter((p) => p.format === "android-extension");
}
