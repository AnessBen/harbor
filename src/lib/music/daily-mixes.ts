import { artistCreditParts } from "./search-artists";
import { musicTrackIdentity } from "./track-identity";
import { loadPlaylistLikeThis } from "./radio";
import type { ListeningAffinity } from "./listening-affinity";
import type { MusicTrack } from "./types";

export type DailyMix = {
  id: string;
  index: number;
  artists: string[];
  seeds: MusicTrack[];
  artwork: string[];
};

const MAX_MIXES = 6;
const ARTISTS_PER_MIX = 3;
const MIN_ARTISTS = 2;
const MIN_SEEDS = 2;
const NEIGHBOUR_WINDOW = 5;
const MIX_SIZE = 50;

export function mixArtistKey(track: MusicTrack): string {
  return (artistCreditParts(track.artist)[0] ?? track.artist).trim().toLocaleLowerCase();
}

function artistLabel(track: MusicTrack): string {
  return (artistCreditParts(track.artist)[0] ?? track.artist).trim();
}

function trackScore(
  track: MusicTrack,
  index: number,
  liked: Set<string>,
  affinity: ListeningAffinity,
  now: number,
): number {
  const key = musicTrackIdentity(track);
  const repeat = affinity[key];
  const age = repeat ? Math.max(0, (now - repeat.at) / 86_400_000) : 0;
  const plays = repeat ? (Math.log2(1 + repeat.plays) * 4) / (1 + age / 30) : 0;
  return plays + (liked.has(key) ? 2 : 0) + 1 / (1 + index / 8);
}

export function planDailyMixes(
  recents: readonly MusicTrack[],
  liked: readonly MusicTrack[],
  affinity: ListeningAffinity,
  now = Date.now(),
): DailyMix[] {
  const likedKeys = new Set(liked.map(musicTrackIdentity));
  const pool = [...recents, ...liked].filter(
    (track) => track.mediaKind !== "video" && track.artist.trim() && track.title.trim(),
  );

  const artists = new Map<string, { label: string; score: number; tracks: MusicTrack[] }>();
  const seenTrack = new Set<string>();
  pool.forEach((track, index) => {
    const identity = musicTrackIdentity(track);
    if (seenTrack.has(identity)) return;
    seenTrack.add(identity);
    const key = mixArtistKey(track);
    if (!key) return;
    const score = trackScore(track, index, likedKeys, affinity, now);
    const found = artists.get(key);
    if (found) {
      found.score += score;
      found.tracks.push(track);
    } else {
      artists.set(key, { label: artistLabel(track), score, tracks: [track] });
    }
  });

  const order = recents.map(mixArtistKey).filter(Boolean);
  const near = new Map<string, Map<string, number>>();
  for (let at = 0; at < order.length; at += 1) {
    for (let step = 1; step <= NEIGHBOUR_WINDOW && at + step < order.length; step += 1) {
      const left = order[at];
      const right = order[at + step];
      if (left === right) continue;
      for (const [from, to] of [
        [left, right],
        [right, left],
      ]) {
        const row = near.get(from) ?? new Map<string, number>();
        row.set(to, (row.get(to) ?? 0) + 1);
        near.set(from, row);
      }
    }
  }

  const ranked = [...artists.entries()].sort((left, right) => right[1].score - left[1].score);
  const used = new Set<string>();
  const mixes: DailyMix[] = [];
  for (const [key] of ranked) {
    if (mixes.length >= MAX_MIXES) break;
    if (used.has(key)) continue;
    const group = [key];
    used.add(key);
    const neighbours = [...(near.get(key) ?? new Map<string, number>())]
      .filter(([other]) => !used.has(other) && artists.has(other))
      .sort((left, right) => right[1] - left[1]);
    for (const [other] of neighbours) {
      if (group.length >= ARTISTS_PER_MIX) break;
      group.push(other);
      used.add(other);
    }
    if (group.length < MIN_ARTISTS) {
      for (const [other] of ranked) {
        if (group.length >= MIN_ARTISTS) break;
        if (used.has(other)) continue;
        group.push(other);
        used.add(other);
      }
    }
    if (group.length < MIN_ARTISTS) continue;
    const seeds = group.flatMap((entry) => artists.get(entry)?.tracks.slice(0, 4) ?? []);
    if (seeds.length < MIN_SEEDS) continue;
    const artwork: string[] = [];
    for (const track of seeds) {
      const art = track.artwork?.trim();
      if (art && !artwork.includes(art)) artwork.push(art);
      if (artwork.length === 4) break;
    }
    mixes.push({
      id: `mix:daily:${mixes.length + 1}`,
      index: mixes.length + 1,
      artists: group.flatMap((entry) => artists.get(entry)?.label ?? []),
      seeds,
      artwork,
    });
  }
  return mixes;
}

export function loadDailyMixTracks(
  mix: DailyMix,
  skip: readonly MusicTrack[] = [],
): Promise<MusicTrack[]> {
  return loadPlaylistLikeThis(mix.seeds, MIX_SIZE, skip);
}
