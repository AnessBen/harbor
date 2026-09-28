import { useT } from "@/lib/i18n";
import "./music-now-playing-mark.css";

export function MusicNowPlayingMark() {
  const t = useT();
  return (
    <span className="music-live-mark" aria-label={t("music.nowPlaying")} role="img">
      <span className="music-eq-bars" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}
