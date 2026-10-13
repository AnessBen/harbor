export type ManualProgressMark = {
  state: boolean | undefined;
  at?: number;
};

/** Dated actions supersede legacy marks whose order is unknowable. Ties favor unwatch. */
export function resolveManualProgress(marks: ManualProgressMark[]): boolean | undefined {
  let latest: ManualProgressMark | undefined;
  let legacy: boolean | undefined;
  for (const mark of marks) {
    if (mark.state === undefined) continue;
    if (mark.at != null && Number.isFinite(mark.at)) {
      if (!latest || mark.at > latest.at! || (mark.at === latest.at && !mark.state)) latest = mark;
    } else if (legacy === undefined || !mark.state) {
      legacy = mark.state;
    }
  }
  return latest?.state ?? legacy;
}
