import { LoaderCircle } from "@/components/icons/music-icons";
import { useT } from "@/lib/i18n";
import "./music-now-playing-mark.css";

/** Resolving a source takes a moment, so the badge waits as a spinner before it starts moving. */
export function MusicNowPlayingMark({ loading = false }: { loading?: boolean }) {
  const t = useT();
  return (
    <span
      className="music-live-mark"
      data-loading={loading || undefined}
      aria-label={t(loading ? "music.loading" : "music.nowPlaying")}
      role="img"
    >
      {loading ? (
        <LoaderCircle
          size={13}
          aria-hidden="true"
          className="animate-spin motion-reduce:animate-none"
        />
      ) : (
        <span className="music-eq-bars" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
    </span>
  );
}
