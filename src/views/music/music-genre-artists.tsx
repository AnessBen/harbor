import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "@/components/icons/music-icons";
import { MusicCatalogRow } from "@/components/music/music-catalog-row";
import { useT, useUiLanguage } from "@/lib/i18n";
import { firstGenreArtistCursor, loadGenreArtistPage } from "@/lib/music/genre-artists";
import { loadGenreArtistStats, type GenreArtistStats } from "@/lib/music/genre-insights";
import type { MusicArtistRef, MusicCatalogItem } from "@/lib/music/types";

export function MusicGenreArtists({ genreId, artists, onOpen }: {
  genreId: number;
  artists: MusicArtistRef[];
  onOpen: (item: MusicCatalogItem, siblings: MusicCatalogItem[]) => void;
}) {
  const t = useT(), locale = useUiLanguage();
  const [rows, setRows] = useState<GenreArtistStats[]>(() => artists.map(artist => ({ artist })));
  const [busy, setBusy] = useState(false), [error, setError] = useState(false), [exhausted, setExhausted] = useState(false);
  const cursor = useRef(firstGenreArtistCursor(genreId));
  const known = useRef(new Set(artists.map(artist => artist.id)));
  const loading = useRef(false), alive = useRef(true);
  const enrich = useCallback(async (batch: MusicArtistRef[]) => {
    for (let at = 0; at < batch.length && alive.current; at += 3) {
      const stats = await loadGenreArtistStats(batch.slice(at, at + 3)).catch(() => []);
      if (!alive.current) return;
      const byId = new Map(stats.map(row => [row.artist.id, row]));
      setRows(previous => previous.map(row => byId.get(row.artist.id) ?? row));
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void enrich(artists);
    return () => { alive.current = false; };
  }, [artists, enrich]);
  const more = useCallback(async () => {
    if (loading.current || exhausted) return;
    loading.current = true;
    setBusy(true); setError(false);
    try {
      const result = await loadGenreArtistPage(genreId, cursor.current, [...known.current]);
      if (!alive.current) return;
      const fresh = result.artists.filter(artist => !known.current.has(artist.id));
      fresh.forEach(artist => known.current.add(artist.id));
      setRows(previous => [...previous, ...fresh.map(artist => ({ artist }))]);
      if (result.next) cursor.current = result.next;
      else setExhausted(true);
      void enrich(fresh);
    } catch {
      if (alive.current) setError(true);
    } finally {
      loading.current = false;
      if (alive.current) setBusy(false);
    }
  }, [genreId, exhausted, enrich]);
  const count = (value: number) => new Intl.NumberFormat(locale).format(value);
  const items: MusicCatalogItem[] = rows.map(row => ({ ...row.artist, kind: "artist",
    subtitle: row.listeners !== undefined
      ? `${t("music.explore.listeners", { count: count(row.listeners) })} · Last.fm${row.plays !== undefined ? ` · ${t("music.explore.scrobbles", { count: count(row.plays) })}` : ""}`
      : row.fans !== undefined ? `${count(row.fans)} · ${t("music.metadata.deezerFans")}` : undefined,
  }));
  return <section className="music-genre-artists flex min-w-0 flex-col gap-3" aria-busy={busy}>
    <MusicCatalogRow row={{ id: `genre-artists:${genreId}`, title: "music.explore.sceneArtists", titleLiteral: false, layout: "circles",
      source: rows.some(row => row.listeners !== undefined) ? "Last.fm · Deezer" : "Deezer", items }}
      onEndReached={!busy && !error && !exhausted ? () => { void more(); } : undefined}
      onOpen={item => onOpen(item,items)}/>
    {(!exhausted || error) && <div className="music-genre-artists-more">
      {error && <span role="alert">{t("music.error.load")}</span>}
      <button type="button" onClick={() => { void more(); }} disabled={busy}>
        {busy && <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden/>}
        {t(error ? "common.retry" : "music.library.loadMore")}
      </button>
    </div>}
  </section>;
}
