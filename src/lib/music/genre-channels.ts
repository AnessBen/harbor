import type { MusicDiscoveryGenre, MusicGenreFamily } from "./genre-catalog";

export type GenreChannel = { name: string; query: string };

const BY_SLUG: Record<string, GenreChannel[]> = {
  "hip-hop": [
    { name: "WorldStarHipHop", query: "WorldStarHipHop official music video" },
    { name: "Lyrical Lemonade", query: "Lyrical Lemonade official music video" },
    { name: "COLORS", query: "A COLORS SHOW performance" },
    { name: "On The Radar", query: "On The Radar Radio freestyle" },
    { name: "From The Block", query: "From The Block performance" },
    { name: "Mass Appeal", query: "Mass Appeal Rhythm Roulette" },
    { name: "Tiny Desk", query: "NPR Tiny Desk Concert hip hop" },
  ],
  trap: [
    { name: "WorldStarHipHop", query: "WorldStarHipHop trap official video" },
    { name: "Lyrical Lemonade", query: "Lyrical Lemonade trap official video" },
    { name: "Elevator", query: "Elevator trap premiere" },
  ],
  drill: [
    { name: "GRM Daily", query: "GRM Daily drill" },
    { name: "Mixtape Madness", query: "Mixtape Madness drill" },
    { name: "Pressplay", query: "Pressplay Media drill" },
    { name: "Link Up TV", query: "Link Up TV drill" },
  ],
  hyperpop: [
    { name: "PC Music", query: "PC Music official video" },
    { name: "Dog Show Records", query: "Dog Show Records hyperpop" },
    { name: "Hyperpop scene", query: "hyperpop official music video" },
    { name: "100 gecs live", query: "100 gecs live set" },
  ],
  phonk: [
    { name: "Phonk House", query: "phonk house mix official" },
    { name: "Drift phonk", query: "drift phonk official video" },
  ],
  hardstyle: [
    { name: "Q-dance", query: "Q-dance Defqon.1 endshow" },
    { name: "Scantraxx", query: "Scantraxx hardstyle official" },
    { name: "Rawstyle", query: "rawstyle official video" },
  ],
  "happy-hardcore": [
    { name: "Happy hardcore classics", query: "happy hardcore classic rave" },
    { name: "UK rave", query: "uk happy hardcore set" },
    { name: "Anime hardcore", query: "happy hardcore anime AMV" },
  ],
  "k-pop": [
    { name: "1theK", query: "1theK official music video" },
    { name: "M2", query: "M2 relay dance" },
    { name: "Mnet", query: "Mnet stage performance" },
  ],
  reggaeton: [
    { name: "Reggaeton oficial", query: "reggaeton video oficial" },
    { name: "Bzrp Sessions", query: "Bizarrap Music Sessions" },
  ],
  afrobeats: [
    { name: "NATIVE", query: "NATIVE afrobeats official video" },
    { name: "Afrobeats live", query: "afrobeats live performance" },
  ],
};

const BY_FAMILY: Record<MusicGenreFamily, GenreChannel[]> = {
  popular: [
    { name: "VEVO", query: "VEVO official music video" },
    { name: "Tiny Desk", query: "NPR Tiny Desk Concert" },
    { name: "COLORS", query: "A COLORS SHOW performance" },
  ],
  electronic: [
    { name: "Monstercat", query: "Monstercat official release" },
    { name: "UKF", query: "UKF official video" },
    { name: "Anjunabeats", query: "Anjunabeats official video" },
    { name: "Boiler Room", query: "Boiler Room set" },
  ],
  guitars: [
    { name: "Kerrang", query: "Kerrang official session" },
    { name: "Audiotree", query: "Audiotree Live session" },
    { name: "Hate5six", query: "hate5six live set" },
  ],
  roots: [
    { name: "Tiny Desk", query: "NPR Tiny Desk Concert" },
    { name: "Blue Note", query: "Blue Note Records live" },
    { name: "Sofar Sounds", query: "Sofar Sounds live" },
  ],
  latin: [
    { name: "Bzrp Sessions", query: "Bizarrap Music Sessions" },
    { name: "Latin oficial", query: "video oficial latino" },
  ],
  africa: [
    { name: "NATIVE", query: "NATIVE afrobeats official video" },
    { name: "Live in Lagos", query: "afrobeats live performance" },
  ],
  asia: [
    { name: "1theK", query: "1theK official music video" },
    { name: "THE FIRST TAKE", query: "THE FIRST TAKE performance" },
  ],
  world: [
    { name: "Tiny Desk", query: "NPR Tiny Desk Concert" },
    { name: "Boiler Room", query: "Boiler Room set" },
  ],
};

export function genreChannels(genre: MusicDiscoveryGenre): GenreChannel[] {
  const exact = BY_SLUG[genre.slug];
  if (exact) return exact;
  for (const alias of genre.aliases) {
    const found = BY_SLUG[alias.toLowerCase().replace(/\s+/g, "-")];
    if (found) return found;
  }
  return BY_FAMILY[genre.family] ?? [];
}
