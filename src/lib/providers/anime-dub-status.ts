export type DubAvailability = "dub" | "partial" | null;
export type DubScheduleStatus = "upcoming" | "dubbing" | null;
export type AnimeDubStatus = { availability: DubAvailability; schedule: DubScheduleStatus };
export type DubTitle = { id: string; malId?: number };
export type DubAvailabilityData = { dubbed: number[]; partial: number[] };
export type DubIdMappings = Record<string, number>;

export function isDubId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function parseDubAvailability(value: unknown): DubAvailabilityData {
  if (!value || typeof value !== "object") throw new Error("Invalid dub availability data");
  const { dubbed, partial } = value as Partial<DubAvailabilityData>;
  if (
    !Array.isArray(dubbed) ||
    !Array.isArray(partial) ||
    !dubbed.every(isDubId) ||
    !partial.every(isDubId) ||
    !(dubbed.length + partial.length)
  ) {
    throw new Error("Invalid dub availability lists");
  }
  return { dubbed: [...new Set(dubbed)], partial: [...new Set(partial)] };
}

export function parseDubMappings(text: string, source: "anilist" | "kitsu"): DubIdMappings {
  const mappings: DubIdMappings = {};
  const ambiguous = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as Record<string, unknown> | null;
    if (!entry || !isDubId(entry.mal_id) || !isDubId(entry[`${source}_id`])) {
      throw new Error("Invalid dub ID mapping");
    }
    const id = String(entry[`${source}_id`]);
    if (ambiguous.has(id)) continue;
    if (mappings[id] != null && mappings[id] !== entry.mal_id) {
      delete mappings[id];
      ambiguous.add(id);
    } else {
      mappings[id] = entry.mal_id;
    }
  }
  return validateDubMappings(mappings);
}

export function validateDubMappings(value: unknown): DubIdMappings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid cached dub mappings");
  }
  const entries = Object.entries(value);
  if (
    !entries.length ||
    entries.some(([id, mal]) => !/^[1-9]\d*$/.test(id) || !isDubId(Number(id)) || !isDubId(mal))
  ) {
    throw new Error("Invalid cached dub mapping IDs");
  }
  return Object.fromEntries(entries) as DubIdMappings;
}

export function resolveDubMalId(
  title: DubTitle,
  anilist: DubIdMappings = {},
  kitsu: DubIdMappings = {},
): number | null {
  const match = /^(mal|anilist|kitsu):([1-9]\d*)$/.exec(title.id);
  if (match?.[1] === "mal" && isDubId(Number(match[2]))) return Number(match[2]);
  if (isDubId(title.malId)) return title.malId;
  if (!match || !isDubId(Number(match[2]))) return null;
  return (match[1] === "anilist" ? anilist[match[2]] : kitsu[match[2]]) ?? null;
}

export function animeDubLabel(status: AnimeDubStatus, t: (key: string) => string): string {
  if (status.schedule === "upcoming") return t("DUB UPCOMING");
  if (status.schedule === "dubbing" && status.availability !== "partial") return t("DUBBING");
  const availability =
    status.availability === "partial"
      ? t("PARTIAL DUB")
      : status.availability === "dub"
        ? t("DUB")
        : "";
  return status.schedule === "dubbing"
    ? [availability, t("DUBBING")].filter(Boolean).join(" · ")
    : availability;
}
