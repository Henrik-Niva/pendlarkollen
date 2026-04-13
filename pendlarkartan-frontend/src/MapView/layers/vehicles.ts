import maplibregl from "maplibre-gl";
import type * as GeoJSON from "geojson";
import type { Operator, LineSelection } from "../data/types";
import { fetchVehiclesFromBackend } from "../data/fetchVehicles";
import { toOperatorCode } from "../utils/operatorCode";

type VehicleProps = {
  id?: string; // backend skickar "id"
  vehicle_id?: string;
  vehicleId?: string;
  VehicleId?: string;
  journey_id?: string;
  trip_id?: string;

  operator?: string; // backend: "sl"/"ul"/"xt"
  route_id?: string;
  line?: string;

  // ✅ NYTT: bearing från backend (0–360), kan vara null/undefined
  bearing?: number | null;

  [k: string]: any;
};

type VehicleFeature = GeoJSON.Feature<GeoJSON.Geometry, VehicleProps>;
type VehiclePointFeature = GeoJSON.Feature<GeoJSON.Point, VehicleProps>;

const VEHICLE_ICON_ID = "vehicle-diamond"; // behåller samma id som du redan använder

export function ensureVehicleDiamondIcon(map: maplibregl.Map) {
  const IMAGE_ID = "vehicle-diamond";
  if (map.hasImage(VEHICLE_ICON_ID)) return;

  const size = 64; // hög upplösning = skarp ikon
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, size, size);

  // ✨ Subtil mjuk skugga
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;

  // ✨ Stil: vit fyllning + tunn svart kontur
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 3; // tunnare kontur
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // Proportioner (lite smalare och mer elegant)
  const topY = 20;
  const midY = 26;
  const bottomY = 54;

  const leftX = 24;
  const rightX = 40;
  const peakX = size / 2;

  ctx.beginPath();
  ctx.moveTo(leftX, bottomY);
  ctx.lineTo(leftX, midY);
  ctx.lineTo(peakX, topY);
  ctx.lineTo(rightX, midY);
  ctx.lineTo(rightX, bottomY);
  ctx.closePath();

  ctx.fill();
  ctx.stroke();

  const imageData = ctx.getImageData(0, 0, size, size);

  const styleImage: maplibregl.StyleImageInterface = {
    width: size,
    height: size,
    data: imageData.data,
    render: () => false,
  };

  map.addImage(IMAGE_ID, styleImage, { pixelRatio: 2 });
}

function isRealtimeMissingError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const lower = message.toLowerCase();

  return (
    lower.includes("503") ||
    lower.includes("realtime") ||
    lower.includes("vehiclepositions") ||
    lower.includes("feed") ||
    lower.includes("fordon") ||
    lower.includes("vehicles")
  );
}

function normalizeOperator(opRaw: string): Operator {
  const op = (opRaw || "").toLowerCase();
  return op === "ul" ? "UL" : op === "sl" ? "SL" : "X-trafik";
}

function pickBackendId(props: any) {
  return (
    props?.id ??
    props?.vehicle_id ??
    props?.vehicleId ??
    props?.VehicleId ??
    props?.journey_id ??
    props?.trip_id
  );
}

function looksFiniteNumber(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function ensurePointFeature(f: any): VehiclePointFeature | null {
  if (!f || f.type !== "Feature") return null;
  if (!f.geometry || f.geometry.type !== "Point") return null;

  const c = f.geometry.coordinates;
  if (!Array.isArray(c) || c.length < 2) return null;

  const a = looksFiniteNumber(c[0]);
  const b = looksFiniteNumber(c[1]);
  if (a === null || b === null) return null;

  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [a, b] },
    properties: (f.properties ?? {}) as any,
  };
}

// Heuristik: swap om det ser ut som [lat, lon]
function fixCoordsIfNeeded(f: VehiclePointFeature): VehiclePointFeature {
  const [a, b] = f.geometry.coordinates;
  const looksLikeLonLat = Math.abs(a) <= 180 && Math.abs(b) <= 90;
  const looksLikeLatLon = Math.abs(a) <= 90 && Math.abs(b) <= 180;

  if (!looksLikeLonLat && looksLikeLatLon) {
    return {
      ...f,
      geometry: { ...f.geometry, coordinates: [b, a] as any },
    };
  }
  return f;
}

function stableId(op: Operator, line: string, backendId: string) {
  return `${op}:${line}:${backendId}`;
}

/**
 * Viktigt: backend kan returnera:
 * - { type: "FeatureCollection", features: [...] }
 * - { data: { type:"FeatureCollection", features:[...] } }
 * - något annat wrapper-format
 */
function extractFeatureCollection(payload: any): any {
  if (!payload) return null;
  if (payload.type === "FeatureCollection" && Array.isArray(payload.features)) return payload;
  if (payload.data?.type === "FeatureCollection" && Array.isArray(payload.data.features)) return payload.data;
  if (payload.featureCollection?.type === "FeatureCollection" && Array.isArray(payload.featureCollection.features)) {
    return payload.featureCollection;
  }
  return payload;
}

export function startVehicleUpdates(options: {
  map: maplibregl.Map;
  selectedLinesRef: { current: LineSelection[] };
  intervalRef: { current?: number };
  onVehicleRealtimeWarningChange?: (message: string | null) => void;
}) {
  const { map, selectedLinesRef, intervalRef, onVehicleRealtimeWarningChange } = options;

  if (intervalRef.current !== undefined) {
    window.clearInterval(intervalRef.current);
    intervalRef.current = undefined;
  }

  // säkerställ ikon + synligt lager + överst
  ensureVehicleDiamondIcon(map);
  if (map.getLayer("vehicles-diamond")) {
    map.setLayoutProperty("vehicles-diamond", "visibility", "visible");
    map.moveLayer("vehicles-diamond");
  }

  const src = map.getSource("vehicles");
  if (!src) {
    console.warn("[vehicles] missing geojson source 'vehicles'");
    return;
  }
  const vehiclesSource = src as maplibregl.GeoJSONSource;

  let tick = 0;

  intervalRef.current = window.setInterval(async () => {
    tick++;

    const selections = (selectedLinesRef.current ?? []).slice(0, 3);

    if (selections.length === 0) {
      vehiclesSource.setData({ type: "FeatureCollection", features: [] } as any);
      onVehicleRealtimeWarningChange?.(null);
      return;
    }

    try {
      const missingRealtimeLines: string[] = [];

      const perLine = await Promise.all(
        selections.map(async (sel) => {
          const operatorCode = toOperatorCode(sel.operator);
          const lineParam = sel.line.trim();

          try {
            const rawPayload = await fetchVehiclesFromBackend({
              operator: operatorCode,
              line: lineParam,
            });

            const fc = extractFeatureCollection(rawPayload);
            const featuresAny: any[] = Array.isArray(fc?.features) ? fc.features : [];

            const normalized: VehiclePointFeature[] = featuresAny.flatMap((f: VehicleFeature) => {
              const p = ensurePointFeature(f);
              if (!p) return [];

              const fixed = fixCoordsIfNeeded(p);
              const props = fixed.properties ?? {};

              const backendIdRaw = pickBackendId(props);
              const backendId =
                backendIdRaw != null && String(backendIdRaw).trim() !== ""
                  ? String(backendIdRaw)
                  : `${fixed.geometry.coordinates[0]}:${fixed.geometry.coordinates[1]}`;

              const mappedOperator = normalizeOperator(String(props?.operator ?? operatorCode));

              const bearing =
                props?.bearing === null || props?.bearing === undefined
                  ? null
                  : Number.isFinite(Number(props.bearing))
                    ? Number(props.bearing)
                    : null;

              return [
                {
                  ...fixed,
                  properties: {
                    ...props,
                    id: stableId(sel.operator, lineParam, backendId),
                    _backendId: backendIdRaw ?? null,
                    operator: mappedOperator,
                    line: lineParam,
                    bearing,
                  },
                },
              ];
            });

            return normalized;
          } catch (err: unknown) {
            if (isRealtimeMissingError(err)) {
              console.warn(
                `[vehicles] realtime saknas för ${sel.operator} linje ${lineParam}`,
                err
              );
              missingRealtimeLines.push(`${sel.operator} linje ${lineParam}`);
              return [];
            }

            throw err;
          }
        })
      );

      const all = perLine.flat();
      const byId = new Map<string, VehiclePointFeature>();

      for (const f of all) {
        const id = f?.properties?.id;
        if (!id) continue;
        byId.set(String(id), f);
      }

      const merged = Array.from(byId.values());

      vehiclesSource.setData({
        type: "FeatureCollection",
        features: merged,
      } as any);

      if (missingRealtimeLines.length > 0) {
        const uniq = Array.from(new Set(missingRealtimeLines));
        const msg =
          uniq.length === 1
            ? `Realtidsfordon saknas just nu för ${uniq[0]}.`
            : `Realtidsfordon saknas just nu för ${uniq.slice(0, -1).join(", ")} och ${uniq[uniq.length - 1]}.`;

        onVehicleRealtimeWarningChange?.(msg);
      } else {
        onVehicleRealtimeWarningChange?.(null);
      }

    } catch (err) {
      console.error("[vehicles] tick failed:", err);
    }
  }, 7000);
}