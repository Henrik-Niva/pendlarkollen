import maplibregl from "maplibre-gl";
import type * as GeoJSON from "geojson";
import type { Operator, LineSelection } from "../data/types";
import { fetchVehiclesFromBackend } from "../data/fetchVehicles";
import { toOperatorCode } from "../utils/operatorCode";

type VehicleProps = {
  id?: string;
  vehicle_id?: string;
  vehicleId?: string;
  VehicleId?: string;
  journey_id?: string;
  trip_id?: string;

  operator?: string;
  route_id?: string;
  line?: string;

  bearing?: number | null;

  [k: string]: any;
};

type VehiclePointFeature = GeoJSON.Feature<GeoJSON.Point, VehicleProps>;

const VEHICLE_ICON_ID = "vehicle-diamond";

// ---------------- ICON ----------------

export function ensureVehicleDiamondIcon(map: maplibregl.Map) {
  if (map.hasImage(VEHICLE_ICON_ID)) return;

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, size, size);

  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 3;

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

  map.addImage(
    VEHICLE_ICON_ID,
    {
      width: size,
      height: size,
      data: imageData.data,
      render: () => false,
    },
    { pixelRatio: 2 }
  );
}

// ---------------- HELPERS ----------------

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

function ensurePointFeature(f: any): VehiclePointFeature | null {
  if (!f || f.type !== "Feature") return null;
  if (!f.geometry || f.geometry.type !== "Point") return null;

  const c = f.geometry.coordinates;
  if (!Array.isArray(c) || c.length < 2) return null;

  const a = Number(c[0]);
  const b = Number(c[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [a, b] },
    properties: f.properties ?? {},
  };
}

function fixCoordsIfNeeded(f: VehiclePointFeature): VehiclePointFeature {
  const [a, b] = f.geometry.coordinates;

  const looksLonLat = Math.abs(a) <= 180 && Math.abs(b) <= 90;
  const looksLatLon = Math.abs(a) <= 90 && Math.abs(b) <= 180;

  if (!looksLonLat && looksLatLon) {
    return {
      ...f,
      geometry: { ...f.geometry, coordinates: [b, a] },
    };
  }

  return f;
}

function stableId(op: Operator, line: string, backendId: string) {
  return `${op}:${line}:${backendId}`;
}

function extractFeatureCollection(payload: any): any {
  if (!payload) return null;
  if (payload.type === "FeatureCollection") return payload;
  if (payload.data?.type === "FeatureCollection") return payload.data;
  return payload;
}

// ---------------- MAIN ----------------

export function startVehicleUpdates(options: {
  map: maplibregl.Map;
  selectedLinesRef: { current: LineSelection[] };
  intervalRef: { current?: number };
  onVehicleRealtimeWarningChange?: (message: string | null) => void;
}) {
  const { map, selectedLinesRef, intervalRef, onVehicleRealtimeWarningChange } = options;

  if (intervalRef.current !== undefined) {
    window.clearInterval(intervalRef.current);
  }

  ensureVehicleDiamondIcon(map);

  const src = map.getSource("vehicles");
  if (!src) return;

  const vehiclesSource = src as maplibregl.GeoJSONSource;

  intervalRef.current = window.setInterval(async () => {
    const selections = (selectedLinesRef.current ?? []).slice(0, 3);

    if (selections.length === 0) {
      vehiclesSource.setData({ type: "FeatureCollection", features: [] } as any);
      onVehicleRealtimeWarningChange?.(null);
      return;
    }

    try {
      const warnings: string[] = [];

      const perLine = await Promise.all(
        selections.map(async (sel) => {
          const operatorCode = toOperatorCode(sel.operator);
          const lineParam = sel.line.trim();

          try {
            const raw = await fetchVehiclesFromBackend({
              operator: operatorCode,
              line: lineParam,
            });

            const fc = extractFeatureCollection(raw);
            const features = Array.isArray(fc?.features) ? fc.features : [];

            // 🟡 TOM LISTA
            if (features.length === 0) {
              warnings.push(`Inga aktiva fordon för ${sel.operator} ${lineParam}`);
              return [];
            }

            return features
              .map(ensurePointFeature)
              .filter(Boolean)
              .map((f: VehiclePointFeature) => {
                const fixed = fixCoordsIfNeeded(f!);
                const props = fixed.properties ?? {};

                const idRaw = pickBackendId(props);
                const id =
                  idRaw && String(idRaw).trim()
                    ? String(idRaw)
                    : `${fixed.geometry.coordinates[0]}:${fixed.geometry.coordinates[1]}`;

                return {
                  ...fixed,
                  properties: {
                    ...props,
                    id: stableId(sel.operator, lineParam, id),
                    operator: normalizeOperator(props.operator ?? operatorCode),
                    line: lineParam,
                    bearing: Number(props.bearing) || null,
                  },
                };
              });
          } catch (err: any) {
            const msg = String(err?.message || "").toLowerCase();

            if (msg.includes("503")) {
              warnings.push(`Realtidsdata saknas för ${sel.operator} ${lineParam}`);
              return [];
            }

            if (msg.includes("404")) {
              warnings.push(`Kunde inte hitta data för ${sel.operator} ${lineParam}`);
              return [];
            }

            throw err;
          }
        })
      );

      const merged = perLine.flat();

      vehiclesSource.setData({
        type: "FeatureCollection",
        features: merged,
      } as any);

      if (warnings.length > 0) {
        const uniq = Array.from(new Set(warnings));
        onVehicleRealtimeWarningChange?.(uniq.join(". ") + ".");
      } else {
        onVehicleRealtimeWarningChange?.(null);
      }
    } catch (err) {
      console.error("[vehicles] update failed:", err);
    }
  }, 7000);
}