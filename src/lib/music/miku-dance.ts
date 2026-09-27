/** ANIMATION STORYBOARD
 * Most of the song → headphones and beat-driven nods.
 * After a listening break + a strong musical phrase → hands down → short dance.
 * Finish the complete loop → hands down → headphones, even during a peak.
 * Remember the repertoire and cooldown across tracks and visibility changes.
 */
export const MIKU_DANCE = {
  columns: 9, rows: [10, 10], reachFrames: 25, loopFrames: [64, 64],
  prepareMs: 140, enterMs: 800, leaveMs: 700, recoverMs: 140,
  restFrame: 15, lowerFraction: 0.45, restFraction: 0.12,
  leaveLowerFraction: 0.4, leaveRestFraction: 0.14,
  loopBeats: [2, 4], minimumEnergy: 0.5,
  firstWaitMs: 42000, breaksMs: [75000, 85000], minimumTrackBeats: 16,
  danceMs: 12000, defaultPeriodMs: 500,
  cancelMs: 180, rhythmGraceMs: 700,
} as const;

type Stage = "listening" | "preparing" | "entering" | "dancing" | "leaving" | "recovering" | "cancelled";
type Pulse = { beat: number; locked: boolean; excitement: number; period?: number | null };
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };

export function createMikuDanceMemory(initialKind = 0) {
  return {
    next: Number.isInteger(initialKind) && initialKind >= 0 && initialKind < MIKU_DANCE.loopFrames.length ? initialKind : 0,
    remainingMs: Number(MIKU_DANCE.firstWaitMs),
  };
}

export function createMikuDance(initial: number | ReturnType<typeof createMikuDanceMemory> = 0) {
  const memory = typeof initial === "number" ? createMikuDanceMemory(initial) : initial;
  if (!Number.isInteger(memory.next) || memory.next < 0 || memory.next >= MIKU_DANCE.loopFrames.length) memory.next = 0;
  let stage: Stage = "listening", kind = memory.next, elapsed = 0, listened = 0, lostRhythm = 0;
  let previous: number | null = null, frame = 0, opacity = 0, listening = 1;
  let performBeats = 16;
  let prepareBeats = 0.28, enterBeats = 1.72, leaveBeats = 1, recoverBeats = 0.28;
  const rememberDance = () => {
    // Alternate the two retained routines, including across track changes.
    memory.next = (kind + 1) % MIKU_DANCE.loopFrames.length;
    memory.remainingMs = MIKU_DANCE.breaksMs[kind];
  };
  const reset = () => {
    stage = "listening"; kind = memory.next; elapsed = listened = frame = opacity = 0;
    previous = null; listening = 1; lostRhythm = 0;
  };
  return {
    get next() { return kind; },
    reset,
    advance(milliseconds: number, pulse: Pulse, active: boolean, ready: boolean) {
      const ms = Math.max(0, Math.min(64, Number.isFinite(milliseconds) ? milliseconds : 0));
      const beat = Number.isFinite(pulse.beat) ? pulse.beat : 0;
      const excitement = Number.isFinite(pulse.excitement) ? clamp(pulse.excitement) : 0;
      const last = previous;
      const delta = last === null ? 0 : Math.max(0, Math.min(0.25, beat - last));
      previous = beat;
      lostRhythm = pulse.locked ? 0 : lostRhythm + ms;
      const phrase = stage !== "listening" && stage !== "cancelled";
      const driving = active && (pulse.locked || (phrase && lostRhythm < MIKU_DANCE.rhythmGraceMs));
      if (!driving && stage !== "listening" && stage !== "cancelled") {
        stage = "cancelled"; elapsed = 0;
      }
      if (stage === "cancelled") {
        elapsed += ms;
        opacity = Math.max(0, opacity - ms / MIKU_DANCE.cancelMs);
        listening = 1;
        if (elapsed >= MIKU_DANCE.cancelMs) {
          stage = "listening"; listened = 0; opacity = 0; kind = memory.next;
        }
      } else if (stage === "listening") {
        opacity = 0; listening = 1;
        if (driving) {
          listened += delta;
          memory.remainingMs = Math.max(0, memory.remainingMs - ms);
        } else listened = 0;
        const boundary = last !== null && Math.floor(beat / 4) > Math.floor(last / 4);
        if (driving && ready && boundary && memory.remainingMs === 0 && listened >= MIKU_DANCE.minimumTrackBeats && excitement >= MIKU_DANCE.minimumEnergy) {
          // Keep the sample's fractional beat, so the dance lands on the
          // measured drum pulse rather than starting a separate local clock.
          stage = "preparing"; elapsed = beat % 4;
          // Whole loops keep the hands aligned with the outgoing transition.
          // Tempo changes the frame rate, not how long the cameo dominates.
          const period = typeof pulse.period === "number" && Number.isFinite(pulse.period) && pulse.period > 0
            ? pulse.period : MIKU_DANCE.defaultPeriodMs;
          const loop = MIKU_DANCE.loopBeats[kind];
          performBeats = Math.max(1, Math.round(MIKU_DANCE.danceMs / Math.max(250, Math.min(1000, period)) / loop)) * loop;
          const entrance = Math.max(1, Math.round(MIKU_DANCE.enterMs / period));
          prepareBeats = Math.min(entrance * 0.3, MIKU_DANCE.prepareMs / period);
          enterBeats = entrance - prepareBeats;
          leaveBeats = Math.max(1, Math.round(MIKU_DANCE.leaveMs / period));
          recoverBeats = MIKU_DANCE.recoverMs / period;
        }
      } else {
        elapsed += delta;
        if (stage === "preparing") {
          listening = 1 - ease(elapsed / prepareBeats);
          if (elapsed >= prepareBeats) { elapsed -= prepareBeats; stage = "entering"; }
        }
        if (stage === "entering") {
          listening = 0; opacity = 1;
          const lower = enterBeats * MIKU_DANCE.lowerFraction;
          const riseAt = lower + enterBeats * MIKU_DANCE.restFraction;
          frame = elapsed < lower
            ? Math.round(clamp(elapsed / lower) * MIKU_DANCE.restFrame)
            : elapsed < riseAt ? MIKU_DANCE.restFrame
            : MIKU_DANCE.restFrame + Math.round(clamp((elapsed - riseAt) / (enterBeats - riseAt)) * (MIKU_DANCE.reachFrames - 1 - MIKU_DANCE.restFrame));
          if (elapsed >= enterBeats) {
            elapsed -= enterBeats; stage = "dancing"; rememberDance();
          }
        }
        if (stage === "dancing") {
          const cycle = (elapsed / MIKU_DANCE.loopBeats[kind]) % 1;
          frame = MIKU_DANCE.reachFrames + Math.floor(cycle * MIKU_DANCE.loopFrames[kind]);
          if (elapsed >= performBeats) { elapsed -= performBeats; stage = "leaving"; }
        }
        if (stage === "leaving") {
          const lower = leaveBeats * MIKU_DANCE.leaveLowerFraction;
          const riseAt = lower + leaveBeats * MIKU_DANCE.leaveRestFraction;
          frame = elapsed < lower
            ? MIKU_DANCE.reachFrames - 1 - Math.round(clamp(elapsed / lower) * (MIKU_DANCE.reachFrames - 1 - MIKU_DANCE.restFrame))
            : elapsed < riseAt ? MIKU_DANCE.restFrame
            : Math.round((1 - clamp((elapsed - riseAt) / (leaveBeats - riseAt))) * MIKU_DANCE.restFrame);
          if (elapsed >= leaveBeats) { elapsed -= leaveBeats; stage = "recovering"; }
        }
        if (stage === "recovering") {
          opacity = 0; listening = ease(elapsed / recoverBeats);
          if (elapsed >= recoverBeats) {
            stage = "listening"; listened = 0; listening = 1; kind = memory.next;
          }
        }
      }
      return { stage, kind, frame, opacity, listening };
    },
  };
}
