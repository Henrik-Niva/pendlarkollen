import maplibregl from "maplibre-gl";
import { PALETTE } from "../style/palette";
import { ensureVehicleDiamondIcon } from "./vehicles";
import { EMPTY_ROUTE_FC, EMPTY_POINT_FC, EMPTY_STOPS_FC } from "../data/empties";

export function addSourcesAndLayers(map: maplibregl.Map) {
  function safeRemoveLayer(id: string) {
    if (map.getLayer(id)) map.removeLayer(id);
  }

  function safeRemoveSource(id: string) {
    if (map.getSource(id)) map.removeSource(id);
  }

  // =========================================================
  // Shared radius / width expressions
  // =========================================================

  const browseLineBaseHaloWidth: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 1.8,
    8, 2.4,
    10, 3.2,
    12, 4.4,
    16, 6.4,
  ];

  const browseLineBaseWidth: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 0.8,
    8, 1.1,
    10, 1.5,
    12, 2.1,
    16, 3.2,
  ];

  const browseLineHoverWidth: any = PALETTE.lineWidth;

  const browseLineHoverOutlineWidth: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 2.2,
    8, 3.0,
    10, 4.0,
    12, 5.6,
    16, 8.5,
  ];

  const browseLineHoverHaloWidth: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 4.0,
    8, 6.0,
    10, 8.5,
    12, 13.0,
    16, 16.0,
  ];

  const browseLineHitboxWidth: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 10,
    8, 12,
    10, 14,
    12, 18,
    16, 24,
  ];

  // Parent browse-stops
  const parentBaseRadius: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 1.0,
    8, 2.0,
    10, 3.0,
    12, 5.0,
    16, 9.0,
  ];

  const parentHoverRadius: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 1.8,
    8, 3.2,
    10, 4.8,
    12, 7.2,
    16, 11.5,
  ];

  const parentHoverHaloRadius: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 3.0,
    8, 5.2,
    10, 7.2,
    12, 10.5,
    16, 19.0,
  ];

  const parentBaseHaloRadius: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 1.8,
    8, 3.0,
    10, 4.2,
    12, 6.6,
    16, 11.5,
  ];

  const parentHitboxRadius: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 4.0,
    8, 5.5,
    10, 7.0,
    12, 9.0,
    16, 12.0,
  ];

  // Child stops
  const childBaseRadius: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 0.9,
    8, 1.6,
    10, 2.4,
    12, 3.8,
    16, 6.2,
  ];

  const childHoverRadius: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 1.6,
    8, 2.8,
    10, 4.2,
    12, 6.4,
    16, 10.5,
  ];

  const childHoverHaloRadius: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 2.8,
    8, 4.8,
    10, 6.8,
    12, 10.0,
    16, 17.5,
  ];

  const childBaseHaloRadius: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 1.6,
    8, 2.5,
    10, 3.6,
    12, 5.4,
    16, 9.0,
  ];

  const childHitboxRadius: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 4.0,
    8, 5.5,
    10, 7.0,
    12, 9.0,
    16, 12.0,
  ];

  const childLabelSize: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 8,
    8, 10,
    10, 11,
    12, 12.5,
    16, 15.5,
  ];

  const parentStrokeWidth: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 0.9,
    10, 1.2,
    16, 1.8,
  ];

  const parentHoverStrokeWidth: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 1.1,
    10, 1.8,
    16, 2.6,
  ];

  const childStrokeWidth: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 0.8,
    10, 1.1,
    16, 1.6,
  ];

  const childHoverStrokeWidth: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 1.0,
    10, 1.7,
    16, 2.4,
  ];

  // Selected stops (linjer i slots 0–2)
  const selectedStopRadius: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 1.2,
    8, 1.6,
    10, 2,
    12, 3.2,
    16, 4.8,
  ];

  const selectedStopOutlineRadius: any = [
    "interpolate",
    ["linear"],
    ["zoom"],
    6, 2.2,
    8, 3.0,
    10, 4.0,
    12, 5,
    16, 6,
  ];

  // =========================================================
  // BROWSE-LINES: ALL ROUTES
  // =========================================================
  safeRemoveLayer("routes-all-hitbox");
  safeRemoveLayer("routes-all-hover-line");
  safeRemoveLayer("routes-all-hover-outline");
  safeRemoveLayer("routes-all-hover-halo");
  safeRemoveLayer("routes-all-base");
  safeRemoveLayer("routes-all-base-halo");

  safeRemoveSource("routes-all-hover");
  safeRemoveSource("routes-all");

  map.addSource("routes-all", { type: "geojson", data: EMPTY_ROUTE_FC as any });
  map.addSource("routes-all-hover", { type: "geojson", data: EMPTY_ROUTE_FC as any });

  // Subtil permanent halo / outline-känsla
  map.addLayer({
    id: "routes-all-base-halo",
    type: "line",
    source: "routes-all",
    layout: {
      "line-cap": "round",
      "line-join": "round",
      visibility: "none",
    },
    paint: {
      "line-width": browseLineBaseHaloWidth,
      "line-opacity": PALETTE.browseLineHaloOpacity,
      "line-color": PALETTE.browseLineHalo,
      "line-blur": 0.2,
    },
  });

  // Baslinje: neutral browse-line
  map.addLayer({
    id: "routes-all-base",
    type: "line",
    source: "routes-all",
    layout: {
      "line-cap": "round",
      "line-join": "round",
      visibility: "none",
    },
    paint: {
      "line-width": browseLineBaseWidth,
      "line-opacity": PALETTE.browseLineOpacity,
      "line-color": PALETTE.browseNeutral,
    },
  });

  // Hover glow i slotfärg
  map.addLayer({
    id: "routes-all-hover-halo",
    type: "line",
    source: "routes-all-hover",
    layout: {
      "line-cap": "round",
      "line-join": "round",
      visibility: "none",
    },
    paint: {
      "line-width": browseLineHoverHaloWidth,
      "line-opacity": [
        "interpolate",
        ["linear"],
        ["zoom"],
        6, 0.28,
        10, 0.34,
        16, 0.42,
      ],
      "line-color": PALETTE.slot0,
      "line-blur": 1.1,

      "line-opacity-transition": {
        duration: 120,
        delay: 0,
      },
    },
  });

  // Outline i slotfärg
  map.addLayer({
    id: "routes-all-hover-outline",
    type: "line",
    source: "routes-all-hover",
    layout: {
      "line-cap": "round",
      "line-join": "round",
      visibility: "none",
    },
    paint: {
      "line-width": browseLineHoverOutlineWidth,
      "line-opacity": 0.92,
      "line-color": PALETTE.slot0,

      "line-opacity-transition": {
        duration: 100,
        delay: 0,
      },
    },
  });

  // Själva hover-linjen i slotfärg
  map.addLayer({
    id: "routes-all-hover-line",
    type: "line",
    source: "routes-all-hover",
    layout: {
      "line-cap": "round",
      "line-join": "round",
      visibility: "none",
    },
    paint: {
      "line-width": browseLineHoverWidth,
      "line-opacity": 1,
      "line-color": PALETTE.browseLineHoverColor,

      "line-opacity-transition": {
        duration: 80,
        delay: 0,
      },
    },
  });

  // Hitbox
  map.addLayer({
    id: "routes-all-hitbox",
    type: "line",
    source: "routes-all",
    layout: {
      "line-cap": "round",
      "line-join": "round",
      visibility: "none",
    },
    paint: {
      "line-width": browseLineHitboxWidth,
      "line-opacity": 0,
    },
  });

  // =========================================================
  // SELECTED ROUTES (slots 0–2)
  // =========================================================
  const selectedRouteOffset = (slot: 0 | 1 | 2): any =>
    [
      "interpolate",
      ["linear"],
      ["zoom"],
      6, slot === 0 ? -1.5 : slot === 1 ? 1.5 : 0,
      10, slot === 0 ? -2.5 : slot === 1 ? 2.5 : 0,
      14, slot === 0 ? -4.0 : slot === 1 ? 4.0 : 0,
      16, slot === 0 ? -5.5 : slot === 1 ? 5.5 : 0,
    ];

    const ensureRouteSlot = (slot: 0 | 1 | 2) => {
    const srcId = `routes-slot${slot}`;
    const outlineId = `routes-slot${slot}-outline`;
    const colorId = `routes-slot${slot}`;

    if (!map.getSource(srcId)) {
      map.addSource(srcId, { type: "geojson", data: EMPTY_ROUTE_FC as any });
    }

    if (!map.getLayer(outlineId)) {
      map.addLayer({
        id: outlineId,
        type: "line",
        source: srcId,
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": PALETTE.outline,
          "line-width": PALETTE.lineOutlineWidth,
          "line-opacity": 0.95,
          "line-offset": selectedRouteOffset(slot),
        },
      });
    }

    const slotColor =
      slot === 0 ? PALETTE.slot0 : slot === 1 ? PALETTE.slot1 : PALETTE.slot2;

    if (!map.getLayer(colorId)) {
      map.addLayer({
        id: colorId,
        type: "line",
        source: srcId,
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": slotColor,
          "line-width": PALETTE.lineWidth,
          "line-opacity": 1,
          "line-offset": selectedRouteOffset(slot),
        },
      });
    }
  };

  ensureRouteSlot(0);
  ensureRouteSlot(1);
  ensureRouteSlot(2);

  // =========================================================
  // STOPS (browse-stops parent stations)
  // =========================================================
  safeRemoveLayer("stops-hitbox");
  safeRemoveLayer("stops-hover-circle");
  safeRemoveLayer("stops-hover-halo");
  safeRemoveLayer("stops-base-halo");
  safeRemoveLayer("stops-circle");
  safeRemoveSource("stops-hover");
  safeRemoveSource("stops");

  map.addSource("stops", {
    type: "geojson",
    data: EMPTY_POINT_FC as any,
  });

  map.addSource("stops-hover", {
    type: "geojson",
    data: EMPTY_POINT_FC as any,
  });

  map.addLayer({
    id: "stops-base-halo",
    type: "circle",
    source: "stops",
    layout: { visibility: "visible" },
    paint: {
      "circle-radius": parentBaseHaloRadius,
      "circle-color": PALETTE.parentStopHalo,
      "circle-opacity": PALETTE.parentStopHaloOpacity,
      "circle-blur": 0.9,
    },
  });

  map.addLayer({
    id: "stops-circle",
    type: "circle",
    source: "stops",
    layout: { visibility: "visible" },
    paint: {
      "circle-radius": parentBaseRadius,
      "circle-color": PALETTE.parentStopFill,
      "circle-opacity": 0.98,
      "circle-stroke-width": parentStrokeWidth,
      "circle-stroke-color": PALETTE.parentStopStroke,
    },
  });

  map.addLayer({
    id: "stops-hover-halo",
    type: "circle",
    source: "stops-hover",
    layout: { visibility: "visible" },
    paint: {
      "circle-radius": parentHoverHaloRadius,
      "circle-color": PALETTE.parentStopHoverHalo,
      "circle-opacity": PALETTE.parentStopHoverHaloOpacity,
      "circle-blur": 0.65,
    },
  });

  map.addLayer({
    id: "stops-hover-circle",
    type: "circle",
    source: "stops-hover",
    layout: { visibility: "visible" },
    paint: {
      "circle-radius": parentHoverRadius,
      "circle-color": PALETTE.parentStopHoverFill,
      "circle-opacity": 1,
      "circle-stroke-width": parentHoverStrokeWidth,
      "circle-stroke-color": PALETTE.parentStopHoverStroke,
    },
  });

  map.addLayer({
    id: "stops-hitbox",
    type: "circle",
    source: "stops",
    layout: { visibility: "visible" },
    paint: {
      "circle-radius": parentHitboxRadius,
      "circle-color": PALETTE.outline,
      "circle-opacity": 0,
    },
  });

  // =========================================================
  // SELECTED STOPS (per slot 0–2)
  // =========================================================
  const ensureStopSlot = (slot: 0 | 1 | 2) => {
    const srcId = `stops-live-slot${slot}`;
    const outlineId = `stops-live-slot${slot}-outline`;
    const fillId = `stops-live-slot${slot}`;

    if (!map.getSource(srcId)) {
      map.addSource(srcId, { type: "geojson", data: EMPTY_STOPS_FC as any });
    }

    if (!map.getLayer(outlineId)) {
      map.addLayer({
        id: outlineId,
        type: "circle",
        source: srcId,
        paint: {
          "circle-radius": selectedStopOutlineRadius,
          "circle-color": PALETTE.outline,
          "circle-opacity": 1,
        },
      });
    }

    if (!map.getLayer(fillId)) {
      map.addLayer({
        id: fillId,
        type: "circle",
        source: srcId,
        paint: {
          "circle-radius": selectedStopRadius,
          "circle-color": PALETTE.stopFill,
          "circle-opacity": 1,
        },
      });
    }
  };

  ensureStopSlot(0);
  ensureStopSlot(1);
  ensureStopSlot(2);

  // =========================================================
  // FOCUSED STOP
  // =========================================================
  if (!map.getSource("focused-stop")) {
    map.addSource("focused-stop", { type: "geojson", data: EMPTY_POINT_FC as any });
  }

  if (!map.getLayer("focused-stop-circle")) {
    map.addLayer({
      id: "focused-stop-circle",
      type: "circle",
      source: "focused-stop",
      paint: {
        "circle-radius": 10,
        "circle-color": PALETTE.focusedStopFill,
        "circle-stroke-width": 3,
        "circle-stroke-color": PALETTE.focusedStopStroke,
      },
    });
  }

  // =========================================================
  // CHILD STOPS (lägen)
  // =========================================================
  safeRemoveLayer("stops-children-hitbox");
  safeRemoveLayer("stops-children-hover-circle");
  safeRemoveLayer("stops-children-hover-halo");
  safeRemoveLayer("stops-children-base-halo");
  safeRemoveLayer("stops-children-label");
  safeRemoveLayer("stops-children-selected-circle");
  safeRemoveLayer("stops-children-circle");
  safeRemoveSource("stops-children-hover");
  safeRemoveSource("stops-children-selected");
  safeRemoveSource("stops-children");

  map.addSource("stops-children", {
    type: "geojson",
    data: EMPTY_POINT_FC as any,
  });

  map.addSource("stops-children-hover", {
    type: "geojson",
    data: EMPTY_POINT_FC as any,
  });

  map.addSource("stops-children-selected", {
    type: "geojson",
    data: EMPTY_POINT_FC as any,
  });

  map.addLayer({
    id: "stops-children-base-halo",
    type: "circle",
    source: "stops-children",
    layout: { visibility: "visible" },
    paint: {
      "circle-radius": childBaseHaloRadius,
      "circle-color": PALETTE.childStopHalo,
      "circle-opacity": PALETTE.childStopHaloOpacity,
      "circle-blur": 0.9,
    },
  });

  map.addLayer({
    id: "stops-children-circle",
    type: "circle",
    source: "stops-children",
    layout: { visibility: "visible" },
    paint: {
      "circle-radius": childBaseRadius,
      "circle-color": PALETTE.childStopFill,
      "circle-opacity": 1,
      "circle-stroke-width": childStrokeWidth,
      "circle-stroke-color": PALETTE.childStopStroke,
    },
  });

  map.addLayer({
    id: "stops-children-hover-halo",
    type: "circle",
    source: "stops-children-hover",
    layout: { visibility: "visible" },
    paint: {
      "circle-radius": childHoverHaloRadius,
      "circle-color": PALETTE.childStopHoverHalo,
      "circle-opacity": PALETTE.childStopHoverHaloOpacity,
      "circle-blur": 0.65,
    },
  });

  map.addLayer({
    id: "stops-children-hover-circle",
    type: "circle",
    source: "stops-children-hover",
    layout: { visibility: "visible" },
    paint: {
      "circle-radius": childHoverRadius,
      "circle-color": PALETTE.childStopHoverFill,
      "circle-opacity": 1,
      "circle-stroke-width": childHoverStrokeWidth,
      "circle-stroke-color": PALETTE.childStopHoverStroke,
    },
  });

  map.addLayer({
    id: "stops-children-hitbox",
    type: "circle",
    source: "stops-children",
    layout: { visibility: "visible" },
    paint: {
      "circle-radius": childHitboxRadius,
      "circle-color": PALETTE.outline,
      "circle-opacity": 0,
    },
  });

  map.addLayer({
    id: "stops-children-selected-circle",
    type: "circle",
    source: "stops-children-selected",
    layout: { visibility: "visible" },
    paint: {
      "circle-radius": 10,
      "circle-color": PALETTE.focusedStopFill,
      "circle-stroke-width": 3,
      "circle-stroke-color": PALETTE.focusedStopStroke,
    },
  });

  map.addLayer({
    id: "stops-children-label",
    type: "symbol",
    source: "stops-children",
    layout: {
      "text-field": ["get", "letter"],
      "text-font": ["Noto Sans Regular"],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-anchor": "bottom",
      "text-offset": [0, 0.22],
      "text-size": childLabelSize,
    },
    paint: {
      "text-color": PALETTE.childLabelColor,
      "text-halo-color": PALETTE.childLabelHalo,
      "text-halo-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        6, 1.1,
        10, 1.35,
        16, 1.8,
      ],
      "text-halo-blur": 0.15,
    },
  });

  // =========================================================
  // VEHICLES
  // =========================================================
  safeRemoveLayer("vehicles-diamond");
  safeRemoveSource("vehicles");
  map.addSource("vehicles", { type: "geojson", data: EMPTY_POINT_FC as any });

  ensureVehicleDiamondIcon(map);

  map.addLayer({
    id: "vehicles-diamond",
    type: "symbol",
    source: "vehicles",
    layout: {
      "icon-image": "vehicle-diamond",
      "icon-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        6, 0.18,
        8, 0.28,
        10, 0.40,
        12, 0.65,
        14, 0.85,
        16, 1.3,
      ],
      "icon-allow-overlap": true,
      "icon-rotate": ["coalesce", ["get", "bearing"], 0],
      "icon-rotation-alignment": "map",
    },
  });

  // =========================================================
  // FORCE layer order
  // =========================================================

  const routeAnchor = map.getLayer("routes-slot0-outline")
    ? "routes-slot0-outline"
    : null;

  const browseRouteLayers = [
    "routes-all-base-halo",
    "routes-all-base",
    "routes-all-hover-halo",
    "routes-all-hover-outline",
    "routes-all-hover-line",
    "routes-all-hitbox",
  ] as const;

  for (const id of browseRouteLayers) {
    if (!map.getLayer(id)) continue;
    if (routeAnchor) map.moveLayer(id, routeAnchor);
    else map.moveLayer(id);
  }

  const stopLayers = [
    "stops-base-halo",
    "stops-circle",
    "stops-hover-halo",
    "stops-hover-circle",
    "stops-hitbox",
  ] as const;

  for (const id of stopLayers) {
    if (!map.getLayer(id)) continue;
    map.moveLayer(id);
  }

  const childStopLayers = [
    "stops-children-base-halo",
    "stops-children-circle",
    "stops-children-hover-halo",
    "stops-children-hover-circle",
    "stops-children-hitbox",
    "stops-children-selected-circle",
    "stops-children-label",
  ] as const;

  for (const id of childStopLayers) {
    if (!map.getLayer(id)) continue;
    map.moveLayer(id);
  }

  if (map.getLayer("focused-stop-circle")) map.moveLayer("focused-stop-circle");
  if (map.getLayer("vehicles-diamond")) map.moveLayer("vehicles-diamond");
}