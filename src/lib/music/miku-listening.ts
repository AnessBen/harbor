/** Small listening gestures sit underneath the main performance.
 * A phrase has stronger and softer nods; an occasional two-beat lean answers
 * the drums. Reaches and dances own the body and suppress this layer.
 * None of these gestures creates a beat or moves a silent character.
 */
type ListeningPulse = {
  beat: number; locked: boolean; excitement: number; period: number | null;
  bob: number; sway: number;
};
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export function createMikuListeningPerformance() {
  let previous: number | null = null, earnedBeats = 0;
  let reaction = -1, reactionBeat = 0, next = 0;
  let gain = 1, lean = 0, spread = 1;
  const reset = () => {
    previous = null; earnedBeats = 0; reaction = -1; reactionBeat = 0;
    gain = spread = 1; lean = 0;
  };
  return {
    reset,
    advance(milliseconds: number, pulse: ListeningPulse, engaged: boolean) {
      const ms = Math.max(0, Number.isFinite(milliseconds) ? milliseconds : 0);
      const valid = engaged && pulse.locked && pulse.period !== null &&
        Number.isFinite(pulse.beat) && pulse.excitement > .12;
      const delta = previous === null ? 0 : pulse.beat - previous;
      const continuous = delta >= 0 && delta < 1.25 && ms < 700;
      const crossed = previous !== null && Math.floor(pulse.beat) > Math.floor(previous);
      previous = valid ? pulse.beat : null;
      if (!valid || !continuous) {
        reaction = -1; reactionBeat = 0; earnedBeats = 0;
      } else {
        earnedBeats += delta;
        // The cooldown is musical, with a wall-time floor so a fast track
        // cannot turn a small reaction into constant busy gesturing.
        const interval = Math.max(16, 9000 / pulse.period!);
        if (reaction < 0 && crossed && earnedBeats >= interval && pulse.excitement > .42) {
          reaction = next; next = (next + 1) % 3;
          reactionBeat = 0; earnedBeats = 0;
        } else if (reaction >= 0) {
          reactionBeat += delta;
          if (reactionBeat >= 2) reaction = -1;
        }
      }
      const envelope = reaction >= 0 ? Math.sin(Math.PI * clamp(reactionBeat / 2, 0, 1)) ** 2 : 0;
      const phrase = valid ? .96 + .04 * Math.cos(pulse.beat * Math.PI / 2) : 1;
      const weight = 1 - Math.exp(-Math.min(ms, 250) / 110);
      gain += ((valid ? phrase + envelope * .07 : 1) - gain) * weight;
      lean += ((reaction < 2 && reaction >= 0 ? (reaction === 0 ? -.20 : .20) * envelope : 0) - lean) * weight;
      spread += ((1 + (reaction === 2 ? .16 : .06) * envelope) - spread) * weight;
      // The source bob always supplies the drum timing. At zero it stays zero.
      return {
        bob: clamp(pulse.bob * gain, 0, 1),
        sway: clamp(pulse.sway * spread + lean, -1, 1),
        reaction: valid && reaction >= 0 ? ["lean-left", "lean-right", "accent"][reaction] : null,
      };
    },
  };
}
