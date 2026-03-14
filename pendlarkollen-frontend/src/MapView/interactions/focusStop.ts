import maplibregl from "maplibre-gl";
import type * as GeoJSON from "geojson";

import type { MapMode, FocusedStop, LineSelection, Operator } from "../data/types";
import { fetchLinesByStopFromBackend } from "../data/fetchStops";
import { buildStopPopup } from "../popups/buildStopPopup";
import { toOperatorCode } from "../utils/operatorCode";

type FocusStopDeps = {
  map: maplibregl.Map;
  mapMode: MapMode;
  focusedStop: FocusedStop | null;
};

/**
 * Write marker data to the "focused-stop" source.
 * Clears source whenever we are not in focus-stop mode or focusedStop is null.
 */
export function updateFocusedStopSource(opts: FocusStopDeps & {
  EMPTY_POINT_FC: GeoJSON.FeatureCollection<GeoJSON.Point>;
}) {
  const { map, mapMode, focusedStop, EMPTY_POINT_FC } = opts;

  const src = map.getSource("focused-stop") as maplibregl.GeoJSONSource | undefined;
  if (!src) return;

  if (mapMode !== "focus-stop" || !focusedStop) {
    src.setData(EMPTY_POINT_FC as any);
    return;
  }

  src.setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [focusedStop.lon, focusedStop.lat] },
        properties: {
          stop_id: focusedStop.stop_id,
          name: focusedStop.name,
          operator: focusedStop.operator,
        },
      },
    ],
  } as any);
}

/**
 * Fly the camera to the focused stop (only in focus-stop mode).
 */
export function flyToFocusedStop(opts: FocusStopDeps) {
  const { map, mapMode, focusedStop } = opts;
  if (mapMode !== "focus-stop" || !focusedStop) return;

  map.flyTo({
    center: [focusedStop.lon, focusedStop.lat],
    zoom: 14,
    duration: 600,
  });
}

/**
 * Open a popup for the focused stop with active lines.
 * Returns a cleanup function that cancels pending work and removes the popup.
 */
export function openFocusedStopPopup(opts: {
  map: maplibregl.Map;
  mapMode: MapMode;
  focusedStop: FocusedStop | null;
  onPickLine: (sel: LineSelection) => void;
  onCloseFocusedStop: () => void;
}) {
  const { map, mapMode, focusedStop, onPickLine, onCloseFocusedStop } = opts;

  // Nothing to do in other modes
  if (mapMode !== "focus-stop" || !focusedStop) return () => {};

  let cancelled = false;
  let popup: maplibregl.Popup | null = null;

  const stop = focusedStop; // snapshot (avoid reading changing object later)
  const operatorCode = toOperatorCode(stop.operator as Operator);

  const removePopup = () => {
    if (!popup) return;
    popup.remove();
    popup = null;
  };

  (async () => {
    try {
      const rows = await fetchLinesByStopFromBackend({
        operator: operatorCode,
        stop_id: stop.stop_id,
        window_min: 120,
      });

      if (cancelled) return;

      const lines = (rows ?? []).map((r) => String((r as any).line ?? "").trim()).filter(Boolean);

      const dom = buildStopPopup({
        title: stop.name,
        lines,
        onPickLine: (line: string) => {
          onPickLine({ operator: stop.operator, line });
          removePopup();
        },
      });

      popup = new maplibregl.Popup({
        closeOnClick: true,
        closeButton: true,
        offset: 12,
      })
        .setLngLat([stop.lon, stop.lat])
        .setDOMContent(dom)
        .addTo(map);

      // Only call onClose if we actually created the popup
      popup.on("close", () => {
        // If we are already cancelled/unmounted, ignore.
        if (cancelled) return;
        onCloseFocusedStop();
      });
    } catch (e) {
      if (!cancelled) {
        console.error("lines/by-stop popup failed:", e);
      }
    }
  })();

  return () => {
    cancelled = true;
    removePopup();
  };
}