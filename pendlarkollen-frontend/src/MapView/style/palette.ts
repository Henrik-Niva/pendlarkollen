// =========================================================
// Central färgpalett för kartan (MapView)
//
// Alla kartfärger definieras här.
// UI-färger ligger i App.css.
// =========================================================

export const PALETTE = {

  // =========================================================
  // Grundfärger
  // =========================================================

  outline: "#000000",
  white: "#ffffff",

  // Neutral browse-färg (linjer + hållplatser)
  browseNeutral: "#7d7d7d",

  // Subtil mörk kant / halo runt neutrala element
  browseNeutralHalo: "#000000",
  browseNeutralHaloOpacity: 0.08,

  // =========================================================
  // Browse-lines
  // =========================================================

  browseLineColor: "#b3b3b3",        // samma som browse-stops
  browseLineOpacity: 0.98,

  // subtil outline under linjen
  browseLineHalo: "#7d7d7d",
  browseLineHaloOpacity: 0.30,

  // Browse-line hover
  browseLineHoverColor: "#6b6b6b",

  // =========================================================
  // Slot-färger (valda linjer)
  // =========================================================

  slot0: "#2F6BFF", // blå
  slot1: "#E53935", // röd
  slot2: "#2E7D32", // grön

  // =========================================================
  // Browse-stops (parent stations)
  // =========================================================

  parentStopFill: "#7d7d7d",
  parentStopStroke: "#ffffff",

  parentStopHalo: "#000000",
  parentStopHaloOpacity: 0.08,

  // Hover
  parentStopHoverFill: "#ff6f00",
  parentStopHoverStroke: "#ffffff",

  parentStopHoverHalo: "#ff6f00",
  parentStopHoverHaloOpacity: 0.48,

  // =========================================================
  // Child stops (lägen)
  // =========================================================

  childStopFill: "#ff6f00",
  childStopStroke: "#ffffff",

  childStopHalo: "#000000",
  childStopHaloOpacity: 0.08,

  // Hover
  childStopHoverFill: "#ff6f00",
  childStopHoverStroke: "#ffffff",

  childStopHoverHalo: "#ff6f00",
  childStopHoverHaloOpacity: 0.48,

  // =========================================================
  // Selected stops (linjer i slots)
  // =========================================================

  stopFill: "#ffffff",

  // =========================================================
  // Focused stop
  // =========================================================

  focusedStopFill: "#ff6f00",
  focusedStopStroke: "#000000",

  // =========================================================
  // Labels
  // =========================================================

  childLabelColor: "#000000",
  childLabelHalo: "rgba(255,255,255,0.96)",

  // =========================================================
  // Storlekstokens
  // =========================================================

  stopRadius: 3,
  stopOutlineRadius: 5,

  lineWidth: 4,
  lineOutlineWidth: 6,
  hitboxWidth: 20,

} as const;