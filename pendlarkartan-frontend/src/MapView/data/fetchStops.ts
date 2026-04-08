import { API_BASE_URL } from "../../config";
import type * as GeoJSON from "geojson";

export async function fetchStopsFromBackend(params: { operator: string; line: string }) {
  const qs = new URLSearchParams({ operator: params.operator, line: params.line });
  const res = await fetch(`${API_BASE_URL}/api/stops?${qs.toString()}`);
  if (!res.ok) throw new Error(`Stops backend error ${res.status}`);
  return (await res.json()) as GeoJSON.FeatureCollection<GeoJSON.Point, any>;
}

export async function fetchAllStopsFromBackend(params: { operator: string }) {
  const qs = new URLSearchParams({ operator: params.operator });
  const res = await fetch(`${API_BASE_URL}/api/stops/all?${qs.toString()}`);
  if (!res.ok) throw new Error(`stops/all backend error ${res.status}`);
  return (await res.json()) as GeoJSON.FeatureCollection<GeoJSON.Point, any>;
}

export async function fetchLinesByStopFromBackend(params: {
  operator: string;
  stop_id: string;
  window_min?: number;
}) {
  const qs = new URLSearchParams({
    operator: params.operator,
    stop_id: params.stop_id,
    window_min: String(params.window_min ?? 120),
  });
  const res = await fetch(`${API_BASE_URL}/api/lines/by-stop/active?${qs.toString()}`);
  if (!res.ok) throw new Error(`lines/by-stop/active backend error ${res.status}`);
  return (await res.json()) as { line: string }[];
}

export type ParentStationLinesRow = {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  lines: { line: string }[];
};

export async function fetchLinesByParentStationActiveFromBackend(params: {
  operator: string;
  parent_station: string;
  window_min?: number;
}): Promise<ParentStationLinesRow[]> {
  const qs = new URLSearchParams({
    operator: params.operator,
    parent_station: params.parent_station,
    window_min: String(params.window_min ?? 120),
  });

  const res = await fetch(
    `${API_BASE_URL}/api/lines/by-parent-station/active?${qs.toString()}`
  );
  if (!res.ok) throw new Error(`lines/by-parent-station/active backend error ${res.status}`);
  return (await res.json()) as ParentStationLinesRow[];
}
