export type Operator = "SL" | "UL" | "X-trafik";
export type LineSelection = { operator: Operator; line: string };

export type MapMode =
  | "focus-selected"
  | "browse-lines"
  | "browse-stops"
  | "focus-stop";

export type FocusedStop = {
  operator: Operator;
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
};
