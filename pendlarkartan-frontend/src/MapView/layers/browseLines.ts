import maplibregl from "maplibre-gl";
import type { FeatureCollection, LineString } from "geojson";
import type { Operator } from "../data/types";
import { EMPTY_ROUTE_FC } from "../data/empties";
import { fetchRouteVariants } from "../data/fetchRouteVariants";

const BROWSE_LINE_LAYERS = [
  "routes-all-base-halo",
  "routes-all-base",
  "routes-all-hover-halo",
  "routes-all-hover-outline",
  "routes-all-hover-line",
  "routes-all-hitbox",
] as const;

const FILTERED_BROWSE_LINE_LAYERS = [
  "routes-all-base-halo",
  "routes-all-base",
  "routes-all-hitbox",
] as const;

export function setBrowseLinesVisibility(map: maplibregl.Map, opts: { showAll: boolean }) {
  const visibility = opts.showAll ? "visible" : "none";

  for (const id of BROWSE_LINE_LAYERS) {
    if (!map.getLayer(id)) continue;
    map.setLayoutProperty(id, "visibility", visibility);
  }

  // När browse-lines stängs: rensa ev hover-feature
  if (!opts.showAll) {
    const hoverSrc = map.getSource("routes-all-hover") as maplibregl.GeoJSONSource | undefined;
    if (hoverSrc) hoverSrc.setData(EMPTY_ROUTE_FC as any);
  }
}

let lastRequestedOperator: string | null = null;

async function fetchAllRoutesFromRouteVariants(
  operator: Operator
): Promise<FeatureCollection<LineString>> {
  const variants = await fetchRouteVariants(operator);

  return {
    type: "FeatureCollection",
    features: variants.map((variant) => ({
      type: "Feature",
      geometry: variant.geometry,
      properties: {
        operator,
        line: variant.line,
        variant_id: variant.variant_id,
        direction_id: variant.direction_id,
        headsign: variant.headsign,
        shape_id: variant.shape_id,
        trip_count: variant.trip_count,
        geometry_source: "offline-route-variants",
      },
    })),
  };
}

export async function updateAllRoutesData(
  map: maplibregl.Map,
  operator: Operator
) {
  const src = map.getSource("routes-all") as maplibregl.GeoJSONSource | undefined;
  if (!src) return;

  const requestOp = operator.toString();
  lastRequestedOperator = requestOp;

  try {
    const fc = await fetchAllRoutesFromRouteVariants(operator);

    // Ignorera sent svar för gammal operatör
    if (lastRequestedOperator !== requestOp) {
      return;
    }

    src.setData(fc as any);
  } catch (e) {
    console.error("updateAllRoutesData failed:", e);

    // Vid fel: töm browse-lines så vi slipper gammal/fel operator-data
    src.setData(EMPTY_ROUTE_FC as any);
  }
}

export function applyBrowseLinesOperatorFilter(map: maplibregl.Map, _operator: Operator) {
  // Behåll alla features synliga. Varje operator laddas nu från sin egen fil.
  for (const id of FILTERED_BROWSE_LINE_LAYERS) {
    if (!map.getLayer(id)) continue;
    map.setFilter(id, null);
  }
}

export function resetBrowseLinesFilters(map: maplibregl.Map) {
  for (const id of FILTERED_BROWSE_LINE_LAYERS) {
    if (!map.getLayer(id)) continue;
    map.setFilter(id, null);
  }

  const hoverSrc = map.getSource("routes-all-hover") as maplibregl.GeoJSONSource | undefined;
  if (hoverSrc) hoverSrc.setData(EMPTY_ROUTE_FC as any);
}

export function ensureBrowseLinesState(map: maplibregl.Map, operator: Operator) {
  setBrowseLinesVisibility(map, { showAll: true });
  applyBrowseLinesOperatorFilter(map, operator);

  // Enforce layer order every time
  const anchor = map.getLayer("routes-slot0-outline") ? "routes-slot0-outline" : null;

  const orderedLayers = [
    "routes-all-base-halo",
    "routes-all-base",
    "routes-all-hover-halo",
    "routes-all-hover-outline",
    "routes-all-hover-line",
    "routes-all-hitbox",
  ] as const;

  for (const id of orderedLayers) {
    if (!map.getLayer(id)) continue;
    if (anchor) map.moveLayer(id, anchor);
    else map.moveLayer(id);
  }

  map.triggerRepaint();
}