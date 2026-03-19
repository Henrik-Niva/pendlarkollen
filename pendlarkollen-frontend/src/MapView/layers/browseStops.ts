import maplibregl from "maplibre-gl";
import type * as GeoJSON from "geojson";

import type { Operator, MapMode } from "../data/types";
import { fetchStopsIndex } from "../data/fetchStopsIndex";

let lastReqId = 0;

export async function updateBrowseStopsStations(opts: {
  map: maplibregl.Map;
  mapMode: MapMode;
  browseOperator: Operator;
  EMPTY_POINT_FC: GeoJSON.FeatureCollection<GeoJSON.Point>;
  cancelledRef: { current: boolean };
}) {
  const { map, mapMode, browseOperator, EMPTY_POINT_FC, cancelledRef } = opts;

  const stopsSrc = map.getSource("stops") as maplibregl.GeoJSONSource | undefined;
  if (!stopsSrc) return;

  // Om vi inte är i browse-stops: töm
  if (mapMode !== "browse-stops") {
    stopsSrc.setData(EMPTY_POINT_FC as any);
    return;
  }

  const reqId = ++lastReqId;

  try {
    const data = await fetchStopsIndex(browseOperator);

    if (cancelledRef.current) return;
    if (reqId !== lastReqId) return;

    const parentsOnly: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: "FeatureCollection",
      features: (data.parents ?? []).map((p) => ({
        type: "Feature",
        id: p.stop_id,
        geometry: {
          type: "Point",
          coordinates: [p.lon, p.lat],
        },
        properties: {
          stop_id: p.stop_id,
          name: p.name,
          lat: p.lat,
          lon: p.lon,
          lines: p.lines,
          children: p.children,
          parent_station: "",
          location_type: 1,
          operator: browseOperator,
          source: "offline-stops-index",
        },
      })),
    };

    stopsSrc.setData(parentsOnly as any);
  } catch (e) {
    console.error("updateBrowseStopsStations failed:", e);
    stopsSrc.setData(EMPTY_POINT_FC as any);
  }
}