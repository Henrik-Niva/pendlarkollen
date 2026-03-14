import { API_BASE_URL } from "../../config";
import type * as GeoJSON from "geojson";
import type { Operator } from "./types";
import { toOperatorCode } from "../utils/operatorCode";

export async function fetchRouteFromBackend(params: {
  operator: string;
  line: string;
}) {
  const qs = new URLSearchParams({ operator: params.operator, line: params.line });
  const res = await fetch(`${API_BASE_URL}/api/route?${qs.toString()}`);
  if (!res.ok) throw new Error(`Route backend error ${res.status}`);
  return (await res.json()) as GeoJSON.FeatureCollection<GeoJSON.LineString, any>;
}

export async function fetchAllRoutesFromBackend(opts: {
  operator: Operator;
}): Promise<GeoJSON.FeatureCollection<GeoJSON.LineString>> {
  const operatorCode = toOperatorCode(opts.operator); // "sl" / "ul" / "xt"

  const res = await fetch(
    `${API_BASE_URL}/api/routes?operator=${encodeURIComponent(operatorCode)}`
  );

  // Om backend råkar skicka HTML/text, läs som text för bättre felmeddelande
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`fetchAllRoutesFromBackend failed: ${res.status} ${res.statusText} :: ${text.slice(0, 200)}`);
  }

  try {
    return JSON.parse(text) as GeoJSON.FeatureCollection<GeoJSON.LineString>;
  } catch (e) {
    throw new Error(`fetchAllRoutesFromBackend invalid JSON :: ${text.slice(0, 200)}`);
  }
}