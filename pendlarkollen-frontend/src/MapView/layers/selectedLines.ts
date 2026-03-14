import maplibregl from "maplibre-gl";
import type * as GeoJSON from "geojson";
import type { LineSelection } from "../data/types";
import { fetchRouteFromBackend } from "../data/fetchRoutes";
import { fetchStopsFromBackend } from "../data/fetchStops";
import { toOperatorCode } from "../utils/operatorCode";

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

export async function updateSelectedLineLayers(opts: {
  map: maplibregl.Map;
  selectedLines: LineSelection[];
  EMPTY_ROUTE_FC: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  EMPTY_STOPS_FC: GeoJSON.FeatureCollection<GeoJSON.Point>;
  cancelledRef: { current: boolean };

  // ✅ new: fit the latest changed slot
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

  // Fetch + set for present slots
  const fetchedRoutes: Partial<Record<0 | 1 | 2, GeoJSON.FeatureCollection<GeoJSON.LineString>>> = {};

  await Promise.all(
    slots.map(async (slot) => {
      const sel = selectedLines[slot];
      if (!sel) return;

      const operatorCode = toOperatorCode(sel.operator);
      const line = sel.line.trim();

      const [routeFc, stopsFc] = await Promise.all([
        fetchRouteFromBackend({ operator: operatorCode, line }),
        fetchStopsFromBackend({ operator: operatorCode, line }),
      ]);

      if (cancelledRef.current) return;

      setRoute(map, slot, routeFc ?? EMPTY_ROUTE_FC);
      setStops(map, slot, stopsFc ?? EMPTY_STOPS_FC);

      fetchedRoutes[slot] = (routeFc ?? EMPTY_ROUTE_FC) as any;
    })
  );

  if (cancelledRef.current) return;

  // ✅ Fit to chosen slot (latest changed), if provided and available
  if (fitSlot !== null && fitSlot !== undefined) {
    const fc = fetchedRoutes[fitSlot];
    if (fc) fitToRoute(map, fc);
  }
}