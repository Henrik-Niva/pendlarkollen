import maplibregl from "maplibre-gl";
import type * as GeoJSON from "geojson";
import type { LineSelection } from "../data/types";
import { fetchRouteFromBackend } from "../data/fetchRoutes";
import { toOperatorCode } from "../utils/operatorCode";

export async function updateLiveLineLayers(opts: {
  map: maplibregl.Map;
  primary: LineSelection | null;
  EMPTY_ROUTE_FC: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  cancelledRef: { current: boolean };
}) {
  const { map, primary, EMPTY_ROUTE_FC, cancelledRef } = opts;

  const routeSrc = map.getSource("route-live") as maplibregl.GeoJSONSource | undefined;

  if (!primary) {
    routeSrc?.setData(EMPTY_ROUTE_FC as any);
    return;
  }

  const operatorCode = toOperatorCode(primary.operator);
  const line = primary.line.trim();

  const routeFc = await fetchRouteFromBackend({ operator: operatorCode, line });

  if (cancelledRef.current) return;

  routeSrc?.setData(routeFc as any);

  // Fit to route (primary)
  const first = routeFc.features?.[0];
  if (first && first.geometry.type === "LineString" && first.geometry.coordinates.length > 1) {
    const bounds = new maplibregl.LngLatBounds();
    for (const [lng, lat] of first.geometry.coordinates) bounds.extend([lng, lat]);
    map.fitBounds(bounds, { padding: 60, duration: 600 });
  }
}