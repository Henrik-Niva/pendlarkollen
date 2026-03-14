import maplibregl from "maplibre-gl";
import type * as GeoJSON from "geojson";
import type { LineSelection } from "../data/types";
import { fetchStopsFromBackend } from "../data/fetchStops";
import { toOperatorCode } from "../utils/operatorCode";

type FCPoint = GeoJSON.FeatureCollection<GeoJSON.Point, any>;

export async function updateSelectedStopsLayers(opts: {
  map: maplibregl.Map;
  selectedLines: LineSelection[];
  EMPTY_STOPS_FC: FCPoint;
  cancelledRef: { current: boolean };
}) {
  const { map, selectedLines, EMPTY_STOPS_FC, cancelledRef } = opts;

  const src0 = map.getSource("stops-live-slot0") as maplibregl.GeoJSONSource | undefined;
  const src1 = map.getSource("stops-live-slot1") as maplibregl.GeoJSONSource | undefined;
  const src2 = map.getSource("stops-live-slot2") as maplibregl.GeoJSONSource | undefined;

  // Safety: om sources inte finns (ska vara skapade i addSourcesAndLayers)
  if (!src0 || !src1 || !src2) return;

  // Clear först för snabb UI-respons
  src0.setData(EMPTY_STOPS_FC as any);
  src1.setData(EMPTY_STOPS_FC as any);
  src2.setData(EMPTY_STOPS_FC as any);

  const s0 = selectedLines[0] ?? null;
  const s1 = selectedLines[1] ?? null;
  const s2 = selectedLines[2] ?? null;

  const fetchStops = async (sel: LineSelection): Promise<FCPoint> => {
    const operatorCode = toOperatorCode(sel.operator);
    const line = sel.line.trim();
    return await fetchStopsFromBackend({ operator: operatorCode, line });
  };

  const [fc0, fc1, fc2] = await Promise.all([
    s0 ? fetchStops(s0) : Promise.resolve(EMPTY_STOPS_FC),
    s1 ? fetchStops(s1) : Promise.resolve(EMPTY_STOPS_FC),
    s2 ? fetchStops(s2) : Promise.resolve(EMPTY_STOPS_FC),
  ]);

  if (cancelledRef.current) return;

  src0.setData((fc0 ?? EMPTY_STOPS_FC) as any);
  src1.setData((fc1 ?? EMPTY_STOPS_FC) as any);
  src2.setData((fc2 ?? EMPTY_STOPS_FC) as any);
}