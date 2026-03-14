import maplibregl from "maplibre-gl";
import type { Operator, LineSelection } from "../data/types";
import { EMPTY_ROUTE_FC } from "../data/empties";

export function bindRouteInteractions(opts: {
  map: maplibregl.Map;
  enabledOperatorsRef: { current: Operator[] };
  selectedLinesRef: { current: LineSelection[] };
  onPickLine: (sel: LineSelection) => void;
}) {
  const { map, enabledOperatorsRef, selectedLinesRef, onPickLine } = opts;

  let blockedPopup: maplibregl.Popup | null = null;
  let blockedPopupTimer: number | null = null;

  let hoverPopup: maplibregl.Popup | null = null;
  let hoverKey = "";

  // =========================================================
  // Helpers
  // =========================================================

  const clearBlockedPopup = () => {
    if (blockedPopupTimer !== null) {
      window.clearTimeout(blockedPopupTimer);
      blockedPopupTimer = null;
    }

    if (blockedPopup) {
      blockedPopup.remove();
      blockedPopup = null;
    }
  };

  const clearHoverPopup = () => {
    if (hoverPopup) {
      hoverPopup.remove();
      hoverPopup = null;
    }
    hoverKey = "";
  };

  const showBlockedPopup = (lngLat: maplibregl.LngLat) => {
    clearBlockedPopup();

    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "4px";
    wrap.style.maxWidth = "260px";

    const title = document.createElement("div");
    title.textContent = "Linjen är redan vald";
    title.style.fontSize = "14px";
    title.style.fontWeight = "800";
    title.style.lineHeight = "1.25";
    title.style.color = "#b00020";

    const body = document.createElement("div");
    body.textContent = "Rensa linjen i sidopanelen om du vill välja en annan.";
    body.style.fontSize = "12px";
    body.style.fontWeight = "500";
    body.style.lineHeight = "1.4";
    body.style.color = "rgba(0, 0, 0, 0.82)";

    wrap.appendChild(title);
    wrap.appendChild(body);

    blockedPopup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 14,
      maxWidth: "300px",
    })
      .setLngLat(lngLat)
      .setDOMContent(wrap)
      .addTo(map);

    blockedPopupTimer = window.setTimeout(() => {
      clearBlockedPopup();
    }, 1700);
  };

  const setHoverRouteData = (featureOrNull: any | null) => {
    const src = map.getSource("routes-all-hover") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    if (!featureOrNull) {
      src.setData(EMPTY_ROUTE_FC as any);
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
  };

  const pickLineFromFeature = (feature: any): LineSelection | null => {
    const line =
      String(feature?.properties?.line ?? "").trim() ||
      String(feature?.properties?.lineId ?? "").trim();

    if (!line) return null;

    const opRaw = String(feature?.properties?.operator ?? "").trim();

    const operator: Operator =
      opRaw.toLowerCase() === "ul"
        ? "UL"
        : opRaw.toLowerCase() === "sl"
        ? "SL"
        : opRaw.toLowerCase() === "xt"
        ? "X-trafik"
        : (enabledOperatorsRef.current[0] ?? "SL");

    return { operator, line };
  };

  const isAlreadySelected = (sel: LineSelection) => {
    return (selectedLinesRef.current ?? []).some(
      (x) => x.operator === sel.operator && x.line === sel.line
    );
  };

  const showHoverPopup = (lngLat: maplibregl.LngLat, sel: LineSelection) => {
    const key = `${sel.operator}-${sel.line}`;

    if (!hoverPopup || hoverKey !== key) {
      clearHoverPopup();

      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.gap = "2px";
      wrap.style.minWidth = "100px";

      const title = document.createElement("div");
      title.textContent = `${sel.operator} • Linje ${sel.line}`;
      title.style.fontSize = "13px";
      title.style.fontWeight = "700";
      title.style.lineHeight = "1.25";
      title.style.color = "#111";

      wrap.appendChild(title);

      hoverPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        closeOnMove: false,
        offset: 14,
        maxWidth: "220px",
        className: "route-hover-popup",
      })
        .setLngLat(lngLat)
        .setDOMContent(wrap)
        .addTo(map);

      hoverKey = key;
      return;
    }

    hoverPopup.setLngLat(lngLat);
  };

  // =========================================================
  // Click
  // =========================================================

  const onClick = (e: maplibregl.MapLayerMouseEvent) => {
    const feature = (e.features?.[0] as any) ?? null;
    if (!feature) return;

    const sel = pickLineFromFeature(feature);
    if (!sel) return;

    if (isAlreadySelected(sel)) {
      showBlockedPopup(e.lngLat);
      return;
    }

    clearBlockedPopup();
    onPickLine(sel);
  };

  // =========================================================
  // Hover
  // =========================================================

  const onEnter = () => {
    map.getCanvas().style.cursor = "pointer";
  };

  const onMove = (e: maplibregl.MapLayerMouseEvent) => {
    const feature = (e.features?.[0] as any) ?? null;
    if (!feature) return;

    setHoverRouteData(feature);

    const sel = pickLineFromFeature(feature);
    if (!sel) {
      clearHoverPopup();
      return;
    }

    showHoverPopup(e.lngLat, sel);
  };

  const onLeave = () => {
    map.getCanvas().style.cursor = "";
    setHoverRouteData(null);
    clearHoverPopup();
  };

  // =========================================================
  // Bind events
  // =========================================================

  map.on("click", "routes-all-hitbox", onClick);
  map.on("mouseenter", "routes-all-hitbox", onEnter);
  map.on("mousemove", "routes-all-hitbox", onMove);
  map.on("mouseleave", "routes-all-hitbox", onLeave);

  // =========================================================
  // Cleanup
  // =========================================================

  return () => {
    map.off("click", "routes-all-hitbox", onClick);
    map.off("mouseenter", "routes-all-hitbox", onEnter);
    map.off("mousemove", "routes-all-hitbox", onMove);
    map.off("mouseleave", "routes-all-hitbox", onLeave);

    clearBlockedPopup();
    clearHoverPopup();
    setHoverRouteData(null);
  };
}