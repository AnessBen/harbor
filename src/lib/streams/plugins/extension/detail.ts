import type { Meta, MetaType } from "@/lib/cinemeta";
import { bridgeLoad, extensionsSupported, type BridgeMedia } from "./bridge";

export const CAPSTAN_ID_PREFIX = "capstan:";

export function isCapstanId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(CAPSTAN_ID_PREFIX);
}

/** The pair to [parseCapstanId]; both halves are encoded so neither can impersonate the colon
 * that separates them. */
export function capstanId(providerId: string, url: string): string {
  return `${CAPSTAN_ID_PREFIX}${encodeURIComponent(providerId)}:${encodeURIComponent(url)}`;
}

/** A browse surface persists one string per item, so a plugin's row folds its provider and the
 * item's own url into this id. Both halves were encoded, and encodeURIComponent leaves no raw
 * colon behind, so the first colon after the prefix is the separator. */
export function parseCapstanId(id: string): { providerId: string; url: string } | null {
  if (!isCapstanId(id)) return null;
  const rest = id.slice(CAPSTAN_ID_PREFIX.length);
  const cut = rest.indexOf(":");
  if (cut <= 0) return null;
  try {
    const providerId = decodeURIComponent(rest.slice(0, cut));
    const url = decodeURIComponent(rest.slice(cut + 1));
    return providerId && url ? { providerId, url } : null;
  } catch {
    return null;
  }
}

function yearOf(media: BridgeMedia): string | undefined {
  return typeof media.year === "number" && media.year > 0 ? String(media.year) : undefined;
}

/** The provider picks the unit: a CloudStream episode date is millis for most sources and seconds
 * for a few. Epoch seconds only pass 1e11 in the year 5138, and epoch millis passed it in 1973, so
 * the two cannot be confused. */
function airDateIso(value: number | null | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value > 1e11 ? value : value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Episodes keep the provider's own numbering, because playback re-finds them by season and
 * episode number rather than by anything an id could carry. */
function videosOf(media: BridgeMedia): Meta["videos"] {
  const episodes = Array.isArray(media.episodes) ? media.episodes : [];
  const out = episodes.map((ep) => {
    const description = ep.description ?? undefined;
    return {
      season: ep.season ?? undefined,
      episode: ep.episode ?? undefined,
      name: ep.name ?? undefined,
      title: ep.name ?? undefined,
      overview: description,
      description,
      thumbnail: ep.posterUrl ?? undefined,
      released: airDateIso(ep.airDate),
    };
  });
  return out.length ? out : undefined;
}

/** What a provider knows about one of its own items, in the shape the detail page already reads.
 * The bridge carries no cast or trailer list, so those stay empty rather than being invented. */
export function capstanMetaFrom(id: string, type: MetaType, media: BridgeMedia): Meta {
  return {
    id,
    type,
    name: media.name,
    poster: media.posterUrl ?? undefined,
    background: media.backgroundPosterUrl ?? undefined,
    description: media.plot ?? undefined,
    releaseInfo: yearOf(media),
    genres: media.tags?.length ? media.tags : undefined,
    videos: videosOf(media),
  };
}

export async function loadCapstanMeta(id: string, type: MetaType): Promise<Meta | null> {
  const parsed = parseCapstanId(id);
  if (!parsed || !extensionsSupported()) return null;
  const loaded = await bridgeLoad(parsed.providerId, parsed.url).catch(() => null);
  const media = loaded?.media;
  if (!media) return null;
  return capstanMetaFrom(id, type, media);
}
