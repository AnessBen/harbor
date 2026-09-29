import { Play } from "@/components/icons/music-icons";
import { Poster } from "@/components/poster";
import { Row } from "@/components/row";
import type { MusicTrack } from "@/lib/music/types";
import type { MusicBand, MusicBandContext } from "./music-band-types";
import "./music-new-release-ctas.css";

const MAX_CARDS = 10;

/** One card per release, not per track, so a six track drop does not fill the row with itself. */
function releases(tracks: readonly MusicTrack[]): MusicTrack[] {
  const seen = new Set<string>();
  const out: MusicTrack[] = [];
  for (const track of tracks) {
    const title = (track.album || track.title).trim();
    const artist = track.artist.trim();
    if (!title || !artist) continue;
    const key = `${artist.toLocaleLowerCase()}|${title.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(track);
    if (out.length >= MAX_CARDS) break;
  }
  return out;
}

export function newReleaseCtaBand(ctx: MusicBandContext): MusicBand | null {
  const cards = releases(ctx.data.fresh);
  if (cards.length < 2) return null;
  const t = ctx.t;
  return {
    key: "music:new-release-ctas",
    title: t("music.newRelease.title"),
    catalog: false,
    render: (title) => (
      <Row title={title} headerDescription={t("music.newRelease.subtitle")} min={340} shape="landscape" scrollKey="music:newReleaseCtas">
        {cards.map((track) => (
          <button
            key={`${track.connectorId ?? ""}:${track.id}`}
            type="button"
            className="music-cta-card"
            onClick={() => ctx.playTrack(track, cards)}
            aria-label={t("music.newRelease.listen", { title: track.album || track.title })}
          >
            <span className="music-cta-art">
              <Poster src={track.artwork} seed={track.id} ratio="square" lazy className="h-full w-full [--poster-radius:0px]" />
            </span>
            <span className="music-cta-body">
              <span className="music-cta-eyebrow">{t("music.newRelease.eyebrow")}</span>
              <span className="music-cta-line">
                {t("music.newRelease.outNow", { title: track.album || track.title })}
              </span>
              <span className="music-cta-artist">{track.artist}</span>
              <span className="music-cta-play">
                <Play size={13} fill="currentColor" aria-hidden="true" />
                {t("music.newRelease.action")}
              </span>
            </span>
          </button>
        ))}
      </Row>
    ),
  };
}
