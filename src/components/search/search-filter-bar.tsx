import { useT } from "@/lib/i18n";

export type SearchFilterKey =
  | "all"
  | "movies"
  | "shows"
  | "people"
  | "live"
  | "anime"
  | "manga"
  | "music"
  | "ebooks"
  | "sports";

const ORDER: { key: SearchFilterKey; label: string }[] = [
  { key: "movies", label: "Movies" },
  { key: "shows", label: "Series" },
  { key: "people", label: "People" },
  { key: "live", label: "Live TV" },
  { key: "anime", label: "Anime" },
  { key: "manga", label: "Manga" },
  { key: "music", label: "Music" },
  { key: "ebooks", label: "eBooks" },
  { key: "sports", label: "Sports" },
];

export function SearchFilterBar({
  counts,
  value,
  onChange,
}: {
  counts: Partial<Record<SearchFilterKey, number>>;
  value: SearchFilterKey;
  onChange: (next: SearchFilterKey) => void;
}) {
  const t = useT();
  const present = ORDER.filter((entry) => (counts[entry.key] ?? 0) > 0);
  if (present.length < 2) return null;
  const total = present.reduce((sum, entry) => sum + (counts[entry.key] ?? 0), 0);

  const pill = (key: SearchFilterKey, label: string, count: number) => {
    const active = value === key;
    return (
      <button
        key={key}
        type="button"
        aria-pressed={active}
        onClick={() => onChange(key)}
        className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold transition-colors ${
          active
            ? "border-edge bg-elevated text-ink"
            : "border-edge-soft bg-elevated/40 text-ink-muted hover:border-edge hover:text-ink"
        }`}
      >
        {t(label)}
        <span className={active ? "text-ink-muted" : "text-ink-subtle"}>{count}</span>
      </button>
    );
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {pill("all", "All", total)}
      {present.map((entry) => pill(entry.key, entry.label, counts[entry.key] ?? 0))}
    </div>
  );
}
