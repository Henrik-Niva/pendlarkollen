
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type * as GeoJSON from "geojson";

type Operator = "SL" | "UL" | "X-trafik";
type LineSelection = { operator: Operator; line: string };
type MapMode = "focus-selected" | "browse-lines" | "browse-stops" | "focus-stop";
type FocusedStop = {
  operator: Operator;
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
};

type Props = {
  styleUrl: string;
  enabledOperators: Operator[];

  // 0–3 valda linjer i ordning (index 0 = primär)
  selectedLines: LineSelection[];

  // UI-läge: användaren håller på att välja anslutande linje
  isPickingConnection: boolean;

  // Kartan kan toggla en linje (lägg till / ta bort)
  onToggleLine: (sel: LineSelection) => void;

  // Kartan kan sätta en ny primär linje (ersätter alla)
  onSetPrimaryLine: (sel: LineSelection) => void;

  mapMode: MapMode;
  focusedStop: FocusedStop | null;
  
  onFocusStop: (stop: FocusedStop) => void;
  onCloseFocusedStop: () => void;
};

const EMPTY_ROUTE_FC: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
  type: "FeatureCollection",
  features: [],
};

const EMPTY_STOPS_FC: GeoJSON.FeatureCollection<GeoJSON.Point> = {
  type: "FeatureCollection",
  features: [],
};

const EMPTY_LINE_FC: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
  type: "FeatureCollection",
  features: [],
};

const EMPTY_POINT_FC: GeoJSON.FeatureCollection<GeoJSON.Point> = {
  type: "FeatureCollection",
  features: [],
};

function harvestPlatformLabel(
  parentName: string,
  childName: string,
  childStopId: string,
  meta?: { platform_code?: string }
) {
  const p = (parentName || "").trim();
  let c = (childName || "").trim();

  const platform = String(meta?.platform_code ?? "").trim();
  if (platform) return `Läge ${platform}`;

  // Om child-namnet börjar med stationsnamnet: skär bort
  if (p && c.toLowerCase().startsWith(p.toLowerCase())) {
    c = c.slice(p.length).trim();
  }

  c = c.replace(/^[-–—,:|/]+/, "").trim();
  if (c && c !== p) return c;

  // Fallback: suffix ur stop_id
  const m = String(childStopId).match(/(\d{1,4})\s*$/);
  if (m?.[1]) return `Läge ${parseInt(m[1], 10)}`;

  return childStopId;
}

async function fetchVehiclesFromBackend(params: { operator: string; line?: string | null }) {
  const qs = new URLSearchParams({ operator: params.operator });
  if (params.line) qs.set("line", params.line);

  const res = await fetch(`http://127.0.0.1:8000/api/vehicles?${qs.toString()}`);
  if (!res.ok) throw new Error(`Backend error ${res.status}`);
  return (await res.json()) as GeoJSON.FeatureCollection<GeoJSON.Point, any>;
}

async function fetchRouteFromBackend(params: { operator: string; line: string }) {
  const qs = new URLSearchParams({ operator: params.operator, line: params.line });
  const res = await fetch(`http://127.0.0.1:8000/api/route?${qs.toString()}`);
  if (!res.ok) throw new Error(`Route backend error ${res.status}`);
  return (await res.json()) as GeoJSON.FeatureCollection<GeoJSON.LineString, any>;
}

async function fetchStopsFromBackend(params: { operator: string; line: string }) {
  const qs = new URLSearchParams({ operator: params.operator, line: params.line });
  const res = await fetch(`http://127.0.0.1:8000/api/stops?${qs.toString()}`);
  if (!res.ok) throw new Error(`Stops backend error ${res.status}`);
  return (await res.json()) as GeoJSON.FeatureCollection<GeoJSON.Point, any>;
}

async function fetchAllStopsFromBackend(params: { operator: string }) {
  const qs = new URLSearchParams({ operator: params.operator });
  const res = await fetch(`http://127.0.0.1:8000/api/stops/all?${qs.toString()}`);
  if (!res.ok) throw new Error(`stops/all backend error ${res.status}`);
  return (await res.json()) as GeoJSON.FeatureCollection<GeoJSON.Point, any>;
}

async function fetchLinesByStopFromBackend(params: { operator: string; stop_id: string; window_min?: number }) {
  const qs = new URLSearchParams({
    operator: params.operator,
    stop_id: params.stop_id,
    window_min: String(params.window_min ?? 120),
  });
  const res = await fetch(`http://127.0.0.1:8000/api/lines/by-stop/active?${qs.toString()}`);
  if (!res.ok) throw new Error(`lines/by-stop/active backend error ${res.status}`);
  return (await res.json()) as { line: string }[];
}

type ParentStationLinesRow = {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  lines: { line: string }[];
};

async function fetchLinesByParentStationActiveFromBackend(params: {
  operator: string;
  parent_station: string;
  window_min?: number;
}): Promise<ParentStationLinesRow[]> {
  const qs = new URLSearchParams({
    operator: params.operator,
    parent_station: params.parent_station,
    window_min: String(params.window_min ?? 120),
  });

  const res = await fetch(
    `http://127.0.0.1:8000/api/lines/by-parent-station/active?${qs.toString()}`
  );
  if (!res.ok) throw new Error(`lines/by-parent-station/active backend error ${res.status}`);
  return (await res.json()) as ParentStationLinesRow[];
}


function startVehicleUpdates(options: {
  map: maplibregl.Map;
  selectedLinesRef: { current: LineSelection[] };
  intervalRef: { current?: number };
}) {
  const { map, selectedLinesRef, intervalRef } = options;


  // ✅ STÄDNING: om interval redan körs, stoppa det innan vi startar nytt
  if (intervalRef.current !== undefined) {
    window.clearInterval(intervalRef.current);
    intervalRef.current = undefined;
  }

type VehicleProps = {
  id: string;
  operator?: string; // backend skickar "sl"/"ul"/"xt"
  route_id?: string;
  trip_id?: string;
  line?: string;
};

type VehicleFeature = GeoJSON.Feature<GeoJSON.Point, VehicleProps>;


  // Hämta GeoJSON-källan vi redan lagt till i map.on("load")
const src = map.getSource("vehicles");

// Säkerhetskontroll: om source inte finns (t.ex. vid hot reload / kodändring),
// så avbryter vi utan att krascha.
if (!src) return;
const vehiclesSource = src as maplibregl.GeoJSONSource;

  // 1) STORE (id -> feature). Här ligger “sanningen” om fordonen i minnet.
  const vehiclesById = new Map<string, VehicleFeature>();

  // 2) Starta tomt. Första pollningen fyller på.

  // 3) Bygg GeoJSON för kartan (med filter från UI)
function buildCollection(): GeoJSON.FeatureCollection<GeoJSON.Point, VehicleProps> {
  return {
    type: "FeatureCollection",
    features: Array.from(vehiclesById.values()),
  };
}

  // 4) Ta emot inkommande lista (som från Trafiklab senare) och uppdatera store per ID
function applyIncoming(incoming: VehicleFeature[]) {
  const seen = new Set<string>();

  for (const v of incoming) {
    seen.add(v.properties.id);
    vehiclesById.set(v.properties.id, v); // uppdatera eller lägg till
  }

    // Ta bort fordon som inte finns med längre
  for (const id of vehiclesById.keys()) {
    if (!seen.has(id)) vehiclesById.delete(id);
    }
  }

  intervalRef.current = window.setInterval(async () => {
  try {
    // 1) Primärt val (om det finns)
    const primary = selectedLinesRef.current[0] ?? null;

    // ✅ Spara API: inga fordon innan en linje är vald
    if (!primary) {
      vehiclesSource.setData({ type: "FeatureCollection", features: [] } as any);
      return;
    }

    // 2) UI -> backend (operator + line)
    const operatorCode =
      primary.operator === "UL" ? "ul" :
      primary.operator === "SL" ? "sl" :
      "xt";

    const lineParam = primary.line.trim();

    // 3) Hämta fordon endast för vald linje
    const fc = await fetchVehiclesFromBackend({ operator: operatorCode, line: lineParam });

    // 4) Inkommande lista från backend
    const incomingRaw = (fc.features ?? []) as VehicleFeature[];

    // 5) Normalisera operator så den matchar UI ("UL"/"SL"/"X-trafik")
    const incoming: VehicleFeature[] = incomingRaw.map((f) => {
      const op = String(f.properties.operator ?? "").toLowerCase();

      const mappedOperator: Operator =
        op === "ul" ? "UL" :
        op === "sl" ? "SL" :
        op === "xt" ? "X-trafik" :
        (String(f.properties.operator) as Operator);

      return {
        ...f,
        properties: {
          ...f.properties,
          operator: mappedOperator,
        },
      };
    });

    // 6) Uppdatera store och rita om
    applyIncoming(incoming);
    vehiclesSource.setData(buildCollection());
  } catch (err) {
    console.error("Vehicle fetch failed:", err);
  }
}, 9000);

}

function ensureVehicleDiamondIcon(map: maplibregl.Map) {
  // Skapa bara ikonen en gång
  if (map.hasImage("vehicle-diamond")) return;

  const size = 32;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  
  ctx.fillStyle = "#2e7d32";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 4;

  // Rita en romb runt mitten av canvasen (utan translate/rotate)
  const cx = size / 2;
  const cy = size / 2;

  const w = 12; // halva bredden
  const h = 16; // halva höjden (minska om du vill ha mindre “spetsig” romb)

  ctx.beginPath();
  ctx.moveTo(cx, cy - h);     // top
  ctx.lineTo(cx + w, cy);     // right
  ctx.lineTo(cx, cy + h);     // bottom
  ctx.lineTo(cx - w, cy);     // left
  ctx.closePath();

  ctx.fill();
  ctx.stroke();

  // Läs pixeldata från HELA canvasen
  const imageData = ctx.getImageData(0, 0, size, size);

  const styleImage: maplibregl.StyleImageInterface = {
    width: size,
    height: size,
    data: imageData.data,
    render: () => false,
  };

  map.addImage("vehicle-diamond", styleImage, { pixelRatio: 2 });
}

export default function MapView({
  styleUrl,
  enabledOperators,
  selectedLines,
  isPickingConnection,
  mapMode,
  focusedStop,
  onToggleLine,
  onSetPrimaryLine,
  onFocusStop,
  onCloseFocusedStop,
}: Props) {

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapModeRef = useRef<MapMode>(mapMode);
  const intervalRef = useRef<number | undefined>(undefined);
  const [mapReady, setMapReady] = useState(false);
  const enabledOperatorsRef = useRef<Operator[]>(enabledOperators);
  const selectedLinesRef = useRef<LineSelection[]>(selectedLines);
  const isPickingConnectionRef = useRef<boolean>(isPickingConnection);
  const primaryKey = `${selectedLines[0]?.operator ?? ""}:${selectedLines[0]?.line ?? ""}`;
  // vilken operatör vi browse:ar (du kör oftast en åt gången)
  const browseOperator: Operator = enabledOperators[0] ?? "SL";
  const browseOperatorKey = browseOperator;

useEffect(() => {
  enabledOperatorsRef.current = enabledOperators;
}, [enabledOperators]);

useEffect(() => {
  selectedLinesRef.current = selectedLines;
}, [selectedLines]);

useEffect(() => {
  isPickingConnectionRef.current = isPickingConnection;
}, [isPickingConnection]);

useEffect(() => {
  console.log("mapMode:", mapMode, "focusedStop:", focusedStop);
}, [mapMode, focusedStop]);

useEffect(() => {
  mapModeRef.current = mapMode;
}, [mapMode]);

useEffect(() => {
  const map = mapRef.current;
  if (!map) return;
  if (mapMode !== "focus-stop") return;
  if (!focusedStop) return;

  map.flyTo({
    center: [focusedStop.lon, focusedStop.lat],
    zoom: 14,
    duration: 600,
  });
}, [mapMode, focusedStop]);

useEffect(() => {
  const map = mapRef.current;
  if (!map) return;

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
        geometry: {
          type: "Point",
          coordinates: [focusedStop.lon, focusedStop.lat],
        },
        properties: {
          stop_id: focusedStop.stop_id,
          name: focusedStop.name,
          operator: focusedStop.operator,
        },
      },
    ],
  } as any);
}, [mapMode, focusedStop]);

useEffect(() => {
  if (!mapReady) return;

  const map = mapRef.current;
  if (!map) return;

  const childrenSrc = map.getSource("stops-children") as maplibregl.GeoJSONSource | undefined;
  if (!childrenSrc) return;

  if (mapMode !== "browse-stops") {
    childrenSrc.setData(EMPTY_POINT_FC as any);
  }
}, [mapReady, mapMode]);

useEffect(() => {
  const map = mapRef.current;
  if (!map) return;

  // Vi visar popup endast i focus-stop
  if (mapMode !== "focus-stop" || !focusedStop) return;

  let cancelled = false;
  let popup: maplibregl.Popup | null = null;

  // UI -> backend operator-kod
  const operatorCode =
    focusedStop.operator === "UL" ? "ul" :
    focusedStop.operator === "SL" ? "sl" :
    "xt";

  (async () => {
    try {
      const rows = await fetchLinesByStopFromBackend({
        operator: operatorCode,
        stop_id: focusedStop.stop_id,
        window_min: 120,
      });

      if (cancelled) return;

      const lines = rows.map(r => String(r.line).trim()).filter(Boolean);

      // --- Bygg popup UI (DOM) ---
      const container = document.createElement("div");
      container.style.maxWidth = "260px";
      container.style.maxHeight = "320px";
      container.style.overflowY = "auto";

      const title = document.createElement("div");
      title.style.fontWeight = "600";
      title.style.marginBottom = "6px";
      title.textContent = focusedStop.name;
      container.appendChild(title);

      const meta = document.createElement("div");
      meta.style.fontSize = "12px";
      meta.style.opacity = "0.8";
      meta.style.marginBottom = "8px";
      meta.textContent = `Linjer vid hållplatsen (${lines.length})`;
      container.appendChild(meta);

      // “chip”-lista
      const list = document.createElement("div");
      list.style.display = "flex";
      list.style.flexWrap = "wrap";
      list.style.gap = "6px";
      container.appendChild(list);

      // Begränsa för UX (knutpunkter kan vara många)
      const MAX = 30;
      const show = lines.slice(0, MAX);

      if (show.length === 0) {
        const empty = document.createElement("div");
        empty.style.fontSize = "12px";
        empty.style.opacity = "0.8";
        empty.textContent = "Inga linjer hittades.";
        container.appendChild(empty);
      } else {
        for (const line of show) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = `Linje ${line}`;
          btn.style.padding = "6px 8px";
          btn.style.borderRadius = "999px";
          btn.style.border = "1px solid rgba(0,0,0,0.25)";
          btn.style.cursor = "pointer";
          btn.style.background = "white";
          btn.style.fontSize = "12px";

          btn.onclick = () => {
            const sel = { operator: focusedStop.operator, line };

            const hasPrimary = Boolean(selectedLinesRef.current[0]);

            if (!hasPrimary) {
              onSetPrimaryLine(sel);
            } else {
              onToggleLine(sel);
            }

            // Stäng popup direkt så vi lämnar focus-stop “hårt”
            if (popup) popup.remove();
          };

          list.appendChild(btn);
        }

        if (lines.length > MAX) {
          const more = document.createElement("div");
          more.style.marginTop = "8px";
          more.style.fontSize = "12px";
          more.style.opacity = "0.75";
          more.textContent = `Visar ${MAX} av ${lines.length}. Sök linje för fler.`;
          container.appendChild(more);
        }
      }

      popup = new maplibregl.Popup({
        closeOnClick: true,
        closeButton: true,
        offset: 12,
      })
        .setLngLat([focusedStop.lon, focusedStop.lat])
        .setDOMContent(container)
        .addTo(map);

        popup.on("close", () => {
          onCloseFocusedStop();
        });

    } catch (e) {
      console.error("lines/by-stop popup failed:", e);
    }
  })();

  return () => {
    cancelled = true;
    if (popup) popup.remove();
  };
}, [mapMode, focusedStop, onToggleLine, onSetPrimaryLine, onCloseFocusedStop]);

useEffect(() => {
  if (!containerRef.current) return;
    
    // ✅ Bygger inte om kartan om den redan finns
  if (mapRef.current) return;

  const map = new maplibregl.Map({
    container: containerRef.current,
    style: styleUrl,
    center: [18.06, 59.33],
    zoom: 9,
  });

    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    // Allt som använder addSource/addLayer bör ligga efter "load"
    map.on("load", () => {
      console.log("MapLibre load ✅");

      function safeRemoveLayer(id: string) {
        if (map.getLayer(id)) {
        map.removeLayer(id);
      }
    }

      function safeRemoveSource(id: string) {
        if (map.getSource(id)) {
        map.removeSource(id);
      }
    }

      // ===== ROUTE (linje) =====
      safeRemoveLayer("route-line");
      safeRemoveSource("route");

      map.addSource("route", {
        type: "geojson",
        data: EMPTY_LINE_FC,
      });

      // 1) Baslinje: ALLA linjer är svarta som standard
      map.addLayer({
        id: "route-base",
        type: "line",
        source: "route",
        paint: {
          "line-color": "#000000",
          "line-width": 4,
        },
      });

      // 2) Hitbox-lager: osynlig tjock linje ovanpå för att göra klick lätt
      map.addLayer({
        id: "route-hitbox",
        type: "line",
        source: "route",
        paint: {
          "line-color": "#000000",
          "line-width": 20,
          "line-opacity": 0, // 👈 osynlig men klickbar
        },
      });

      // 3) Vald linje – outline (svart kant)
      map.addLayer({
        id: "route-selected-outline",
        type: "line",
        source: "route",
        filter: ["==", ["get", "lineId"], selectedLines[0]?.line ?? ""],
        paint: {
          "line-color": "#000000",
          "line-width": 10,
        },
      });

      // 4) Vald linje – gul linje ovanpå outline
      map.addLayer({
        id: "route-selected",
        type: "line",
        source: "route",
        filter: ["==", ["get", "lineId"], selectedLines[0]?.line ?? ""],
        paint: {
          "line-color": "#FFD400",
          "line-width": 6,
        },
      });

// ===== LIVE ROUTE (från backend) =====
if (!map.getSource("route-live")) {
  map.addSource("route-live", {
    type: "geojson",
    data: EMPTY_ROUTE_FC,
  });
}

// Outline (svart kant)
if (!map.getLayer("route-live-outline")) {
  map.addLayer({
    id: "route-live-outline",
    type: "line",
    source: "route-live",
    paint: {
      "line-color": "#000000",
      "line-width": 10,
    },
  });
}

// Gul linje ovanpå
if (!map.getLayer("route-live")) {
  map.addLayer({
    id: "route-live",
    type: "line",
    source: "route-live",
    paint: {
      "line-color": "#FFD400",
      "line-width": 6,
    },
  });
}

    // ===== STOPS (hållplatser) =====
  safeRemoveLayer("stops-circle");
  safeRemoveSource("stops");
map.addSource("stops", {
  type: "geojson",
  data: EMPTY_POINT_FC,
});

map.addLayer({
  id: "stops-circle",
  type: "circle",
  source: "stops",
  paint: {
    "circle-radius": 6,
    "circle-color": "#1976d2",
    "circle-stroke-width": 2,
    "circle-stroke-color": "#ffffff",
  },
});

      // ===== LIVE STOPS (från backend) =====
if (!map.getSource("stops-live")) {
  map.addSource("stops-live", {
    type: "geojson",
    data: EMPTY_STOPS_FC,
  });
}

if (!map.getLayer("stops-live-circle")) {
  map.addLayer({
    id: "stops-live-circle",
    type: "circle",
    source: "stops-live",
    paint: {
      "circle-radius": 7,
      "circle-color": "#020202",
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });
}

// ===== FOCUSED STOP (marker) =====
if (!map.getSource("focused-stop")) {
  map.addSource("focused-stop", {
    type: "geojson",
    data: EMPTY_POINT_FC,
  });
}

if (!map.getLayer("focused-stop-circle")) {
  map.addLayer({
    id: "focused-stop-circle",
    type: "circle",
    source: "focused-stop",
    paint: {
      "circle-radius": 10,
      "circle-color": "#FFD400",
      "circle-stroke-width": 3,
      "circle-stroke-color": "#000000",
    },
  });
}

// ===== PLATFORM STOPS (lägen under en station) =====
if (!map.getSource("stops-children")) {
  map.addSource("stops-children", {
    type: "geojson",
    data: EMPTY_POINT_FC,
  });
}

if (!map.getLayer("stops-children-circle")) {
  map.addLayer({
    id: "stops-children-circle",
    type: "circle",
    source: "stops-children",
    paint: {
      "circle-radius": 5,
      "circle-color": "#ff6f00",
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });
}

      // ===== VEHICLES (fordon) =====
      safeRemoveLayer("vehicles-diamond");
      safeRemoveSource("vehicles");

      map.addSource("vehicles", {
        type: "geojson",
        data: EMPTY_POINT_FC,
      });

      // Se till att vi har en diamond-ikon innan vi skapar symbol-lagret
      ensureVehicleDiamondIcon(map);

      map.addLayer({
        id: "vehicles-diamond",
        type: "symbol",
        source: "vehicles",
        layout: {
          "icon-image": "vehicle-diamond",
          "icon-size": 1,
          "icon-allow-overlap": true,
        },
      });

    startVehicleUpdates({
      map,
      selectedLinesRef,
      intervalRef,
    });

      // Klick på hitbox väljer linjen
      map.on("click", "route-hitbox", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;

        const lineId = String(feature.properties?.lineId ?? "").trim();
        if (!lineId) return;

        // Om primärt val, använd val operatör
        // annars default "SL".
        const primaryOp = selectedLinesRef.current[0]?.operator ?? null;
        const op: Operator = primaryOp ?? (enabledOperatorsRef.current[0] ?? "SL");
        const sel = { operator: op, line: lineId };


        const current = selectedLinesRef.current;
        const alreadySelected = current.some(
          (x) => x.operator === sel.operator && x.line === sel.line
        );

        if (alreadySelected) {
          onToggleLine(sel); // toggle bort
          return;
        }

        if (isPickingConnectionRef.current) {
          onToggleLine(sel); // lägg till
          return;
        }

        // normalläge: sätt som primär (ersätt alla)
        onSetPrimaryLine(sel);
      });


      // Cursor feedback
        map.on("mouseenter", "route-hitbox", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "route-hitbox", () => {
        map.getCanvas().style.cursor = "";
      });

map.on("click", "stops-circle", (e) => {
  const feature = e.features?.[0];
  if (!feature) return;

  const stop_id = String(feature.properties?.stop_id ?? "").trim();
  const parentName = String(feature.properties?.name ?? "Okänd hållplats").trim();
  if (!stop_id) return;

  const geometry = feature.geometry as GeoJSON.Point;
  const coordinates = geometry.coordinates.slice() as [number, number];

  while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
    coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
  }

  // ✅ 1) EXPLODE endast i browse-stops
  if (mapModeRef.current === "browse-stops") {
    const operatorForBrowse = enabledOperatorsRef.current[0] ?? "SL";
    const operatorCode =
      operatorForBrowse === "UL" ? "ul" :
      operatorForBrowse === "SL" ? "sl" :
      "xt";

    const map = mapRef.current;
    if (!map) return;

    const childrenSrc = map.getSource("stops-children") as maplibregl.GeoJSONSource | undefined;
    if (!childrenSrc) {
      console.warn('Missing source "stops-children". Did you add it in map.on("load")?');
      return;
    }

    let cancelled = false;
    let popup: maplibregl.Popup | null = null;

    (async () => {
      try {
        // ✅ rätt endpoint: barn-lägen + aktiva linjer
        const rows = await fetchLinesByParentStationActiveFromBackend({
          operator: operatorCode,
          parent_station: stop_id,
          window_min: 120,
        });

        if (cancelled) return;

        // ✅ Hämta ALLA stops så vi kan slå upp riktiga lägesnamn (GTFS)
        const allStopsFc = await fetchAllStopsFromBackend({ operator: operatorCode });
        if (cancelled) return;

        // ✅ DEBUG: visa barn-stops under denna parent (från stops/all)
        console.table(
          (allStopsFc.features ?? [])
            .filter((f: any) => String(f?.properties?.parent_station ?? "").trim() === stop_id)
            .slice(0, 15)
            .map((f: any) => ({
              stop_id: String(f?.properties?.stop_id ?? ""),
              name: String(f?.properties?.name ?? ""),
              platform_code: String(f?.properties?.platform_code ?? ""),
              location_type: String(f?.properties?.location_type ?? ""),
              parent_station: String(f?.properties?.parent_station ?? ""),
            }))
        );

        // Bygg lookup: stop_id -> { name, parent_station, platform_code }
        const stopIndex = new Map<
          string,
          { name: string; parent_station: string; platform_code?: string }
        >();

        for (const f of allStopsFc.features ?? []) {
          const sid = String((f as any)?.properties?.stop_id ?? "").trim();
          if (!sid) continue;

          stopIndex.set(sid, {
            name: String((f as any)?.properties?.name ?? "").trim(),
            parent_station: String((f as any)?.properties?.parent_station ?? "").trim(),
            platform_code: String((f as any)?.properties?.platform_code ?? "").trim(),
          });
        }

        // ✅ DEBUG: visa 10 barn-stops under denna parent (från stops/all)
        

        // ✅ filtrera tomma lägen (inga aktiva linjer)
        const clean = (rows ?? [])
          .map((r) => {
            const lines = (r.lines ?? []).map(x => String(x.line).trim()).filter(Boolean);

            // ✅ Slå upp barnets riktiga name från stops/all (ofta där lägesnamnen finns)
            const childMeta = stopIndex.get(String(r.stop_id).trim());
            const childName = (childMeta?.name || r.name || "").trim();

            // ✅ Om backend skickar "fel" parent för barn (sällsynt) kan vi ändå filtrera på line-aktivitet
            const label = harvestPlatformLabel(parentName, childName, r.stop_id, {
              platform_code: (childMeta as any)?.platform_code,
            });

            return { ...r, lines, label, childName };
          })
          .filter((r) => r.lines.length > 0);

        // Rita ut lägen på kartan
        const fc: GeoJSON.FeatureCollection<GeoJSON.Point> = {
          type: "FeatureCollection",
          features: clean.map((r) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [r.lon, r.lat] },
            properties: { stop_id: r.stop_id, name: r.name, parent_station: stop_id },
          })),
        };
        childrenSrc.setData(fc as any);
        // 🔍 Zooma kartan så alla lägen syns
        if (clean.length > 0) {
          const bounds = new maplibregl.LngLatBounds();

          bounds.extend(coordinates); // ✅ parent-klickpunkten också
          for (const r of clean) bounds.extend([r.lon, r.lat]);

          map.fitBounds(bounds, {
            padding: 80,
            duration: 600,
            maxZoom: 17,
          });
        }

        // Popup DOM
        const container = document.createElement("div");
        container.style.maxWidth = "360px";

        const title = document.createElement("div");
        title.style.fontWeight = "700";
        title.style.marginBottom = "6px";
        title.textContent = parentName;
        container.appendChild(title);

        const meta = document.createElement("div");
        meta.style.fontSize = "12px";
        meta.style.opacity = "0.8";
        meta.style.marginBottom = "10px";
        meta.textContent = `Lägen med aktiva linjer (${clean.length})`;
        container.appendChild(meta);

        // Scroll-body
        const body = document.createElement("div");
        body.style.maxHeight = "320px";
        body.style.overflowY = "auto";
        body.style.paddingRight = "6px";
        body.style.display = "flex";
        body.style.flexDirection = "column";
        body.style.gap = "10px";
        container.appendChild(body);

        if (clean.length === 0) {
          const empty = document.createElement("div");
          empty.style.fontSize = "12px";
          empty.style.opacity = "0.75";
          empty.textContent = "Inga aktiva lägen/linjer just nu.";
          body.appendChild(empty);
        } else {
          // sortera stabilt
          const sorted = [...clean].sort((a, b) =>
            (a.label || a.stop_id).localeCompare((b.label || b.stop_id), "sv")
          );

          // UX: begränsa
          const MAX_SECTIONS = 40;
          const showRows = sorted.slice(0, MAX_SECTIONS);

          for (const r of showRows) {
            const section = document.createElement("div");
            section.style.padding = "8px";
            section.style.border = "1px solid rgba(0,0,0,0.10)";
            section.style.borderRadius = "10px";

            const h = document.createElement("div");
            h.style.fontWeight = "700";
            h.style.fontSize = "12px";
            h.style.marginBottom = "6px";
            h.textContent = r.label || r.stop_id;
            section.appendChild(h);

            const chips = document.createElement("div");
            chips.style.display = "flex";
            chips.style.flexWrap = "wrap";
            chips.style.gap = "6px";
            section.appendChild(chips);

            const lines = r.lines;

            for (const line of lines.slice(0, 24)) {
              const btn = document.createElement("button");
              btn.type = "button";
              btn.textContent = `Linje ${line}`;
              btn.style.padding = "6px 8px";
              btn.style.borderRadius = "999px";
              btn.style.border = "1px solid rgba(0,0,0,0.25)";
              btn.style.cursor = "pointer";
              btn.style.background = "white";
              btn.style.fontSize = "12px";

              btn.onclick = () => {
                const sel = { operator: operatorForBrowse, line };
                const hasPrimary = Boolean(selectedLinesRef.current[0]);
                if (!hasPrimary) onSetPrimaryLine(sel);
                else onToggleLine(sel);
                popup?.remove();
              };

              chips.appendChild(btn);
            }

            if (lines.length > 24) {
              const more = document.createElement("div");
              more.style.marginTop = "6px";
              more.style.fontSize = "12px";
              more.style.opacity = "0.7";
              more.textContent = `+${lines.length - 24} fler linjer…`;
              section.appendChild(more);
            }

            body.appendChild(section);
          }

          if (sorted.length > MAX_SECTIONS) {
            const moreStations = document.createElement("div");
            moreStations.style.fontSize = "12px";
            moreStations.style.opacity = "0.75";
            moreStations.textContent = `Visar ${MAX_SECTIONS} av ${sorted.length} lägen.`;
            body.appendChild(moreStations);
          }
        }

        popup = new maplibregl.Popup({
          closeOnClick: true,
          closeButton: true,
          offset: 12,
          maxWidth: "360px",
        })
          .setLngLat(coordinates)
          .setDOMContent(container)
          .addTo(map);

        popup.on("close", () => {
          childrenSrc.setData(EMPTY_POINT_FC as any);
        });

      } catch (err) {
        console.error("expand station failed:", err);
        childrenSrc.setData(EMPTY_POINT_FC as any);
      }
    })();

    // viktigt: inte fallthrough
    return;
  }

  // ✅ 2) Annars: ditt vanliga focus-stop (browse-stops explode gäller inte)
  const opRaw = String(feature.properties?.operator ?? "").toLowerCase();
  const operator: Operator =
    opRaw === "ul" ? "UL" :
    opRaw === "sl" ? "SL" :
    opRaw === "xt" ? "X-trafik" :
    (enabledOperatorsRef.current[0] ?? "SL");

  onFocusStop({
    operator,
    stop_id,
    name: parentName,
    lat: coordinates[1],
    lon: coordinates[0],
  });
});

      // --- stops-circle cursor ---
      map.on("mouseenter", "stops-circle", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "stops-circle", () => {
        map.getCanvas().style.cursor = "";
      });

      // --- stops-live-circle (lägg INNE i load så lagret garanterat finns) ---
      map.on("click", "stops-live-circle", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;

        const name = String(feature.properties?.name ?? "Okänd hållplats");
        const operator = String(feature.properties?.operator ?? "Okänd operatör");

        const geometry = feature.geometry as GeoJSON.Point;
        const coordinates = geometry.coordinates.slice() as [number, number];

        while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
          coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
        }

        const container = document.createElement("div");
        const title = document.createElement("div");
        title.style.fontWeight = "600";
        title.textContent = name;

        const sub = document.createElement("div");
        sub.style.fontSize = "12px";
        sub.style.opacity = "0.8";
        sub.textContent = operator;

        container.appendChild(title);
        container.appendChild(sub);

        new maplibregl.Popup()
          .setLngLat(coordinates)
          .setDOMContent(container)
          .addTo(map);
      });

      map.on("mouseenter", "stops-live-circle", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "stops-live-circle", () => {
        map.getCanvas().style.cursor = "";
      });

      // ✅ SISTA RADEN I load: markera kartan som redo först när ALLT är registrerat
      setMapReady(true);
    });

    map.on("error", (e) => console.error("MapLibre error ❌", e?.error || e));

  // Cleanup: stoppa interval + ta bort kartan när komponenten unmountas/hot-reloadas
  return () => {
  if (intervalRef.current !== undefined) {
    window.clearInterval(intervalRef.current);
    }

    setMapReady(false);   // 👈 VIKTIG: markera kartan som inte redo
    map.remove();
    mapRef.current = null;
  };
  }, [styleUrl]);

useEffect(() => {
  const map = mapRef.current;
  if (!map) return;

  if (!mapReady) return;

  const primary = selectedLines[0] ?? null;

  if (!primary) {
    const routeSrc = map.getSource("route-live") as maplibregl.GeoJSONSource | undefined;
    const stopsSrc = map.getSource("stops-live") as maplibregl.GeoJSONSource | undefined;
    routeSrc?.setData(EMPTY_ROUTE_FC);
    stopsSrc?.setData(EMPTY_STOPS_FC);
    return;
  }

  const operatorCode =
    primary.operator === "UL" ? "ul" :
    primary.operator === "SL" ? "sl" :
    "xt";

  const line = primary.line.trim();
  let cancelled = false;

  (async () => {
    try {
      const [routeFc, stopsFc] = await Promise.all([
        fetchRouteFromBackend({ operator: operatorCode, line }),
        fetchStopsFromBackend({ operator: operatorCode, line }),
      ]);

        console.log("route/stops fetched", {
        routeFeatures: routeFc.features?.length ?? 0,
        stopsFeatures: stopsFc.features?.length ?? 0,
        operatorCode,
        line,
      });

      if (cancelled) return;

      const routeSrc = map.getSource("route-live") as maplibregl.GeoJSONSource | undefined;
      const stopsSrc = map.getSource("stops-live") as maplibregl.GeoJSONSource | undefined;

      routeSrc?.setData(routeFc as any);
      stopsSrc?.setData(stopsFc as any);

      const first = routeFc.features?.[0];
      if (first && first.geometry.type === "LineString" && first.geometry.coordinates.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        for (const [lng, lat] of first.geometry.coordinates) bounds.extend([lng, lat]);
        map.fitBounds(bounds, { padding: 60, duration: 600 });
      }
    } catch (err) {
      console.error("Route/Stops fetch failed:", err);
    }
  })();

  return () => {
    cancelled = true;
  };
}, [mapReady, primaryKey]);

useEffect(() => {
  if (!mapReady) return;

  const map = mapRef.current;
  if (!map) return;

  const stopsSrc = map.getSource("stops") as maplibregl.GeoJSONSource | undefined;
  if (!stopsSrc) return;

  // Vi fyller bara "stops" när vi är i browse-stops
  if (mapMode !== "browse-stops") {
    stopsSrc.setData(EMPTY_POINT_FC as any);
    return;
  }

  // UI -> backend
  const operatorCode =
    browseOperator === "UL" ? "ul" :
    browseOperator === "SL" ? "sl" :
    "xt";

  let cancelled = false;

  (async () => {
    try {
      const fc = await fetchAllStopsFromBackend({ operator: operatorCode });
      if (cancelled) return;

      // ✅ Visa bara HUVUDHÅLLPLATSER i browse-stops
      const parentsOnly: GeoJSON.FeatureCollection<GeoJSON.Point> = {
        type: "FeatureCollection",
        features: (fc.features ?? []).filter((f: any) => {
          const ps = String(f?.properties?.parent_station ?? "").trim();
          const lt = Number(f?.properties?.location_type ?? 0);
          return ps === "" && lt === 1; // ✅ stationer
        }),
      };
      stopsSrc.setData(parentsOnly as any);

    } catch (e) {
      console.error("browse-stops fetch failed:", e);
      stopsSrc.setData(EMPTY_POINT_FC as any);
    }
  })();

  return () => {
    cancelled = true;
  };
}, [mapReady, mapMode, browseOperatorKey]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
      }}
    />
  );
}

