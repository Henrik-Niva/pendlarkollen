import maplibregl from "maplibre-gl";
import type * as GeoJSON from "geojson";
import type { LineSelection } from "../data/types";
import { fetchStopsFromBackend } from "../data/fetchStops";
import { fetchRouteVariants } from "../data/fetchRouteVariants";
import { pickBestVariant } from "../data/pickVariant";

function setRoute(map: maplibregl.Map, slot: 0 | 1 | 2, fc: any) {
  const src = map.getSource(`routes-slot${slot}`) as maplibregl.GeoJSONSource | undefined;
  src?.setData(fc as any);
}

function setStops(map: maplibregl.Map, slot: 0 | 1 | 2, fc: any) {
  const src = map.getSource(`stops-live-slot${slot}`) as maplibregl.GeoJSONSource | undefined;
  src?.setData(fc as any);
}

function fitToRoute(map: maplibregl.Map, fc: GeoJSON.FeatureCollection<GeoJSON.LineString>) {
  const bounds = new maplibregl.LngLatBounds();

  let hasAny = false;

  for (const f of fc.features ?? []) {
    if (!f?.geometry) continue;
    if (f.geometry.type !== "LineString") continue;

    for (const c of f.geometry.coordinates) {
      const lng = c[0];
      const lat = c[1];
      if (typeof lng !== "number" || typeof lat !== "number") continue;
      bounds.extend([lng, lat]);
      hasAny = true;
    }
  }

  if (!hasAny) return;

  map.fitBounds(bounds, { padding: 60, duration: 600 });
}

function buildRouteFeatureCollectionFromVariant(
  sel: LineSelection,
  variant: {
    variant_id: string;
    direction_id: number | null;
    headsign: string;
    shape_id: string;
    geometry: GeoJSON.LineString;
  }
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: variant.geometry,
        properties: {
          operator: sel.operator,
          line: sel.line,
          variant_id: variant.variant_id,
          direction_id: variant.direction_id,
          headsign: variant.headsign,
          shape_id: variant.shape_id,
          geometry_source: "offline-route-variants",
        },
      },
    ],
  };
}

export async function updateSelectedLineLayers(opts: {
  map: maplibregl.Map;
  selectedLines: LineSelection[];
  EMPTY_ROUTE_FC: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  EMPTY_STOPS_FC: GeoJSON.FeatureCollection<GeoJSON.Point>;
  cancelledRef: { current: boolean };
  fitSlot?: 0 | 1 | 2 | null;
}) {
  const { map, selectedLines, EMPTY_ROUTE_FC, EMPTY_STOPS_FC, cancelledRef, fitSlot } = opts;

  const slots: Array<0 | 1 | 2> = [0, 1, 2];

  // Always clear missing slots
  for (const slot of slots) {
    if (!selectedLines[slot]) {
      setRoute(map, slot, EMPTY_ROUTE_FC);
      setStops(map, slot, EMPTY_STOPS_FC);
    }
  }

  const fetchedRoutes: Partial<Record<0 | 1 | 2, GeoJSON.FeatureCollection<GeoJSON.LineString>>> = {};

  // =========================
  // PASS 1: rendera routes direkt
  // =========================
  await Promise.all(
    slots.map(async (slot) => {
      const sel = selectedLines[slot];
      if (!sel) return;

      const line = sel.line.trim();

      try {
        const variants = await fetchRouteVariants(sel.operator);

        if (cancelledRef.current) return;

        const variant = pickBestVariant(variants, line);

        const routeFc = variant
          ? buildRouteFeatureCollectionFromVariant(sel, variant)
          : EMPTY_ROUTE_FC;

        setRoute(map, slot, routeFc);
        fetchedRoutes[slot] = routeFc;
      } catch (err) {
        console.error(`Selected route offline load failed for slot ${slot}:`, err);
        if (cancelledRef.current) return;
        setRoute(map, slot, EMPTY_ROUTE_FC);
        fetchedRoutes[slot] = EMPTY_ROUTE_FC;
      }
    })
  );

  if (cancelledRef.current) return;

  // Fit så fort route finns, vänta inte på stops
  if (fitSlot !== null && fitSlot !== undefined) {
    const fc = fetchedRoutes[fitSlot];
    if (fc) fitToRoute(map, fc);
  }

  // =========================
  // PASS 2: ladda stops separat
  // =========================
  void Promise.all(
    slots.map(async (slot) => {
      const sel = selectedLines[slot];
      if (!sel) return;

      const line = sel.line.trim();

      try {
        const stopsFc = await fetchStopsFromBackend({
          operator: sel.operator,
          line,
        });

        if (cancelledRef.current) return;
        setStops(map, slot, stopsFc ?? EMPTY_STOPS_FC);
      } catch (err) {
        console.error(`Selected stops live load failed for slot ${slot}:`, err);
        if (cancelledRef.current) return;
        setStops(map, slot, EMPTY_STOPS_FC);
      }
    })
  );
}