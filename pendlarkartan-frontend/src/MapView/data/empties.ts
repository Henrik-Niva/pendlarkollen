// src/MapView/data/empties.ts
import type * as GeoJSON from "geojson";

export const EMPTY_ROUTE_FC: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
  type: "FeatureCollection",
  features: [],
};

export const EMPTY_LINE_FC: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
  type: "FeatureCollection",
  features: [],
};

export const EMPTY_POINT_FC: GeoJSON.FeatureCollection<GeoJSON.Point> = {
  type: "FeatureCollection",
  features: [],
};

export const EMPTY_STOPS_FC: GeoJSON.FeatureCollection<GeoJSON.Point> = {
  type: "FeatureCollection",
  features: [],
};
