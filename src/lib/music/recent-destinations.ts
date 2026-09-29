import { useSyncExternalStore } from "react";
import { readLocalJson, writeLocalJson } from "./local-store";

export type MusicDestinationKind = "artist" | "album" | "track" | "liked";

export type MusicDestination = {
  kind: MusicDestinationKind;
  id: string;
  connectorId?: string;
  name: string;
  artist?: string;
  artwork: string;
  at: number;
};

const STORE = "recent-destinations";
const LIMIT = 12;

let list: MusicDestination[] = [];
let hydrated = false;
let ready = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

export async function hydrateMusicDestinations(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const saved = await readLocalJson<MusicDestination[]>(STORE);
  if (Array.isArray(saved) && saved.length > 0) {
    list = saved.filter((entry) => entry && entry.id && entry.name).slice(0, LIMIT);
  }
  ready = true;
  notify();
}

export function recordMusicDestination(entry: Omit<MusicDestination, "at">): void {
  const id = entry.id?.trim();
  const name = entry.name?.trim();
  if (!id || !name) return;
  const key = `${entry.kind}:${id}`;
  const next = [
    { ...entry, id, name, at: Date.now() },
    ...list.filter((held) => `${held.kind}:${held.id}` !== key),
  ].slice(0, LIMIT);
  list = next;
  writeLocalJson(STORE, next);
  notify();
}

export function musicDestinationsReady(): boolean {
  return ready;
}

export function useMusicDestinationsReady(): boolean {
  return useSyncExternalStore(subscribe, musicDestinationsReady, musicDestinationsReady);
}

export function getMusicDestinations(): MusicDestination[] {
  return list;
}

export function useMusicDestinations(): MusicDestination[] {
  return useSyncExternalStore(subscribe, getMusicDestinations, getMusicDestinations);
}
