import type { Operator } from "../data/types";

export function toOperatorCode(op: Operator): "sl" | "ul" | "xt" {
  return op === "UL" ? "ul" : op === "SL" ? "sl" : "xt";
}
