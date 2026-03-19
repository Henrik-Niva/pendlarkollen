/**
 * STOP BROWSE STATE MACHINE
 *
 * browse-stops:
 *   - default: all parents visible
 *
 * parent-open:
 *   - parents hidden (bara child syns)
 *   - children visible
 *   - parent popup open (i höger panel)
 *
 * child-open:
 *   - parents hidden
 *   - children visible
 *   - child popup open (på kartan)
 *
 * click outside child:
 *   -> parent-open
 *
 * click outside parent:
 *   -> browse-stops default
 */

import maplibregl from "maplibre-gl";
import type * as GeoJSON from "geojson";
import type { Operator, LineSelection, MapMode, FocusedStop } from "../data/types";
import { buildStationPopup } from "../popups/buildStationPopup";
import { harvestPlatformLabel } from "../utils/harvestPlatformLabel";
import { EMPTY_POINT_FC } from "../data/empties";
import { toOperatorCode } from "../utils/operatorCode";
import { ensureSidePanel, removeSidePanel } from "../popups/ensureSidePanel";
import {
  fetchStopsIndex,
  type StopsIndexFile,
  type StopsIndexChild,
} from "../data/fetchStopsIndex";

// ---- cache stops index per operatorCode ----
const stopsIndexCache = new Map<string, Promise<StopsIndexFile>>();

async function getStopsIndex(operatorCode: string) {
  const key = operatorCode.toLowerCase();

  const cached = stopsIndexCache.get(key);
  if (cached) return cached;

  const p = fetchStopsIndex(
    key === "ul" ? "UL" : key === "sl" ? "SL" : "X-trafik"
  );

  stopsIndexCache.set(key, p);
  return p;
}

export function _clearStopIndexCache() {
  stopsIndexCache.clear();
}

function normCoords(e: maplibregl.MapLayerMouseEvent, coords: [number, number]) {
  const c: [number, number] = [coords[0], coords[1]];
  while (Math.abs(e.lngLat.lng - c[0]) > 180) {
    c[0] += e.lngLat.lng > c[0] ? 360 : -360;
  }
  return c;
}

// A..Z, AA..AZ osv
function alphaLabel(i: number) {
  const A = "A".charCodeAt(0);
  let n = i;
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode(A + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

type ParentMode = "all" | "onlyActive" | "hidden";

export function bindStopBrowseInteractions(opts: {
  map: maplibregl.Map;
  mapModeRef: { current: MapMode };
  enabledOperatorsRef: { current: Operator[] };
  selectedLinesRef: { current: LineSelection[] };
  onPickLine: (sel: LineSelection) => void;
  onFocusStop: (stop: FocusedStop) => void;
}) {
  const { map, mapModeRef, enabledOperatorsRef, selectedLinesRef, onPickLine, onFocusStop } = opts;

  // =========================================================
  // State
  // =========================================================
  let activeParent = { stop_id: "", name: "", coordinates: [0, 0] as [number, number] };

  let cachedParentSections: Array<{ heading: string; lines: string[]; stop_id?: string }> = [];
  let cachedParentCount = 0;

  let stationPanelEl: HTMLDivElement | null = null;
  let stationPopupSmall: maplibregl.Popup | null = null;
  let childPopup: maplibregl.Popup | null = null;

  let childModeActive = false;
  let switchingChild = false;

  let lastChildrenFC: GeoJSON.FeatureCollection<GeoJSON.Point> | null = null;

  // =========================================================
  // Parents visibility / filtering
  // =========================================================
  function setParentsMode(mode: ParentMode) {
    const layerIds = [
      "stops-circle",
      "stops-hover-halo",
      "stops-hover-circle",
      "stops-hitbox",
    ];

    for (const id of layerIds) {
      if (!map.getLayer(id)) continue;

      if (mode === "hidden") {
        map.setLayoutProperty(id, "visibility", "none");
        continue;
      }

      map.setLayoutProperty(id, "visibility", "visible");

      if (mode === "all") {
        map.setFilter(id, null);
        continue;
      }

      if (activeParent.stop_id) {
        map.setFilter(id, ["==", ["get", "stop_id"], activeParent.stop_id] as any);
      } else {
        map.setFilter(id, null);
      }
    }
  }

  function clearChildrenSources() {
    const childrenSrc = map.getSource("stops-children") as maplibregl.GeoJSONSource | undefined;
    if (childrenSrc) childrenSrc.setData(EMPTY_POINT_FC as any);

    const selSrc = map.getSource("stops-children-selected") as maplibregl.GeoJSONSource | undefined;
    if (selSrc) selSrc.setData(EMPTY_POINT_FC as any);

    const hoverSrc = map.getSource("stops-children-hover") as maplibregl.GeoJSONSource | undefined;
    if (hoverSrc) hoverSrc.setData(EMPTY_POINT_FC as any);

    lastChildrenFC = null;
  }

  function setSelectedChild(featureOrNull: any | null) {
    const src = map.getSource("stops-children-selected") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    if (!featureOrNull) {
      src.setData(EMPTY_POINT_FC as any);
      return;
    }

    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: featureOrNull.geometry,
          properties: featureOrNull.properties ?? {},
        },
      ],
    } as any);
  }

  function findChildFeatureByStopId(stopId: string): any | null {
    const sid = String(stopId ?? "").trim();
    if (!sid) return null;

    const f = lastChildrenFC?.features?.find(
      (ff: any) => String(ff?.properties?.stop_id ?? "").trim() === sid
    ) as any;

    return f ?? null;
  }

  // =========================================================
  // Hover helpers (utan feature-state)
  // =========================================================
  function setHoverSourceData(
    sourceId: "stops-hover" | "stops-children-hover",
    featureOrNull: any | null
  ) {
    const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    if (!featureOrNull) {
      src.setData(EMPTY_POINT_FC as any);
      return;
    }

    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: featureOrNull.geometry,
          properties: featureOrNull.properties ?? {},
        },
      ],
    } as any);
  }

  function clearAllHoverStates() {
    setHoverSourceData("stops-hover", null);
    setHoverSourceData("stops-children-hover", null);
  }

  // =========================================================
  // browse-stops default
  // =========================================================
  function exitToBrowse() {
    childModeActive = false;

    clearAllHoverStates();

    closeChildPopup();
    closeStationPanel();
    closeStationPopupSmall();

    setSelectedChild(null);
    clearChildrenSources();
    setParentsMode("all");
  }

  // =========================================================
  // parent-open (behåll children)
  // =========================================================
  function enterParentOpenReuseCache() {
    childModeActive = false;
    closeChildPopup();
    clearAllHoverStates();

    setParentsMode("hidden");

    if (!activeParent.stop_id) return;

    void openParentStation({
      stop_id: activeParent.stop_id,
      parentName: activeParent.name,
      coordinates: activeParent.coordinates,
      reuseCache: true,
      skipFit: true,
    });
  }

  // =========================================================
  // Popup/panel helpers
  // =========================================================
  function closeStationPanel() {
    removeSidePanel(map);
    stationPanelEl = null;
  }

  function openStationPanelWithDom(dom: HTMLElement) {
    const el = ensureSidePanel(map);
    el.innerHTML = "";
    el.appendChild(dom);
    stationPanelEl = el;
  }

  function closeStationPopupSmall() {
    if (!stationPopupSmall) return;
    stationPopupSmall.remove();
    stationPopupSmall = null;
  }

  function closeChildPopup() {
    if (!childPopup) return;
    switchingChild = true;
    childPopup.remove();
    childPopup = null;
    window.setTimeout(() => {
      switchingChild = false;
    }, 0);
  }

  function isClickInsidePopup(p: maplibregl.Popup | null, e: maplibregl.MapMouseEvent) {
    if (!p) return false;
    const el = (p as any).getElement?.() as HTMLElement | undefined;
    if (!el) return false;

    const target = (e.originalEvent?.target ?? null) as Node | null;
    if (!target) return false;

    return el.contains(target);
  }

  function isClickInsideStationPanel(e: maplibregl.MapMouseEvent) {
    const el = map.getContainer().querySelector("#stopbrowse-sidepanel") as HTMLElement | null;
    if (!el) return false;

    const target = (e.originalEvent?.target ?? null) as Node | null;
    if (!target) return false;

    return el.contains(target);
  }

  // =========================================================
  // Resolve -> alltid upp till parent
  // =========================================================
  async function resolveParentFromAnyStop(opts2: {
    operatorCode: string;
    stop_id: string;
    name?: string;
    coordinates?: [number, number];
  }): Promise<{ parentId: string; parentName: string; parentCoords: [number, number] } | null> {
    const { operatorCode, stop_id, name, coordinates } = opts2;

    const data = await getStopsIndex(operatorCode);

    const childMeta = data.children?.[stop_id];
    if (childMeta) {
      const parentId = String(childMeta.parent_station || "").trim();
      const parent = (data.parents ?? []).find((p) => p.stop_id === parentId);

      return {
        parentId,
        parentName: parent?.name || name || "Okänd hållplats",
        parentCoords: parent ? [parent.lon, parent.lat] : (coordinates ?? [0, 0]),
      };
    }

    const parent = (data.parents ?? []).find((p) => p.stop_id === stop_id);
    if (parent) {
      return {
        parentId: parent.stop_id,
        parentName: parent.name || name || "Okänd hållplats",
        parentCoords: [parent.lon, parent.lat],
      };
    }

    return {
      parentId: stop_id,
      parentName: name || "Okänd hållplats",
      parentCoords: coordinates ?? [0, 0],
    };
  }

  // =========================================================
  // Stable “A/B/C…” map for ALL child stops under a parent
  // =========================================================
  async function getStableChildLetterMap(params: {
    operatorCode: string;
    parentId: string;
  }): Promise<Map<string, string>> {
    const data = await getStopsIndex(params.operatorCode);

    const parent = (data.parents ?? []).find((p) => p.stop_id === params.parentId);
    const childIds = parent?.children ?? [];

    const children: Array<{ stop_id: string; name: string }> = [];

    for (const childId of childIds) {
      const child = data.children?.[childId];
      if (!child) continue;

      children.push({
        stop_id: child.stop_id,
        name: String(child.name || "").trim(),
      });
    }

    children.sort((a, b) => {
      const an = a.name || "";
      const bn = b.name || "";
      if (an && bn && an !== bn) return an.localeCompare(bn, "sv");
      return a.stop_id.localeCompare(b.stop_id, "sv");
    });

    const m = new Map<string, string>();
    children.forEach((c, i) => {
      m.set(c.stop_id, alphaLabel(i));
    });
    return m;
  }

  // =========================================================
  // Open parent (parent-open)
  // =========================================================
  async function openParentStation(params: {
    stop_id: string;
    parentName?: string;
    coordinates?: [number, number];
    reuseCache?: boolean;
    skipFit?: boolean;
  }) {
    if (mapModeRef.current !== "browse-stops") return;

    const operatorForBrowse = enabledOperatorsRef.current[0] ?? "SL";
    const operatorCode = toOperatorCode(operatorForBrowse);

    const resolved = await resolveParentFromAnyStop({
      operatorCode,
      stop_id: params.stop_id,
      name: params.parentName,
      coordinates: params.coordinates,
    });
    if (!resolved) return;

    const { parentId, parentName, parentCoords } = resolved;

    const childrenSrc = map.getSource("stops-children") as maplibregl.GeoJSONSource | undefined;
    if (!childrenSrc) return;

    activeParent = { stop_id: parentId, name: parentName, coordinates: parentCoords };

    childModeActive = false;
    closeChildPopup();
    setSelectedChild(null);

    // bara child ska synas i parent-open
    setParentsMode("hidden");

    closeStationPanel();
    closeStationPopupSmall();
    clearAllHoverStates();

    if (params.reuseCache && cachedParentSections.length > 0) {
      const dom = buildStationPopup({
        title: parentName,
        countLabel: `Lägen med linjer (${cachedParentCount})`,
        sections: cachedParentSections,
        onPickLine: (line: string) => {
          const sel: LineSelection = { operator: operatorForBrowse, line };
          onPickLine(sel);
          exitToBrowse();
        },
        isLineSelected: (line: string) =>
          (selectedLinesRef.current ?? []).some(
            (x) => x.operator === operatorForBrowse && x.line === line
          ),
        onPickSection: ({ stop_id, heading }) => {
          void openChildFromPanel({ childStopId: stop_id, heading });
        },
        onHoverSection: (payload) => {
          if (!payload?.stop_id) {
            setHoverSourceData("stops-children-hover", null);
            return;
          }

          const feature = findChildFeatureByStopId(payload.stop_id);
          setHoverSourceData("stops-children-hover", feature);
        },
      });

      openStationPanelWithDom(dom);

      const closeBtn = dom.querySelector("[data-close]") as HTMLElement | null;
      if (closeBtn) {
        closeBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          exitToBrowse();
        });
      }

      return;
    }

    try {
      const data = await getStopsIndex(operatorCode);
      const stableLetters = await getStableChildLetterMap({ operatorCode, parentId });

      const parent = (data.parents ?? []).find((p) => p.stop_id === parentId);
      const childIds = parent?.children ?? [];

      const clean = childIds
        .map((childId) => {
          const child: StopsIndexChild | undefined = data.children?.[childId];
          if (!child) return null;

          const childName = String(child.name || "").trim();

          const harvested = harvestPlatformLabel(parentName, childName, child.stop_id, {});
          const letter = stableLetters.get(child.stop_id) || "?";
          const fullLabel = harvested ? `Läge ${letter} • ${harvested}` : `Läge ${letter}`;

          return {
            stop_id: child.stop_id,
            name: child.name,
            lat: child.lat,
            lon: child.lon,
            lines: [...(child.lines ?? [])],
            label: fullLabel,
            letter,
          };
        })
        .filter((r): r is NonNullable<typeof r> => !!r)
        .filter((r) => r.lines.length > 0);

      if (clean.length === 0) {
        childrenSrc.setData(EMPTY_POINT_FC as any);
        lastChildrenFC = null;

        closeStationPanel();
        stationPanelEl = null;
        closeStationPopupSmall();

        const dom = buildStationPopup({
          title: parentName,
          countLabel: "Inga linjer just nu i offline-index.",
          sections: [],
          onPickLine: () => {},
        });

        stationPopupSmall = new maplibregl.Popup({
          closeOnClick: false,
          closeButton: false,
          offset: 12,
          maxWidth: "360px",
        })
          .setLngLat(parentCoords)
          .setDOMContent(dom)
          .addTo(map);

        const bigClose = dom.querySelector("[data-close]") as HTMLElement | null;
        if (bigClose) {
          bigClose.addEventListener("click", (ev) => {
            ev.stopPropagation();
            exitToBrowse();
          });
        }

        return;
      }

      const fc: GeoJSON.FeatureCollection<GeoJSON.Point> = {
        type: "FeatureCollection",
        features: clean.map((r) => ({
          type: "Feature",
          id: r.stop_id,
          geometry: { type: "Point", coordinates: [r.lon, r.lat] },
          properties: {
            stop_id: r.stop_id,
            name: r.name,
            parent_station: parentId,
            label: r.label,
            letter: r.letter,
          },
        })),
      };

      childrenSrc.setData(fc as any);
      lastChildrenFC = fc;

      if (!params.skipFit && clean.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        bounds.extend(parentCoords);
        for (const r of clean) bounds.extend([r.lon, r.lat]);

        const panel = map.getContainer().querySelector("#stopbrowse-sidepanel") as HTMLElement | null;
        const panelW = panel ? panel.getBoundingClientRect().width : 360;

        const gutter = 24;
        const extra = 36;
        const rightPad = Math.round(panelW + gutter + extra);

        map.fitBounds(bounds, {
          padding: {
            top: 80,
            bottom: 80,
            left: 80,
            right: rightPad,
          },
          duration: 600,
          maxZoom: 17,
        });
      }

      const sorted = [...clean].sort((a, b) =>
        String(a.label || a.stop_id).localeCompare(String(b.label || b.stop_id), "sv")
      );

      const sections = sorted.slice(0, 40).map((r) => ({
        heading: r.label || r.stop_id,
        lines: r.lines,
        stop_id: String(r.stop_id),
      }));

      cachedParentSections = sections;
      cachedParentCount = clean.length;

      const dom = buildStationPopup({
        title: parentName,
        countLabel: `Lägen med linjer (${clean.length})`,
        sections,
        onPickLine: (line: string) => {
          const sel: LineSelection = { operator: operatorForBrowse, line };
          onPickLine(sel);
          exitToBrowse();
        },
        isLineSelected: (line: string) =>
          (selectedLinesRef.current ?? []).some(
            (x) => x.operator === operatorForBrowse && x.line === line
          ),
        onPickSection: ({ stop_id, heading }) => {
          void openChildFromPanel({ childStopId: stop_id, heading });
        },
        onHoverSection: (payload) => {
          if (!payload?.stop_id) {
            setHoverSourceData("stops-children-hover", null);
            return;
          }

          const feature = findChildFeatureByStopId(payload.stop_id);
          setHoverSourceData("stops-children-hover", feature);
        },
      });

      openStationPanelWithDom(dom);

      const closeBtn = dom.querySelector("[data-close]") as HTMLElement | null;
      if (closeBtn) {
        closeBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          exitToBrowse();
        });
      }
    } catch (err) {
      console.error("expand station failed:", err);
      exitToBrowse();
    }
  }

  // =========================================================
  // External reset
  // =========================================================
  const onExternalReset = () => {
    exitToBrowse();

    activeParent = { stop_id: "", name: "", coordinates: [0, 0] as [number, number] };
    cachedParentSections = [];
    cachedParentCount = 0;
    switchingChild = false;
  };

  map.on("stopbrowse:reset", onExternalReset as any);

  // =========================================================
  // From MapView: sök -> öppna parent
  // =========================================================
  const onOpenParentEvent = (ev: any) => {
    if (!ev) return;
    if (mapModeRef.current !== "browse-stops") return;

    const stop_id = String(ev.stop_id ?? "").trim();
    const name = String(ev.name ?? "Okänd hållplats").trim();

    const coords = (Array.isArray(ev.coordinates) ? ev.coordinates : null) as [number, number] | null;
    const lon = Number(ev.lon);
    const lat = Number(ev.lat);

    const finalCoords: [number, number] | null =
      coords && coords.length === 2
        ? [Number(coords[0]), Number(coords[1])]
        : Number.isFinite(lon) && Number.isFinite(lat)
          ? [lon, lat]
          : null;

    if (!stop_id || !finalCoords) return;

    void openParentStation({
      stop_id,
      parentName: name,
      coordinates: finalCoords,
    });
  };

  map.on("stopbrowse:open-parent", onOpenParentEvent as any);

  // =========================================================
  // Parent click + hover
  // =========================================================
  const onParentClick = async (e: maplibregl.MapLayerMouseEvent) => {
    const feature = (e.features?.[0] as any) ?? null;
    if (!feature) return;

    if (mapModeRef.current !== "browse-stops") {
      const stop_id = String(feature.properties?.stop_id ?? "").trim();
      const name = String(feature.properties?.name ?? "Okänd hållplats").trim();
      if (!stop_id) return;

      const geometry = feature.geometry as GeoJSON.Point;
      const coordinates = normCoords(e, geometry.coordinates.slice() as [number, number]);

      const opRaw = String(feature.properties?.operator ?? "").toLowerCase();
      const operator: Operator =
        opRaw === "ul" ? "UL" :
        opRaw === "sl" ? "SL" :
        opRaw === "xt" ? "X-trafik" :
        (enabledOperatorsRef.current[0] ?? "SL");

      onFocusStop({ operator, stop_id, name, lat: coordinates[1], lon: coordinates[0] });
      return;
    }

    const stop_id = String(feature.properties?.stop_id ?? "").trim();
    const parentName = String(feature.properties?.name ?? "Okänd hållplats").trim();
    if (!stop_id) return;

    const geometry = feature.geometry as GeoJSON.Point;
    const coordinates = normCoords(e, geometry.coordinates.slice() as [number, number]);

    await openParentStation({ stop_id, parentName, coordinates });
  };

  const onParentEnter = () => {
    map.getCanvas().style.cursor = "pointer";
  };

  const onParentMove = (e: maplibregl.MapLayerMouseEvent) => {
    const f = (e.features?.[0] as any) ?? null;
    if (!f) return;

    const sid = String(f?.properties?.stop_id ?? "").trim();
    if (!sid) return;

    setHoverSourceData("stops-hover", f);
  };

  const onParentLeave = () => {
    map.getCanvas().style.cursor = "";
    setHoverSourceData("stops-hover", null);
  };

  map.on("click", "stops-hitbox", onParentClick);
  map.on("mouseenter", "stops-hitbox", onParentEnter);
  map.on("mousemove", "stops-hitbox", onParentMove);
  map.on("mouseleave", "stops-hitbox", onParentLeave);

  // =========================================================
  // Open child from panel
  // =========================================================
  async function openChildFromPanel(params: { childStopId: string; heading?: string }) {
    if (mapModeRef.current !== "browse-stops") return;

    const childStopId = String(params.childStopId ?? "").trim();
    if (!childStopId) return;

    childModeActive = true;

    setParentsMode("hidden");
    closeStationPanel();
    closeStationPopupSmall();
    setHoverSourceData("stops-hover", null);
    setHoverSourceData("stops-children-hover", null);

    const operatorForBrowse = enabledOperatorsRef.current[0] ?? "SL";
    const operatorCode = toOperatorCode(operatorForBrowse);
    const parentStationId = activeParent.stop_id;
    if (!parentStationId) return;

    let coords: [number, number] | null = null;
    let featureForHighlight: any | null = null;

    const f = lastChildrenFC?.features?.find(
      (ff: any) => String(ff?.properties?.stop_id ?? "").trim() === childStopId
    ) as any;

    if (f?.geometry?.type === "Point") {
      coords = [Number(f.geometry.coordinates[0]), Number(f.geometry.coordinates[1])];
      featureForHighlight = f;
    }

    if (!coords) coords = activeParent.coordinates;

    setSelectedChild(featureForHighlight);

    const heading = String(params.heading || `Läge ${childStopId}`).trim();

    try {
      const data = await getStopsIndex(operatorCode);
      const child = data.children?.[childStopId];
      const lines = [...(child?.lines ?? [])];

      closeChildPopup();

      const dom = buildStationPopup({
        title: activeParent.name || "Läge",
        countLabel: heading,
        sections: [{ heading: "", lines }],
        onPickLine: (line: string) => {
          const sel: LineSelection = { operator: operatorForBrowse, line };
          onPickLine(sel);
          exitToBrowse();
        },
        isLineSelected: (line: string) =>
          (selectedLinesRef.current ?? []).some(
            (x) => x.operator === operatorForBrowse && x.line === line
          ),
      });

      childPopup = new maplibregl.Popup({
        closeOnClick: false,
        closeButton: false,
        offset: 12,
        maxWidth: "360px",
      })
        .setLngLat(coords)
        .setDOMContent(dom)
        .addTo(map);

      const bigClose = dom.querySelector("[data-close]") as HTMLElement | null;
      if (bigClose) {
        bigClose.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (switchingChild) return;
          enterParentOpenReuseCache();
        });
      }
    } catch (err) {
      console.error("openChildFromPanel failed:", err);
      if (activeParent.stop_id) enterParentOpenReuseCache();
      else exitToBrowse();
    }
  }

  // =========================================================
  // Child click + hover
  // =========================================================
  const onChildClick = async (e: maplibregl.MapLayerMouseEvent) => {
    const feature = (e.features?.[0] as any) ?? null;
    if (!feature) return;
    if (mapModeRef.current !== "browse-stops") return;

    const childStopId = String(feature.properties?.stop_id ?? "").trim();
    if (!childStopId) return;

    childModeActive = true;

    setSelectedChild(feature);
    setParentsMode("hidden");

    closeStationPanel();
    closeStationPopupSmall();
    setHoverSourceData("stops-hover", null);
    setHoverSourceData("stops-children-hover", null);

    const operatorForBrowse = enabledOperatorsRef.current[0] ?? "SL";
    const operatorCode = toOperatorCode(operatorForBrowse);

    const rawLabel = String(feature.properties?.label ?? "").trim();
    const rawName = String(feature.properties?.name ?? "").trim();
    const heading = rawLabel || rawName || `Läge ${childStopId}`;

    const coords = normCoords(e, (feature.geometry?.coordinates ?? [0, 0]) as [number, number]);

    try {
      const data = await getStopsIndex(operatorCode);
      const child = data.children?.[childStopId];
      const lines = [...(child?.lines ?? [])];

      closeChildPopup();

      const dom = buildStationPopup({
        title: activeParent.name || "Läge",
        countLabel: heading,
        sections: [{ heading: "", lines }],
        onPickLine: (line: string) => {
          const sel: LineSelection = { operator: operatorForBrowse, line };
          onPickLine(sel);
          exitToBrowse();
        },
        isLineSelected: (line: string) =>
          (selectedLinesRef.current ?? []).some(
            (x) => x.operator === operatorForBrowse && x.line === line
          ),
      });

      childPopup = new maplibregl.Popup({
        closeOnClick: false,
        closeButton: false,
        offset: 12,
        maxWidth: "360px",
      })
        .setLngLat(coords)
        .setDOMContent(dom)
        .addTo(map);

      const bigClose = dom.querySelector("[data-close]") as HTMLElement | null;
      if (bigClose) {
        bigClose.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (switchingChild) return;
          enterParentOpenReuseCache();
        });
      }
    } catch (err) {
      console.error("child stop popup failed:", err);
      if (activeParent.stop_id) enterParentOpenReuseCache();
      else exitToBrowse();
    }
  };

  const onChildEnter = () => {
    map.getCanvas().style.cursor = "pointer";
  };

  const onChildMove = (e: maplibregl.MapLayerMouseEvent) => {
    const f = (e.features?.[0] as any) ?? null;
    if (!f) return;

    const sid = String(f?.properties?.stop_id ?? "").trim();
    if (!sid) return;

    setHoverSourceData("stops-children-hover", f);
  };

  const onChildLeave = () => {
    map.getCanvas().style.cursor = "";
    setHoverSourceData("stops-children-hover", null);
  };

  map.on("click", "stops-children-hitbox", onChildClick);
  map.on("mouseenter", "stops-children-hitbox", onChildEnter);
  map.on("mousemove", "stops-children-hitbox", onChildMove);
  map.on("mouseleave", "stops-children-hitbox", onChildLeave);

  // =========================================================
  // Global map-click: klick utanför
  // =========================================================
  const onMapClick = (e: maplibregl.MapMouseEvent) => {
    if (mapModeRef.current !== "browse-stops") return;

    if (isClickInsideStationPanel(e)) return;
    if (isClickInsidePopup(childPopup, e)) return;
    if (isClickInsidePopup(stationPopupSmall, e)) return;

    const hitChild = map.queryRenderedFeatures(e.point, { layers: ["stops-children-hitbox"] });
    if (hitChild?.length) return;

    const hitParent = map.queryRenderedFeatures(e.point, { layers: ["stops-hitbox"] });
    if (hitParent?.length) return;

    if (childModeActive) {
      enterParentOpenReuseCache();
      return;
    }

    if (stationPanelEl || stationPopupSmall) {
      exitToBrowse();
      return;
    }
  };

  map.on("click", onMapClick);

  // =========================================================
  // cleanup
  // =========================================================
  return () => {
    map.off("click", "stops-hitbox", onParentClick);
    map.off("mouseenter", "stops-hitbox", onParentEnter);
    map.off("mousemove", "stops-hitbox", onParentMove);
    map.off("mouseleave", "stops-hitbox", onParentLeave);

    map.off("click", "stops-children-hitbox", onChildClick);
    map.off("mouseenter", "stops-children-hitbox", onChildEnter);
    map.off("mousemove", "stops-children-hitbox", onChildMove);
    map.off("mouseleave", "stops-children-hitbox", onChildLeave);

    map.off("stopbrowse:reset", onExternalReset as any);
    map.off("stopbrowse:open-parent", onOpenParentEvent as any);
    map.off("click", onMapClick);

    closeChildPopup();
    closeStationPanel();
    closeStationPopupSmall();
    clearAllHoverStates();

    setParentsMode("all");
  };
}