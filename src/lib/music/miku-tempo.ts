type Sample = { time: number; flux: number };

/** Short-window autocorrelation of measured onsets. No song database or preset BPM. */
export function mikuTempo(history: readonly Sample[], previous: number | null) {
  if (history.length < 32) return null;
  const step = (history.at(-1)!.time - history[0].time) / (history.length - 1);
  if (step < 15 || step > 160) return null;
  // Compress onset strength so alternating kick/snare accents still describe
  // one pulse instead of the louder kick winning at half the drum tempo.
  const onsets = history.map(sample => Math.sqrt(Math.max(0, sample.flux)));
  const mean = onsets.reduce((sum, onset) => sum + onset, 0) / onsets.length;
  const values = onsets.map(onset => onset - mean);
  const min = Math.max(2, Math.ceil(250 / step)), max = Math.min(Math.floor(900 / step), Math.floor(values.length / 2.5));
  const scores = new Map<number, number>();
  let best = 0, bestScore = 0;
  for (let lag = min - 1; lag <= max + 1; lag++) {
    let cross = 0, left = 0, right = 0;
    for (let i = lag; i < values.length; i++) {
      cross += values[i] * values[i - lag];
      left += values[i] ** 2; right += values[i - lag] ** 2;
    }
    const correlation = left * right > 1e-10 ? cross / Math.sqrt(left * right) : 0;
    scores.set(lag, correlation);
    const continuity = previous && Math.abs(lag * step - previous) < previous * 0.12 ? 0.045 : 0;
    if (lag >= min && lag <= max && correlation + continuity > bestScore) {
      best = lag; bestScore = correlation + continuity;
    }
  }
  if (!best || (scores.get(best) ?? 0) < 0.22) return null;
  // Resolve octave ambiguity only when real onsets also support the faster
  // pulse. A true slow groove with empty subdivisions must stay slow.
  const half = Math.round(best / 2);
  let subdivision = half;
  for (let lag = Math.max(min, half - 1); lag <= Math.min(max, half + 1); lag++) {
    if ((scores.get(lag) ?? 0) > (scores.get(subdivision) ?? 0)) subdivision = lag;
  }
  const subScore = scores.get(subdivision) ?? 0;
  if (subdivision >= min && subdivision < best && subScore >= 0.55 && subScore >= (scores.get(best) ?? 0) * 0.8) best = subdivision;
  const a = scores.get(best - 1) ?? 0, b = scores.get(best) ?? 0, c = scores.get(best + 1) ?? 0;
  const divisor = a - 2 * b + c;
  const fraction = Math.abs(divisor) > 1e-8 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / divisor)) : 0;
  const period = Math.max(250, Math.min(900, (best + fraction) * step));
  // Circular phase estimates the recurring pulse, rather than chasing every hi-hat.
  let x = 0, y = 0;
  for (const sample of history) {
    const angle = sample.time / period * Math.PI * 2;
    const weight = sample.flux ** 2;
    x += Math.cos(angle) * weight; y += Math.sin(angle) * weight;
  }
  const origin = Math.atan2(y, x) / (Math.PI * 2) * period;
  return { period, origin };
}
