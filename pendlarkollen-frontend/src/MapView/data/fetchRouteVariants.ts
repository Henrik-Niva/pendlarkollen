import type * as GeoJSON from "geojson";
import type { Operator } from "./types";
import { toOperatorCode } from "../utils/operatorCode";

export type RouteVariantStop = {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  parent_station: string;
  sequence: number;
};

export type RouteVariant = {
  variant_id: string;
  line: string;
  route_id: string;
  direction_id: number | null;
  headsign: string;
  first_stop_name: string;
  last_stop_name: string;
  shape_id: string;
  trip_count: number;
  service_ids: string[];
  sample_trip_ids: string[];
  has_time_data: boolean;
  geometry: GeoJSON.LineString;
  stops: RouteVariantStop[];
};

type VariantFile = {
  operator: string;
  variants: RouteVariant[];
};

export async function fetchRouteVariants(operator: Operator): Promise<RouteVariant[]> {
  const op = toOperatorCode(operator); // "sl" / "ul" / "xt"

  const res = await fetch(`/generated/${op}_route_variants.json`, {
    cache: "no-cache",
  });

  if (!res.ok) {
    throw new Error(`Failed to load route variants: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as VariantFile;
  return data.variants ?? [];
}