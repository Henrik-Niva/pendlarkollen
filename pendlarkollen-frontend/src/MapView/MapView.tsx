import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type * as GeoJSON from "geojson";

import type { Operator, LineSelection, MapMode, FocusedStop } from "./data/types";
import { EMPTY_ROUTE_FC, EMPTY_POINT_FC, EMPTY_STOPS_FC } from "./data/empties";

import { addSourcesAndLayers } from "./layers/addSourcesAndLayers";
import { startVehicleUpdates } from "./layers/vehicles";

import { bindRouteInteractions } from "./interactions/bindRouteInteractions";
import { bindStopBrowseInteractions } from "./interactions/bindStopBrowseInteractions";

import { updateSelectedLineLayers } from "./layers/selectedLines";
import { updateBrowseStopsStations } from "./layers/browseStops";

import {
  updateFocusedStopSource,
  flyToFocusedStop,
  openFocusedStopPopup,
} from "./interactions/focusStop";

import {
  setBrowseLinesVisibility,
  updateAllRoutesData,
  applyBrowseLinesOperatorFilter,
  resetBrowseLinesFilters,
} from "./layers/browseLines";

import { PALETTE } from "./style/palette";

type Props = {
  styleUrl: string;
  enabledOperators: Operator[];
  selectedLines: LineSelection[];

  mapMode: MapMode;
  focusedStop: FocusedStop | null;

  // ✅ App styr zoom-trigger
  fitSlot?: 0 | 1 | 2 | null;
  fitNonce?: number;

  // ✅ EN callback för alla picks
  onPickLine: (sel: LineSelection) => void;

  onFocusStop: (stop: FocusedStop) => void;
  onCloseFocusedStop: () => void;
  onVehicleRealtimeWarningChange?: (message: string | null) => void;
};

export default function MapView(props: Props) {
  const {
    styleUrl,
    enabledOperators,
    selectedLines,
    mapMode,
    focusedStop,
    fitSlot = null,
    fitNonce = 0,
    onPickLine,
    onFocusStop,
    onCloseFocusedStop,
    onVehicleRealtimeWarningChange,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const intervalRef = useRef<number | undefined>(undefined);
  const [mapReady, setMapReady] = useState(false);

  // Refs (för att undvika att init-effect triggas av prop-funktioner)
  const enabledOperatorsRef = useRef<Operator[]>(enabledOperators);
  const selectedLinesRef = useRef<LineSelection[]>(selectedLines);
  const mapModeRef = useRef<MapMode>(mapMode);
  const onPickLineRef = useRef(onPickLine);
  const onFocusStopRef = useRef(onFocusStop);
  const onCloseFocusedStopRef = useRef(onCloseFocusedStop);

  // browse-lines cache / race-safe
  const loadedAllRoutesOperatorRef = useRef<string | null>(null);

  const browseOperator: Operator = enabledOperators[0] ?? "SL";
  const browseOperatorKey = browseOperator;

  useEffect(() => {
    enabledOperatorsRef.current = enabledOperators;
  }, [enabledOperators]);

  useEffect(() => {
    selectedLinesRef.current = selectedLines;
  }, [selectedLines]);

  useEffect(() => {
    mapModeRef.current = mapMode;
  }, [mapMode]);

  useEffect(() => {
    onPickLineRef.current = onPickLine;
  }, [onPickLine]);

  useEffect(() => {
    onFocusStopRef.current = onFocusStop;
  }, [onFocusStop]);

  useEffect(() => {
    onCloseFocusedStopRef.current = onCloseFocusedStop;
  }, [onCloseFocusedStop]);

  // ==========================================
  // 1) Init map ONCE (🚫 inga deps)
  // ==========================================
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: [17.6, 60.0],
      zoom: 7.2,
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    let cleanupRoute: null | (() => void) = null;
    let cleanupStops: null | (() => void) = null;

    map.on("load", () => {
      addSourcesAndLayers(map);

      cleanupRoute = bindRouteInteractions({
        map,
        enabledOperatorsRef,
        selectedLinesRef,
        onPickLine: (sel) => onPickLineRef.current(sel),
      });

      // ✅ Städning: selectedLinesRef skickas inte längre in (var oanvänd)
      cleanupStops = bindStopBrowseInteractions({
        map,
        mapModeRef,
        enabledOperatorsRef,
        selectedLinesRef,
        onPickLine: (sel) => onPickLineRef.current(sel),
        onFocusStop: (stop) => onFocusStopRef.current(stop),
      });

      startVehicleUpdates({
        map,
        selectedLinesRef,
        intervalRef,
        onVehicleRealtimeWarningChange,
      });

      setMapReady(true);
    });

    return () => {
      if (intervalRef.current !== undefined) window.clearInterval(intervalRef.current);
      intervalRef.current = undefined;

      cleanupRoute?.();
      cleanupStops?.();

      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
    // ✅ init EN gång
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==========================================
  // 2) Jump to operator region
  // ==========================================
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (enabledOperators.length === 0) return;

    const op = enabledOperators[0];

    const REGION: Record<Operator, { center: [number, number]; zoom: number }> = {
      SL: { center: [18.06, 59.33], zoom: 10 },
      UL: { center: [17.64, 59.86], zoom: 11 },
      "X-trafik": { center: [17.15, 60.67], zoom: 9 },
    };

    const target = REGION[op];
    if (!target) return;

    map.flyTo({
      center: target.center,
      zoom: target.zoom,
      duration: 700,
    });
  }, [mapReady, enabledOperators[0]]);

  // ==========================================
  // 3) Focused stop marker
  // ==========================================
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    updateFocusedStopSource({
      map,
      mapMode,
      focusedStop,
      EMPTY_POINT_FC,
    });
  }, [mapReady, mapMode, focusedStop]);

  // ==========================================
  // 4) Fly to focused stop
  // ==========================================
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    flyToFocusedStop({ map, mapMode, focusedStop });
  }, [mapMode, focusedStop]);

  // ==========================================
  // 5) Popup for focused stop
  // ==========================================
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const cleanup = openFocusedStopPopup({
      map,
      mapMode,
      focusedStop,
      onPickLine: (sel) => onPickLineRef.current(sel),
      onCloseFocusedStop: () => onCloseFocusedStopRef.current(),
    });

    return cleanup;
  }, [mapMode, focusedStop]);

  // ==========================================
  // 🔥 Sök -> samma beteende som klick (explode parent)
  // När mapMode === "browse-stops" och focusedStop finns:
  // fire stopbrowse:open-parent så bindStopBrowseInteractions öppnar parent-popup + children
  // ==========================================
  const lastOpenedParentRef = useRef<string>("");

  useEffect(() => {
    // Nollställ spärren när vi lämnar browse-stops eller saknar focusedStop
    if (mapMode !== "browse-stops" || !focusedStop) {
      lastOpenedParentRef.current = "";
      return;
    }

    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;

    // Skydd: undvik att öppna samma igen pga rerenders
    const key = `${focusedStop.operator}-${focusedStop.stop_id}`;
    if (lastOpenedParentRef.current === key) return;
    lastOpenedParentRef.current = key;

    // Säkerställ att sources/layers finns (de skapas i "load")
    if (!map.getSource("stops-children")) return;

    // ✅ Skicka det som bindStopBrowseInteractions förväntar sig
    map.fire("stopbrowse:open-parent", {
      stop_id: focusedStop.stop_id,
      name: focusedStop.name,
      coordinates: [focusedStop.lon, focusedStop.lat] as [number, number],
      operator: focusedStop.operator,
    });
  }, [mapReady, mapMode, focusedStop]);

  // ==========================================
  // 6) Browse-stops: load ONLY parent stations
  // ==========================================
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const cancelledRef = { current: false };

    (async () => {
      try {
        await updateBrowseStopsStations({
          map,
          mapMode,
          browseOperator,
          EMPTY_POINT_FC,
          cancelledRef,
        });
      } catch (e) {
        console.error("browse-stops fetch failed:", e);
        const stopsSrc = map.getSource("stops") as maplibregl.GeoJSONSource | undefined;
        stopsSrc?.setData(EMPTY_POINT_FC as any);
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [mapReady, mapMode, browseOperatorKey]);

  // ==========================================
  // 7) Browse-stops: reset stop-browse UI
  // - vid operator-byte medan vi är i browse-stops
  // - när vi lämnar browse-stops
  // ==========================================
  const prevMapModeRef = useRef<MapMode>(mapMode);
  const prevOpRef = useRef<Operator | undefined>(enabledOperators[0]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const prevMode = prevMapModeRef.current;
    const prevOp = prevOpRef.current;

    const curMode = mapMode;
    const curOp = enabledOperators[0];

    prevMapModeRef.current = curMode;
    prevOpRef.current = curOp;

    // Lämnar browse-stops -> hård reset
    if (prevMode === "browse-stops" && curMode !== "browse-stops") {
      map.fire("stopbrowse:reset");
      return;
    }

    // Byter operator medan vi är i browse-stops -> reset
    if (curMode === "browse-stops" && prevOp !== curOp) {
      map.fire("stopbrowse:reset");
    }
  }, [mapReady, mapMode, enabledOperators[0]]);

  // ==========================================
  // 8) Selected routes + selected stops (slots 0–2)
  // ==========================================
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const cancelledRef = { current: false };

    (async () => {
      try {
        await updateSelectedLineLayers({
          map,
          selectedLines,
          EMPTY_ROUTE_FC,
          EMPTY_STOPS_FC,
          cancelledRef,
          fitSlot,
        });
      } catch (err) {
        console.error("Selected lines update failed:", err);
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [mapReady, selectedLines, fitSlot]);

  // ✅ 8b) FitBounds triggas EXAKT när App bump:ar fitNonce
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (fitSlot === null || fitSlot === undefined) return;

    const srcId = `routes-slot${fitSlot}`;
    const src = map.getSource(srcId) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const anySrc = src as any;
    const data = anySrc?._data as GeoJSON.FeatureCollection<GeoJSON.LineString> | undefined;
    const feature = data?.features?.[0];
    if (!feature || feature.geometry?.type !== "LineString") return;

    const coords = feature.geometry.coordinates ?? [];
    if (coords.length < 2) return;

    const bounds = new maplibregl.LngLatBounds();
    for (const [lng, lat] of coords) bounds.extend([lng, lat]);

    map.fitBounds(bounds, { padding: 70, duration: 600, maxZoom: 16 });
  }, [mapReady, fitNonce, fitSlot]);

  // 9) Browse-lines: routes-all (race-safe)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (mapMode !== "browse-lines") {
      setBrowseLinesVisibility(map, { showAll: false });
      resetBrowseLinesFilters(map);
      return;
    }

    if (enabledOperators.length === 0) {
      setBrowseLinesVisibility(map, { showAll: false });
      resetBrowseLinesFilters(map);
      loadedAllRoutesOperatorRef.current = null;
      return;
    }

    const operator = enabledOperators[0];
    const opKey = operator.toString();

    setBrowseLinesVisibility(map, { showAll: true });
    applyBrowseLinesOperatorFilter(map, operator);

    const requestKey = opKey;
    loadedAllRoutesOperatorRef.current = requestKey;

    void updateAllRoutesData(map, operator).then(() => {
      if (loadedAllRoutesOperatorRef.current !== requestKey) return;
      applyBrowseLinesOperatorFilter(map, operator);
    });
  }, [mapReady, mapMode, enabledOperators]);

  /// 10) Slot color to hover outline + halo, gray hover line
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const slotIndex = selectedLines.length;

    const slotLayer =
      slotIndex === 1
        ? "routes-slot1"
        : slotIndex === 2
        ? "routes-slot2"
        : "routes-slot0";

    const slotColor = map.getPaintProperty(slotLayer, "line-color");

    // Hover-linjen ska alltid vara grå
    if (map.getLayer("routes-all-hover-line")) {
      map.setPaintProperty(
        "routes-all-hover-line",
        "line-color",
        PALETTE.browseLineColor
      );
    }

    // Hover-outline får slotfärg
    if (slotColor && map.getLayer("routes-all-hover-outline")) {
      map.setPaintProperty("routes-all-hover-outline", "line-color", slotColor);
    }

    // Hover-halo får slotfärg
    if (slotColor && map.getLayer("routes-all-hover-halo")) {
      map.setPaintProperty("routes-all-hover-halo", "line-color", slotColor);
    }
  }, [mapReady, selectedLines]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
