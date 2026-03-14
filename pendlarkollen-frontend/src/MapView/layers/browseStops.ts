import maplibregl from "maplibre-gl";
import type * as GeoJSON from "geojson";

import type { Operator, MapMode } from "../data/types";
import { fetchAllStopsFromBackend } from "../data/fetchStops";
import { toOperatorCode } from "../utils/operatorCode";

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

  // Om vi inte är i browse-stops: töm (så vi aldrig “läcker” hållplatser mellan modes)
  if (mapMode !== "browse-stops") {
    stopsSrc.setData(EMPTY_POINT_FC as any);
    return;
  }

  const reqId = ++lastReqId;
  const operatorCode = toOperatorCode(browseOperator);

  try {
    const fc = await fetchAllStopsFromBackend({ operator: operatorCode });

    // Ignorera om något nyare request har startat, eller om vi avbrutit
    if (cancelledRef.current) return;
    if (reqId !== lastReqId) return;

    // Endast parent-stationer: parent_station tom + location_type == 1
    const parentsOnly: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: "FeatureCollection",
      features: (fc.features ?? [])
        .filter((f: any) => {
          const ps = String(f?.properties?.parent_station ?? "").trim();
          const lt = Number(f?.properties?.location_type ?? 0);
          return ps === "" && lt === 1;
        })
        .map((f: any) => ({
          ...f,
          id: String(f?.properties?.stop_id ?? ""),
        })),
    };

    stopsSrc.setData(parentsOnly as any);
  } catch (e) {
    console.error("updateBrowseStopsStations failed:", e);
    stopsSrc.setData(EMPTY_POINT_FC as any);
  }
}
