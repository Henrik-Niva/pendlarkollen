import maplibregl from "maplibre-gl";
import type * as GeoJSON from "geojson";
import type { LineSelection } from "../data/types";
import { fetchRouteVariants, type RouteVariant } from "../data/fetchRouteVariants";
import { pickBestVariant } from "../data/pickVariant";
import { fetchStopsIndex } from "../data/fetchStopsIndex";

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

function buildStopsFeatureCollectionFromVariantStopIds(
  sel: LineSelection,
  variant: RouteVariant,
  stopsIndex: Awaited<ReturnType<typeof fetchStopsIndex>>
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const parentById = new Map(
    (stopsIndex.parents ?? []).map((p) => [p.stop_id, p] as const)
  );

  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];

  for (const stopId of variant.stop_ids ?? []) {
    const child = stopsIndex.children?.[stopId];
    if (child) {
      features.push({
        type: "Feature",
        id: child.stop_id,
        geometry: {
          type: "Point",
          coordinates: [child.lon, child.lat],
        },
        properties: {
          stop_id: child.stop_id,
          name: child.name,
          lat: child.lat,
          lon: child.lon,
          parent_station: child.parent_station,
          operator: sel.operator,
          line: sel.line,
          source: "offline-stops-index",
        },
      });
      continue;
    }

    const parent = parentById.get(stopId);
    if (parent) {
      features.push({
        type: "Feature",
        id: parent.stop_id,
        geometry: {
          type: "Point",
          coordinates: [parent.lon, parent.lat],
        },
        properties: {
          stop_id: parent.stop_id,
          name: parent.name,
          lat: parent.lat,
          lon: parent.lon,
          parent_station: "",
          operator: sel.operator,
          line: sel.line,
          source: "offline-stops-index",
        },
      });
    }
  }

  return {
    type: "FeatureCollection",
    features,
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

  await Promise.all(
    slots.map(async (slot) => {
      const sel = selectedLines[slot];
      if (!sel) return;

      const line = sel.line.trim();

      try {
        const [variants, stopsIndex] = await Promise.all([
          fetchRouteVariants(sel.operator),
          fetchStopsIndex(sel.operator),
        ]);

        if (cancelledRef.current) return;

        const variant = pickBestVariant(variants, line);

        const routeFc = variant
          ? buildRouteFeatureCollectionFromVariant(sel, variant)
          : EMPTY_ROUTE_FC;

        const stopsFc = variant
          ? buildStopsFeatureCollectionFromVariantStopIds(sel, variant, stopsIndex)
          : EMPTY_STOPS_FC;

        setRoute(map, slot, routeFc);
        setStops(map, slot, stopsFc);

        fetchedRoutes[slot] = routeFc;
      } catch (err) {
        console.error(`Selected offline load failed for slot ${slot}:`, err);
        if (cancelledRef.current) return;

        setRoute(map, slot, EMPTY_ROUTE_FC);
        setStops(map, slot, EMPTY_STOPS_FC);

        fetchedRoutes[slot] = EMPTY_ROUTE_FC;
      }
    })
  );

  if (cancelledRef.current) return;

  if (fitSlot !== null && fitSlot !== undefined) {
    const fc = fetchedRoutes[fitSlot];
    if (fc) fitToRoute(map, fc);
  }
}