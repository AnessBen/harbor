import type { MusicAudioMeterState } from "./audio-meter";
import { mikuTempo } from "./miku-tempo";

export const MIKU_TIMING = {
  lift: 620,
  settle: 460,
  silence: 850,
  stale: 700,
  beatGap: 180,
} as const;

/** Reject outgoing-track samples, missing taps and silence before driving the character. */
export function mikuEnergy(state: MusicAudioMeterState, trackId: string, connectorId: string | null) {
  const data = state.data;
  if (state.status !== "ready" || !data?.active || data.trackId !== trackId ||
      (data.connectorId ?? null) !== connectorId) return 0;
  const channels = data.channels.map(c => c.rmsDb).filter(Number.isFinite);
  if (!channels.length) return 0;
  const rms = Math.max(...channels);
  if (rms < -55) return 0;
  const bass = data.spectrumDb?.slice(0, 3).filter(db => Number.isFinite(db) && db > -119) ?? [];
  const bassDb = bass.length ? bass.reduce((a, b) => a + b, 0) / bass.length : rms;
  return Math.max(0, Math.min(1, ((rms + 55) / 45) * 0.65 + ((bassDb + 60) / 50) * 0.35));
}

export const MIKU_ATLAS = { columns: 18, rows: 28, frames: 492, tilts: 19 } as const;

/** Seventeen reach poses, then 25 nod depths at nineteen head/hair tilts.
 * The finer sideways sampling avoids visible snaps at the old seven-pose steps.
 */
export function mikuFrame(lift: number, bob: number, sway: number) {
  const clamp = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  lift = clamp(lift); bob = clamp(bob);
  if (lift < 0.99) return Math.round(lift * lift * (3 - 2 * lift) * 16);
  const lastTilt = MIKU_ATLAS.tilts - 1;
  const tilt = Number.isFinite(sway) ? Math.round(clamp((sway + 1) / 2) * lastTilt) : lastTilt / 2;
  return 17 + tilt * 25 + Math.round(bob * 24);
}

/** Learn the recurring pulse from bass onsets and carry it through softer beats.
 * Before a rhythm is established, isolated transients get a small relaxed nod.
 * A steady tone never establishes a tempo; missing/silent audio stops the drive.
 */
export function createMikuGroove() {
  let bands: number[] | null = null;
  let noise = 0, kickNoise = 0, snareNoise = 0, lastSample = 0, lastBeat = -Infinity;
  let position = 0, velocity = 0, sway = 0, swayVelocity = 0;
  let energy = 0, clock = 0, period: number | null = null, phase = 0, correction = 0, mix = 0;
  let estimatedAt = 0, confirmedAt = 0;
  let punch = 0, excitement = 0;
  const history: { time: number; flux: number }[] = [];
  return {
    sample(state: MusicAudioMeterState, trackId: string, connectorId: string | null, now: number) {
      energy = mikuEnergy(state, trackId, connectorId); clock = now;
      if (energy <= 0) { bands = null; return false; }
      // Kick body and snare attacks both drive the groove. Leave the top two
      // bands out so fast hi-hats alone cannot turn a slow song into double time.
      const spectrum = state.data?.spectrumDb?.slice(0, 6) ?? [];
      const hasSpectrum = spectrum.filter(db => Number.isFinite(db) && db > -119).length >= 3;
      const values = hasSpectrum
        ? spectrum.map(db => Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 70) / 70)) : 0)
        : [energy];
      const rise = values.map((value, index) => bands?.length === values.length ? Math.max(0, value - bands[index]) : 0);
      const kickFlux = hasSpectrum ? rise[0] * 0.5 + rise[1] * 0.35 + rise[2] * 0.15 : rise[0];
      // Snare attacks occupy several mid bands at once; sustained vocal tone
      // in one band must not raise the kick detector's threshold.
      const snareFlux = hasSpectrum && rise.slice(3).filter(value => value > 0.005).length >= 2
        ? (rise[3] ?? 0) * 0.2 + (rise[4] ?? 0) * 0.5 + (rise[5] ?? 0) * 0.3 : 0;
      const kick = Math.max(0, kickFlux - kickNoise * 0.7) / (0.04 + kickNoise * 2);
      const snare = Math.max(0, snareFlux - snareNoise * 0.7) / (0.06 + snareNoise * 2);
      const flux = hasSpectrum ? Math.min(1, Math.max(kick, snare * 0.85)) : kickFlux;
      const threshold = Math.max(hasSpectrum ? 0.08 : 0.012, noise * 1.6 + 0.004);
      const hit = flux > threshold && now - lastBeat >= MIKU_TIMING.beatGap;
      const dt = Math.max(1, Math.min(150, lastSample ? now - lastSample : 50));
      kickNoise += (kickFlux - kickNoise) * (1 - Math.exp(-dt / 1200));
      snareNoise += (snareFlux - snareNoise) * (1 - Math.exp(-dt / 1200));
      noise += (flux - noise) * (1 - Math.exp(-dt / 1000));
      bands = values; lastSample = now;
      // Midrange accents can punch up a nod without outvoting a steady kick
      // when choosing tempo. This also keeps vocal rhythm out of the clock.
      const rhythmFlux = hasSpectrum ? Math.min(1, Math.max(kick, snare * 0.45)) : flux;
      history.push({ time: now, flux: rhythmFlux });
      if (history.length > 128) history.shift();
      if (now - estimatedAt >= 350) {
        estimatedAt = now;
        const estimate = mikuTempo(history, period);
        if (estimate) {
          const fraction = ((now - estimate.origin) / estimate.period) % 1;
          if (period === null) phase = fraction;
          else {
            const error = fraction - ((phase % 1 + 1) % 1);
            correction = error - Math.round(error);
          }
          period = period === null ? estimate.period : period + (estimate.period - period) * 0.2;
          confirmedAt = now;
        }
      }
      if (hit) {
        lastBeat = now;
        const strength = Math.max(0.28, Math.min(1, Math.sqrt(Math.max(0, flux - threshold)) * 1.15));
        punch = Math.max(punch * 0.65, strength);
        // Actual kick/snare arrivals gently anchor the learned pulse between
        // window estimates. Offbeat fills can add weight without pulling the
        // whole choreography off its beat or snapping the head's position.
        if (mix > 0.8 && period !== null) {
          const error = phase - Math.round(phase);
          if (Math.abs(error) < 0.2) correction = -error * 4;
        }
        if (mix < 0.2) velocity = Math.min(8, velocity + 9 * strength);
      }
      return hit;
    },
    advance(milliseconds: number, driving = true) {
      let remaining = Math.max(0, Math.min(64, milliseconds)) / 1000;
      while (remaining > 0) {
        const dt = Math.min(0.008, remaining);
        clock += dt * 1000;
        const active = driving && energy > 0.04 && clock - lastSample < MIKU_TIMING.stale;
        const locked = active && period !== null && clock - confirmedAt < 6000;
        mix += ((locked ? 1 : 0) - mix) * Math.min(1, dt * 5);
        // Keep the learned clock through short gaps; confidence still gates
        // visible motion. A missed meter frame must not restart a dance phrase.
        if (period && clock - confirmedAt < 6000) phase += dt * 1000 / period + correction * dt;
        correction *= Math.exp(-dt * 2);
        punch *= Math.exp(-dt / 0.8);
        const tempoEnergy = period ? Math.max(0, Math.min(1, (60000 / period - 95) / 90)) : 0;
        // Movement intensity follows percussion, not overall RMS or the vocal
        // envelope. A gentle singer over hard kicks must keep the full bounce.
        const feeling = active ? Math.max(0.12, Math.min(1,
          0.12 + tempoEnergy * 0.52 * punch + punch * 0.65)) : 0;
        excitement += (feeling - excitement) * Math.min(1, dt / (feeling > excitement ? 0.45 : 1.8));
        // Fast, percussive sections earn the deeper poses; breakdowns ease back.
        const amplitude = (0.22 + excitement * 1.18) * (0.82 + punch * 0.28);
        // Lead the spring by its frequency-dependent lag, so the visible dip
        // lands on the pulse instead of trailing it more at faster tempos.
        const angular = period ? Math.PI * 2000 / period : 0;
        const anticipation = Math.atan2(22 * angular, 145 - angular * angular) / (Math.PI * 2) + 0.035;
        const target = mix * amplitude * (0.18 + 0.82 * (1 + Math.cos((phase + anticipation) * Math.PI * 2)) / 2);
        velocity += (145 * (target - position) - 22 * velocity) * dt;
        position += velocity * dt;
        const swayTarget = mix * (0.38 + excitement * 0.58) * Math.sin(phase * Math.PI);
        swayVelocity += (26 * (swayTarget - sway) - 9 * swayVelocity) * dt;
        sway += swayVelocity * dt;
        if (position > 1) { position = 1; velocity = Math.min(0, velocity); }
        if (position < 0) { position = 0; velocity = 0; }
        remaining -= dt;
      }
      if (Math.abs(position) < 0.001 && Math.abs(velocity) < 0.01) position = velocity = 0;
      return { bob: position, sway, period, locked: mix > 0.8, excitement, beat: phase };
    },
    reset() {
      bands = null; noise = kickNoise = snareNoise = 0; lastSample = 0; lastBeat = -Infinity; position = velocity = sway = swayVelocity = 0;
      energy = clock = phase = correction = mix = estimatedAt = confirmedAt = 0; period = null; history.length = 0;
      punch = excitement = 0;
    },
  };
}
