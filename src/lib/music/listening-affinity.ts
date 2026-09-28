import { musicTrackIdentity } from "./track-identity";
import { artistCreditParts } from "./search-artists";
import { readMusicPreference, writeMusicPreference } from "./preferences";
import type { MusicPlayerState, MusicTrack } from "./types";
export type ListeningAffinity = Record<string, { plays: number; at: number }>;
export function readListeningAffinity(profile: string): ListeningAffinity {
  try {
    const value = JSON.parse(readMusicPreference(`harbor.music.affinity.${profile}.v1`) ?? "{}");
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, { plays: number; at: number }] => {
      const row = entry[1] as { plays?: unknown; at?: unknown } | null;
      return !!row && typeof row.plays === "number" && Number.isFinite(row.plays) && row.plays > 0 && typeof row.at === "number" && Number.isFinite(row.at);
    }).slice(0, 250));
  } catch { return {}; }
}
export function createListeningObserver(record: (track: MusicTrack, profile: string) => void, clock = Date.now) {
  let last: { session: string; key: string; at: number; position: number; playing: boolean; heard: number; counted: boolean } | null = null;
  return (state: Pick<MusicPlayerState, "current" | "phase" | "currentTime" | "duration">, session: string, profile: string) => {
    const track = state.current, now = clock();
    if (!track || track.mediaKind === "video") { last = null; return; }
    const key = musicTrackIdentity(track), playing = state.phase === "playing";
    if (!last || last.session !== session || last.key !== key) {
      last = { session, key, at: now, position: state.currentTime, playing, heard: 0, counted: false }; return;
    }
    const elapsed = (now - last.at) / 1000, progress = state.currentTime - last.position;
    // Pauses, seeks, skipped tracks and repeated renders are not repeat listens.
    if (playing && last.playing && progress > 0 && progress <= 3 && elapsed > 0 && elapsed <= 3) last.heard += Math.min(elapsed, progress);
    last.at = now; last.position = state.currentTime; last.playing = playing;
    const duration = state.duration || track.durationSeconds;
    const threshold = duration > 0 ? Math.min(30, Math.max(5, duration / 2)) : 30;
    if (!last.counted && last.heard >= threshold) { last.counted = true; record(track, profile); }
  };
}
export const observeMusicListening = createListeningObserver((track, profile) => {
  const rows = readListeningAffinity(profile), key = musicTrackIdentity(track);
  rows[key] = { plays: Math.min(10_000, (rows[key]?.plays ?? 0) + 1), at: Date.now() };
  const bounded = Object.fromEntries(Object.entries(rows).sort((a,b) => b[1].at - a[1].at).slice(0,250));
  writeMusicPreference(`harbor.music.affinity.${profile}.v1`, JSON.stringify(bounded));
});
export function musicExploreSeeds(recent: readonly MusicTrack[], liked: readonly MusicTrack[], affinity: ListeningAffinity, now = Date.now()): MusicTrack[] {
  const likedKeys = new Set(liked.map(musicTrackIdentity));
  const artistCounts = new Map<string, number>();
  const artistKey = (track: MusicTrack) => (artistCreditParts(track.artist)[0] ?? track.artist).trim().toLocaleLowerCase();
  for (const track of recent) artistCounts.set(artistKey(track), (artistCounts.get(artistKey(track)) ?? 0) + 1);
  const unique = new Map<string, { track: MusicTrack; score: number }>();
  [...recent, ...liked].forEach((track, index) => {
    if (track.mediaKind === "video" || !track.artist.trim() || !track.title.trim()) return;
    const key = musicTrackIdentity(track); if (unique.has(key)) return;
    const repeat = affinity[key];
    const age = repeat ? Math.max(0, (now - repeat.at) / 86_400_000) : 0;
    unique.set(key, { track, score: (repeat ? Math.log2(1 + repeat.plays) * 4 / (1 + age / 30) : 0) + (artistCounts.get(artistKey(track)) ?? 0) * .6 + (likedKeys.has(key) ? 2 : 0) + 1 / (1 + index / 8) });
  });
  const seen = new Set<string>();
  return [...unique.values()].sort((a,b) => b.score - a.score).flatMap(({ track }) => {
    const key = artistKey(track); if (seen.has(key)) return []; seen.add(key); return [track];
  }).slice(0,6);
}
