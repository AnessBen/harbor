import { useMemo, useState } from "react";
import { ChevronLeft, ListPlus, Play, Plus } from "@/components/icons/music-icons";
import { MusicTrackGrid } from "@/components/music/music-track-grid";
import { useT } from "@/lib/i18n";
import { artistCreditParts } from "@/lib/music/search-artists";
import { addTracksToMusicPlaylist, createMusicPlaylist } from "@/lib/music/library";
import { enqueueMusic, playMusic } from "@/lib/music/player";
import { recordMusicSimilarPlayback } from "@/lib/music/playback-origin";
import type { MusicTrack } from "@/lib/music/types";

export function MusicSimilarPage({
  seed,
  tracks,
  state = "ready",
  label,
  onBack,
}: {
  seed: MusicTrack;
  tracks: MusicTrack[];
  state?: "loading" | "ready" | "error";
  label?: string;
  onBack: () => void;
}) {
  const t = useT();
  const [saved, setSaved] = useState<"idle" | "saving" | "done" | "error">("idle");
  const busy = state === "loading";

  const leads = useMemo(() => {
    const names = new Set<string>();
    for (const track of tracks) {
      const lead = (artistCreditParts(track.artist)[0] ?? track.artist).trim().toLowerCase();
      if (lead) names.add(lead);
    }
    return names.size;
  }, [tracks]);

  const start = (track: MusicTrack) => {
    recordMusicSimilarPlayback(seed, tracks);
    void playMusic(track, tracks).catch(() => {});
  };
  const playAll = () => start(tracks[0]);
  const queueAll = () => {
    for (const track of tracks) enqueueMusic(track);
  };
  const save = () => {
    if (saved === "saving") return;
    setSaved("saving");
    void createMusicPlaylist(label ?? t("music.similar.playlistName", { title: seed.title }))
      .then((playlist) => addTracksToMusicPlaylist(playlist.id, tracks))
      .then(() => setSaved("done"))
      .catch(() => setSaved("error"));
  };

  return (
    <section className="flex min-w-0 flex-col gap-6">
      <button
        type="button"
        data-music-inner-back
        onClick={onBack}
        className="flex min-h-11 w-fit items-center gap-2 text-sm text-ink-muted hover:text-ink"
      >
        <ChevronLeft size={17} className="dir-icon" aria-hidden="true" />
        {t("music.watch.back")}
      </button>

      <header className="flex min-w-0 flex-col gap-2">
        <h1 tabIndex={-1} className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          {label ?? t("music.similar.title", { title: seed.title })}
        </h1>
        <p className="text-sm text-ink-muted">
          {busy
            ? t("music.similar.building")
            : state === "error"
              ? t("music.similar.error")
              : t("music.similar.subtitle", { count: tracks.length, artists: leads })}
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={playAll}
          disabled={busy || tracks.length === 0}
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-canvas disabled:opacity-60"
        >
          <Play size={16} aria-hidden="true" />
          {t("music.similar.playAll")}
        </button>
        <button
          type="button"
          onClick={queueAll}
          disabled={busy || tracks.length === 0}
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-elevated px-4 text-sm font-semibold text-ink disabled:opacity-60"
        >
          <ListPlus size={16} aria-hidden="true" />
          {t("music.card.addToQueue")}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy || tracks.length === 0 || saved === "saving" || saved === "done"}
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-elevated px-4 text-sm font-semibold text-ink disabled:opacity-60"
        >
          <Plus size={16} aria-hidden="true" />
          {saved === "done"
            ? t("music.similar.saved")
            : saved === "error"
              ? t("music.action.error")
              : t("music.similar.save")}
        </button>
      </div>

      <MusicTrackGrid
        title={t("music.similar.heading")}
        tracks={tracks}
        status={state}
        error={state === "error" ? t("music.similar.error") : undefined}
        count={tracks.length}
        numbered
        onPlay={start}
      />
    </section>
  );
}
