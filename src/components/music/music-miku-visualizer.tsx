import { useEffect, useRef } from "react";
import portrait from "@/assets/music/miku-idle.webp";
import idleAtlas from "@/assets/music/miku-idle-motion.webp";
import closedEyes from "@/assets/music/miku-eyes-closed.webp";
import atlas from "@/assets/music/miku-motion.webp";
import swayDance from "@/assets/music/miku-dance-sway.webp";
import handDance from "@/assets/music/miku-dance-hands.webp";
import hipDance from "@/assets/music/miku-dance-hips.webp";
import { acquireMusicMeter } from "@/lib/music/audio-meter";
import { createMikuDance, createMikuDanceMemory, MIKU_DANCE } from "@/lib/music/miku-dance";
import { createMikuExpression } from "@/lib/music/miku-expression";
import { createMikuGroove, mikuFrame, mikuEnergy, MIKU_ATLAS, MIKU_TIMING } from "@/lib/music/miku-motion";
import type { MusicTrack } from "@/lib/music/types";
import type { MusicMeterStream } from "./music-dock-visualizer";
import "./music-miku-visualizer.css";

/* ANIMATION STORYBOARD
 *   idle      hands rest with quiet breathing/blinks; no paused audio analysis
 *   0–620ms   measured audio arrives → palms rise to the headphone cups
 *   listening bass/level envelope drives nods; hair follows with a softer response
 *   42s+      a strong musical phrase earns a short dance, then headphones
 *   75–95s    listening between dances; repertoire/cooldown survive song changes
 *   850ms     silence or lost signal → hands lower, movement settles
 *   reduced   static portrait; no animation loop or native meter acquired
 */
const DANCE_SHEETS = [swayDance, handDance, hipDance];
export function MikuArtwork({ className = "" }: { className?: string }) {
  return <img className={`music-miku-art ${className}`} src={portrait} alt="" aria-hidden="true" draggable={false} />;
}

export function MusicMikuVisualizer({ track, playing, stream = acquireMusicMeter }: {
  track: MusicTrack;
  playing: boolean;
  stream?: MusicMeterStream;
}) {
  const root = useRef<HTMLDivElement>(null);
  const danceMemory = useRef(createMikuDanceMemory());
  const playingRef = useRef(playing);
  const refresh = useRef<(() => void) | undefined>(undefined);
  useEffect(() => { playingRef.current = playing; refresh.current?.(); }, [playing]);
  const trackId = track.id, connectorId = track.connectorId ?? null;
  const supported = connectorId !== "spotify" && track.mediaKind !== "video";
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const sprite = host.querySelector<HTMLElement>(".music-miku-sprite");
    const dancer = host.querySelector<HTMLElement>(".music-miku-dancer");
    const eyelids = host.querySelector<HTMLElement>(".music-miku-eyes");
    let release: (() => void) | undefined, frame = 0, disposed = false;
    let target = 0, energy = 0, lift = 0, bob = 0, sway = 0;
    let sampledAt = 0, audibleAt = 0, previous = 0, painted = -1;
    const groove = createMikuGroove();
    const dance = createMikuDance(danceMemory.current);
    const expression = createMikuExpression();
    let eyesClosed = false;
    let danceState = dance.advance(0, { beat: 0, locked: false, excitement: 0 }, false, false);
    const loaded = new Set<number>();
    const sheets = new Map<number, HTMLImageElement>();
    const loadDance = () => {
      const kind = dance.next;
      if (sheets.has(kind)) return;
      const sheet = new Image();
      sheets.set(kind, sheet);
      sheet.onload = () => { if (!disposed) loaded.add(kind); };
      sheet.src = DANCE_SHEETS[kind];
    };
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const paint = () => {
      const index = mikuFrame(lift, bob * danceState.listening, sway * danceState.listening);
      if (sprite && painted !== index) {
        painted = index;
        const x = index % MIKU_ATLAS.columns, y = Math.floor(index / MIKU_ATLAS.columns);
        sprite.style.backgroundPosition = `${x * 100 / (MIKU_ATLAS.columns - 1)}% ${y * 100 / (MIKU_ATLAS.rows - 1)}%`;
        if (eyelids) eyelids.style.backgroundPosition = sprite.style.backgroundPosition;
        host.dataset.frame = String(index);
      }
      if (sprite) sprite.style.opacity = String(1 - danceState.opacity);
      if (eyelids) eyelids.style.opacity = eyesClosed && danceState.opacity === 0 ? "1" : "0";
      host.dataset.eyes = eyesClosed ? "closed" : "open";
      if (dancer) {
        dancer.style.opacity = String(danceState.opacity);
        if (danceState.opacity > 0) {
          const x = danceState.frame % MIKU_DANCE.columns, y = Math.floor(danceState.frame / MIKU_DANCE.columns);
          const rows = MIKU_DANCE.rows[danceState.kind];
          dancer.style.backgroundImage = `url(${DANCE_SHEETS[danceState.kind]})`;
          dancer.style.backgroundSize = `${MIKU_DANCE.columns * 100}% ${rows * 100}%`;
          dancer.style.backgroundPosition = `${x * 100 / (MIKU_DANCE.columns - 1)}% ${y * 100 / (rows - 1)}%`;
        } else dancer.style.backgroundImage = "none";
      }
      host.dataset.dance = danceState.stage;
      host.dataset.danceKind = String(danceState.kind);
      host.dataset.danceFrame = String(danceState.frame);
      host.dataset.stage = danceState.opacity > 0 ? "dancing" : lift < 0.01 ? "idle" : lift < 0.96 ? "reaching" : "listening";
    };
    const tick = (now: number) => {
      frame = 0;
      if (disposed) return;
      const dt = Math.min(64, previous ? now - previous : 16);
      previous = now;
      if (now - sampledAt > MIKU_TIMING.stale) target = 0;
      energy += (target - energy) * Math.min(1, dt / (target > energy ? 75 : 210));
      const driving = !!release && target > 0.04;
      const pulse = groove.advance(dt, driving);
      ({ bob, sway } = pulse);
      const holding = !!release && audibleAt > 0 && now - audibleAt < MIKU_TIMING.silence;
      danceState = dance.advance(dt, pulse, holding, loaded.has(dance.next));
      if (driving) loadDance();
      lift = Math.max(0, Math.min(1, lift + (holding ? dt / MIKU_TIMING.lift : -dt / MIKU_TIMING.settle)));
      eyesClosed = expression.advance(dt, holding && lift > 0.98 && danceState.stage === "listening", pulse.locked || bob > 0.025);
      paint();
      if (target > 0.002 || lift > 0 || energy > 0.002 || danceState.opacity > 0) frame = requestAnimationFrame(tick);
      else { energy = 0; bob = 0; sway = 0; groove.reset(); paint(); }
    };
    const start = () => { if (!frame) { previous = 0; frame = requestAnimationFrame(tick); } };
    const visible = () => {
      host.dataset.ambient = String(!document.hidden && !motion.matches && !!host.offsetWidth);
      if (!playingRef.current || !supported || document.hidden || motion.matches || !host.offsetWidth) {
        release?.(); release = undefined; target = 0; audibleAt = 0;
        if (motion.matches || document.hidden || !host.offsetWidth) {
          cancelAnimationFrame(frame); frame = 0; lift = 0; energy = 0; bob = sway = 0; groove.reset(); dance.reset();
          expression.reset(); eyesClosed = false;
          danceState = dance.advance(0, { beat: 0, locked: false, excitement: 0 }, false, false); paint();
        } else start();
      } else if (!release) {
        release = stream(state => {
          const now = performance.now();
          target = mikuEnergy(state, trackId, connectorId); sampledAt = now;
          if (target > 0.04) audibleAt = now;
          groove.sample(state, trackId, connectorId, now);
          if (target > 0.002 || lift > 0 || energy > 0.002) start();
        });
      }
    };
    refresh.current = visible;
    paint(); visible();
    const size = new ResizeObserver(visible); size.observe(host);
    document.addEventListener("visibilitychange", visible); motion.addEventListener("change", visible);
    return () => {
      disposed = true; release?.(); cancelAnimationFrame(frame); size.disconnect();
      for (const sheet of sheets.values()) sheet.onload = null;
      refresh.current = undefined;
      document.removeEventListener("visibilitychange", visible); motion.removeEventListener("change", visible);
      energy = 0; lift = 0; bob = sway = 0; groove.reset(); dance.reset();
      expression.reset(); eyesClosed = false;
      danceState = dance.advance(0, { beat: 0, locked: false, excitement: 0 }, false, false); paint();
    };
  }, [trackId, connectorId, supported, stream]);
  return <div ref={root} className="music-miku-perch" data-stage="idle" aria-hidden="true">
    <div className="music-miku-art music-miku-sprite" style={{ backgroundImage: `url(${atlas})`, backgroundSize: `${MIKU_ATLAS.columns * 100}% ${MIKU_ATLAS.rows * 100}%` }} />
    <div className="music-miku-eyes" style={{ backgroundImage: `url(${closedEyes})`, backgroundSize: `${MIKU_ATLAS.columns * 100}% ${MIKU_ATLAS.rows * 100}%` }} />
    <div className="music-miku-dancer" />
    <div className="music-miku-idle" style={{ backgroundImage: `url(${idleAtlas})` }} />
  </div>;
}
