import { API_BASE_URL } from "../../config";
import type * as GeoJSON from "geojson";

export async function fetchVehiclesFromBackend(params: {
  operator: string;
  line?: string | null;
}) {
  const qs = new URLSearchParams({ operator: params.operator });
  if (params.line) qs.set("line", params.line);

  const res = await fetch(`${API_BASE_URL}/api/vehicles?${qs.toString()}`);

  if (!res.ok) {
    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch {
      // ignorera om body inte kan läsas
    }

    throw new Error(
      `Backend error ${res.status}${bodyText ? `: ${bodyText}` : ""}`
    );
  }

  return (await res.json()) as GeoJSON.FeatureCollection<GeoJSON.Point, any>;
}