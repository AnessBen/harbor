/** Eyelids are an expression, not another audio meter. Separate sustained
 * engagement from each nod so tempo cannot hold a blink halfway or flutter it.
 */
export function createMikuExpression() {
  let closed = false, engagedFor = 0, quietFor = 0;
  return {
    reset() { closed = false; engagedFor = quietFor = 0; },
    advance(milliseconds: number, engaged: boolean, moving: boolean) {
      const dt = Math.max(0, Math.min(64, milliseconds));
      if (!engaged) { closed = false; engagedFor = quietFor = 0; return false; }
      if (!closed) {
        engagedFor = moving ? engagedFor + dt : Math.max(0, engagedFor - dt * 0.25);
        if (engagedFor >= 900) { closed = true; quietFor = 0; }
      } else {
        quietFor = moving ? 0 : quietFor + dt;
        if (quietFor >= 2200) { closed = false; engagedFor = quietFor = 0; }
      }
      return closed;
    },
  };
}
