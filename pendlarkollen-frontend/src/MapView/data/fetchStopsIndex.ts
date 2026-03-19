import type { Operator } from "./types";
import { toOperatorCode } from "../utils/operatorCode";

export type StopsIndexParent = {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  lines: string[];
  children: string[];
};

export type StopsIndexChild = {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  parent_station: string;
  lines: string[];
};

export type StopsIndexLineEntry = {
  parent_stop_ids: string[];
  child_stop_ids: string[];
};

export type StopsIndexFile = {
  version: number;
  generated_at: string;
  operator: string;
  timezone: string;
  parents: StopsIndexParent[];
  children: Record<string, StopsIndexChild>;
  line_index: Record<string, StopsIndexLineEntry>;
};

export async function fetchStopsIndex(operator: Operator): Promise<StopsIndexFile> {
  const op = toOperatorCode(operator); // "sl" / "ul" / "xt"

  const res = await fetch(`/generated/${op}_stops_index.json`, {
    cache: "no-cache",
  });

  if (!res.ok) {
    throw new Error(`Failed to load stops index: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as StopsIndexFile;
}