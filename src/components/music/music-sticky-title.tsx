import { useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, Pause, Play } from "@/components/icons/music-icons";
import { useT } from "@/lib/i18n";
import { useCollectionPlayback } from "@/lib/music/use-collection-playback";
import type { MusicTrack } from "@/lib/music/types";
import "./music-sticky-title.css";

export function MusicStickyTitle({
  title,
  tracks,
  onPlay,
  children,
}: {
  title: string;
  tracks: MusicTrack[];
  onPlay: (track: MusicTrack, queue: MusicTrack[]) => void;
  children?: ReactNode;
}) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  const now = useRef(false);
  const { playing, busy, play } = useCollectionPlayback(tracks, onPlay);
  useEffect(() => {
    const node = host.current;
    const scroller = node?.closest("main");
    if (!node || !scroller) return;
    const read = () => {
      const pin =
        scroller.getBoundingClientRect().top +
        Number.parseFloat(getComputedStyle(scroller).paddingTop || "0");
      const next = node.getBoundingClientRect().top <= pin + 1;
      if (next === now.current) return;
      now.current = next;
      setStuck(next);
    };
    read();
    scroller.addEventListener("scroll", read, { passive: true });
    const watch = new ResizeObserver(read);
    watch.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", read);
      watch.disconnect();
    };
  }, [title]);
  const label = t(playing ? "music.pause" : "music.play");
  return (
    <div ref={host} className="music-sticky-title" data-on={stuck || undefined}>
      <div className="music-sticky-title-bar">
        <button
          type="button"
          className="music-sticky-play"
          onClick={play}
          disabled={!tracks.length || busy}
          tabIndex={stuck ? 0 : -1}
          aria-hidden={!stuck}
          aria-label={label}
          title={label}
        >
          {busy ? (
            <LoaderCircle
              size={20}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden
            />
          ) : playing ? (
            <Pause size={20} fill="currentColor" aria-hidden />
          ) : (
            <Play size={20} fill="currentColor" aria-hidden />
          )}
        </button>
        <span className="music-sticky-name">{title}</span>
        {children}
      </div>
    </div>
  );
}
