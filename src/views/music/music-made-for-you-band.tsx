import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Play } from "@/components/icons/music-icons";
import { MUSIC_SHELF_MIN } from "@/components/music/music-catalog-row";
import { MusicMixCover } from "@/components/music/music-mix-cover";
import { MusicSectionHead } from "@/components/music/music-track-grid";
import { Row } from "@/components/row";
import { activeProfileId } from "@/lib/active-profile-id";
import { readListeningAffinity } from "@/lib/music/listening-affinity";
import { loadDailyMixTracks, planDailyMixes, type DailyMix } from "@/lib/music/daily-mixes";
import { requestMusicExplore } from "@/lib/music/navigation";
import { playMusic } from "@/lib/music/player";
import { recordMusicSimilarPlayback } from "@/lib/music/playback-origin";
import "@/components/music/music-cover-card.css";
import "./music-made-for-you-band.css";
import type { MusicBand, MusicBandContext } from "./music-band-types";

type Translate = MusicBandContext["t"];

function mixName(mix: DailyMix, t: Translate): string {
  return t("music.madeForYou.mix", { index: mix.index });
}

function MadeForYouRow({ mixes, t, title }: { mixes: DailyMix[]; t: Translate; title: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );

  const open = async (mix: DailyMix, play = false) => {
    const generation = ++request.current;
    setBusy(mix.id);
    setFailed(null);
    try {
      const tracks = await loadDailyMixTracks(mix);
      if (request.current !== generation) return;
      if (!tracks.length) throw new Error("music.radio.error");
      if (play) {
        recordMusicSimilarPlayback(tracks[0], tracks);
        await playMusic(tracks[0], tracks);
        return;
      }
      requestMusicExplore({
        kind: "similar",
        track: tracks[0],
        queue: tracks,
        label: mixName(mix, t),
      });
    } catch {
      if (request.current === generation) setFailed(mix.id);
    } finally {
      if (request.current === generation) setBusy(null);
    }
  };

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <MusicSectionHead title={title} subtitle={t("music.madeForYou.subtitle")} />
      <Row shape="square" min={MUSIC_SHELF_MIN} scrollKey="music:madeForYou" alwaysActive>
        {mixes.map((mix) => (
          <div key={mix.id} className="music-mix-card music-cover-card group">
            <div className="relative">
              <button
                type="button"
                onClick={() => void open(mix)}
                aria-label={t("music.card.openItem", { title: mixName(mix, t) })}
                className="flex w-full min-w-0 flex-col text-start"
              >
                <MusicMixCover
                  artwork={mix.artwork}
                  index={mix.index}
                  label={t("music.madeForYou.badge")}
                  seed={mix.id}
                />
                <span className="mt-[9px] truncate text-[13px] font-semibold text-ink">
                  {mixName(mix, t)}
                </span>
              </button>
              <div className="pointer-events-none absolute inset-x-0 top-0 aspect-square">
                <button
                  type="button"
                  className="music-cover-play no-press bg-ink text-canvas"
                  aria-label={t("music.card.playItem", { title: mixName(mix, t) })}
                  aria-busy={busy === mix.id || undefined}
                  disabled={busy === mix.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void open(mix, true);
                  }}
                >
                  {busy === mix.id ? (
                    <LoaderCircle
                      size={20}
                      aria-hidden="true"
                      className="animate-spin motion-reduce:animate-none"
                    />
                  ) : (
                    <Play size={20} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
            <span className="mt-px truncate text-[13px] text-ink-subtle">
              {failed === mix.id ? t("music.action.error") : mix.artists.join(", ")}
            </span>
          </div>
        ))}
      </Row>
    </section>
  );
}

export function madeForYouBand(ctx: MusicBandContext): MusicBand | null {
  const affinity = readListeningAffinity(activeProfileId());
  const mixes = planDailyMixes(ctx.player.recents, ctx.player.likedTracks, affinity);
  if (!mixes.length) return null;
  return {
    key: "madeForYou",
    title: ctx.t("music.madeForYou.title"),
    catalog: false,
    render: (title) => <MadeForYouRow mixes={mixes} t={ctx.t} title={title} />,
  };
}
