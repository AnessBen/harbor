import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Pause, Play, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import "./video-pip.css";

type MpvEvent = { event: string; name?: string; data?: unknown };

const IDLE_MS = 2200;

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export function VideoPipApp() {
  const t = useT();
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  const [title, setTitle] = useState("");
  const [awake, setAwake] = useState(true);
  const idleTimer = useRef<number | null>(null);
  const scrubbing = useRef(false);

  const wake = useCallback(() => {
    setAwake(true);
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setAwake(false), IDLE_MS);
  }, []);

  useEffect(() => {
    wake();
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [wake]);

  // mpv broadcasts globally, so this window sees the same property stream the player does.
  useEffect(() => {
    let off: UnlistenFn | null = null;
    let cancelled = false;
    void (async () => {
      const stop = await listen<MpvEvent>("mpv://event", (event) => {
        const payload = event.payload;
        if (!payload || payload.event !== "property-change") return;
        const { name, data } = payload;
        if (name === "time-pos" && typeof data === "number") {
          if (!scrubbing.current) setPosition(data);
        } else if (name === "duration" && typeof data === "number") {
          setDuration(data);
        } else if (name === "pause" && typeof data === "boolean") {
          setPaused(data);
        }
      });
      if (cancelled) {
        stop();
        return;
      }
      off = stop;
    })();
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  // media-title is not one of the observed properties, so it is read once rather than
  // waited on.
  useEffect(() => {
    void invoke<unknown>("mpv_get_property", { name: "media-title" })
      .then((value) => {
        if (typeof value === "string") setTitle(value);
      })
      .catch(() => {});
    void invoke<unknown>("mpv_get_property", { name: "pause" })
      .then((value) => {
        if (typeof value === "boolean") setPaused(value);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const fit = () => void invoke("pip_window_fit").catch(() => {});
    window.addEventListener("resize", fit);
    fit();
    return () => window.removeEventListener("resize", fit);
  }, []);

  const toggle = useCallback(() => {
    const next = !paused;
    setPaused(next);
    void invoke("mpv_set_property", { name: "pause", value: next }).catch(() => {});
  }, [paused]);

  const seek = useCallback((seconds: number) => {
    setPosition(seconds);
    void invoke("mpv_command", { cmd: ["seek", seconds, "absolute"] }).catch(() => {});
  }, []);

  const restore = useCallback(() => {
    void invoke("pip_window_exit").catch(() => {});
  }, []);

  const stop = useCallback(() => {
    void invoke("pip_window_exit")
      .catch(() => {})
      .finally(() => {
        void invoke("mpv_command", { cmd: ["stop"] }).catch(() => {});
      });
  }, []);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === " " || event.key === "k") {
        event.preventDefault();
        toggle();
      } else if (event.key === "Escape") {
        restore();
      } else if (event.key === "ArrowLeft") {
        seek(Math.max(0, position - 5));
      } else if (event.key === "ArrowRight") {
        seek(Math.min(duration || position + 5, position + 5));
      }
      wake();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [toggle, restore, seek, position, duration, wake]);

  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <div
      className="vpip"
      data-awake={awake ? "" : undefined}
      onPointerMove={wake}
      onPointerLeave={() => setAwake(false)}
    >
      <div className="vpip-drag" data-tauri-drag-region />
      <div className="vpip-chrome">
        <div className="vpip-top">
          <span className="vpip-title">{title}</span>
          <div className="vpip-top-actions">
            <button type="button" onClick={restore} aria-label={t("Back to Harbor")}>
              <Maximize2 size={15} />
            </button>
            <button type="button" onClick={stop} aria-label={t("Stop and close")}>
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="vpip-bottom">
          <button
            type="button"
            className="vpip-play"
            onClick={toggle}
            aria-label={t(paused ? "Play" : "Pause")}
          >
            {paused ? <Play size={17} fill="currentColor" /> : <Pause size={17} />}
          </button>
          <div className="vpip-scrub">
            <div className="vpip-rail">
              <div className="vpip-fill" style={{ width: `${pct}%` }} />
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(1, duration)}
              step={0.1}
              value={position}
              aria-label={t("Seek")}
              onPointerDown={() => {
                scrubbing.current = true;
              }}
              onPointerUp={() => {
                scrubbing.current = false;
              }}
              onChange={(event) => seek(Number(event.target.value))}
            />
          </div>
          <span className="vpip-time">
            {clock(position)}
            <span className="vpip-time-total"> / {clock(duration)}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
