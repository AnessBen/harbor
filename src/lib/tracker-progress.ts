// Entry-relative tracker progress for anime watches.
// Zero-dependency on purpose: unit-tested under node:test.

export function isOwnTrackerEntry(
  rowEntryId: string | null | undefined,
  trackId: string | null | undefined,
): boolean {
  return trackId != null && rowEntryId != null && rowEntryId === trackId;
}

export function resolveTrackEpisodeNumber(
  episode: number | undefined,
  opts: {
    sourceMetaId?: string | null;
    imdbEpisode?: number | null;
    seasonForeign: boolean;
    ownEntry: boolean;
  },
): number | undefined {
  // Rows tracked under their own entry always count cour/entry-relative
  // numbers (AniList/MAL count a part entry's episodes in cour order).
  if (opts.ownEntry && typeof episode === "number") return episode;
  if (opts.seasonForeign && typeof episode === "number") return episode;
  if (opts.sourceMetaId) return episode;
  return opts.imdbEpisode ?? episode;
}

// Picks the progress value to send for a tracker entry that counts
// `totalEpisodes`. An absolute from a different numbering (e.g. a
// part-relative absolute on a per-part entry) must never complete the entry
// early: absolute upgrades only while it stays strictly below the total.
export function resolveTrackerProgress(
  episode: number,
  absoluteEpisode: number | null,
  totalEpisodes: number,
): number {
  if (absoluteEpisode == null || absoluteEpisode <= episode) return episode;
  if (totalEpisodes > 0 && absoluteEpisode >= totalEpisodes && episode < totalEpisodes) {
    return episode;
  }
  return absoluteEpisode;
}
