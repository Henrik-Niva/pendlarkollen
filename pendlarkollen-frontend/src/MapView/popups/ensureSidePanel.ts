import maplibregl from "maplibre-gl";


export function ensureSidePanel(map: maplibregl.Map) {
  const container = map.getContainer();
  let el = container.querySelector<HTMLDivElement>("#stopbrowse-sidepanel");

  if (!el) {
    el = document.createElement("div");
    el.id = "stopbrowse-sidepanel";
    el.style.position = "absolute";
    el.style.top = "90px";
    el.style.right = "14px";
    el.style.width = "360px";
    el.style.maxHeight = "70vh";
    el.style.overflow = "auto";
    el.style.background = "white";
    el.style.borderRadius = "12px";
    el.style.boxShadow = "0 10px 30px rgba(0,0,0,0.18)";
    el.style.padding = "14px";
    el.style.zIndex = "10";
    el.style.pointerEvents = "auto"; // viktig
    container.appendChild(el);
  }

  return el;
}

export function removeSidePanel(map: maplibregl.Map) {
  const container = map.getContainer();
  const el = container.querySelector("#stopbrowse-sidepanel");
  if (el) el.remove();
}