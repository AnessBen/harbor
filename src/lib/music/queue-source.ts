import type { MusicSourceCandidate, MusicTrack } from "./types";

export function adoptCollectionOrigin(selected: MusicTrack, original: MusicTrack): MusicTrack {
  return {
    ...selected,
    collectionOrigin: original.collectionOrigin ?? {
      id: original.id,
      connectorId: original.connectorId,
    },
  };
}

export function replaceQueueTrack(
  queue: MusicTrack[],
  index: number,
  selected: MusicTrack,
): MusicTrack[] {
  const original = queue[index];
  if (!original || index < 0 || index >= queue.length) return queue;
  if (selected.connectorId === original.connectorId && selected.id === original.id) return queue;
  return queue.map((item, at) => (at === index ? adoptCollectionOrigin(selected, original) : item));
}

export function selectableSources(
  candidates: MusicSourceCandidate[],
  track: MusicTrack,
): MusicSourceCandidate[] {
  // Candidates arrive best-scoring first, so the first row for a service is the one to keep.
  // The track already playing is dropped before a service is claimed, or it would take the one
  // slot its service gets and hide every alternative behind it.
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (candidate.health === "offline") return false;
    if (candidate.connectorId === track.connectorId && candidate.track.id === track.id) {
      return false;
    }
    if (seen.has(candidate.connectorId)) return false;
    seen.add(candidate.connectorId);
    return true;
  });
}
