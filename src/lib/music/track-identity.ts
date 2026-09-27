import { normalizeName } from "./search-normalize";
import { artistCreditParts } from "./search-artists";
import type { MusicTrack } from "./types";

export function musicTrackIdentity(track: Pick<MusicTrack, "id" | "connectorId" | "title" | "artist">): string {
  const title = normalizeName(track.title ?? "");
  const lead = normalizeName(artistCreditParts(track.artist ?? "")[0] ?? track.artist ?? "");
  if (!title || !lead) return `${track.connectorId ?? ""}:${track.id}`;
  return `${title}::${lead}`;
}

export function sameMusicTrack(
  left: Pick<MusicTrack, "id" | "connectorId" | "title" | "artist">,
  right: Pick<MusicTrack, "id" | "connectorId" | "title" | "artist">,
): boolean {
  return left.id === right.id || musicTrackIdentity(left) === musicTrackIdentity(right);
}

export function dedupeMusicTracks<T extends Pick<MusicTrack, "id" | "connectorId" | "title" | "artist">>(
  tracks: readonly T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const track of tracks) {
    const key = musicTrackIdentity(track);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(track);
  }
  return out;
}
