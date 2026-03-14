// src/MapView/popups/buildStopPopup.ts

export function buildStopPopup(opts: {
  title: string;
  lines: string[];
  onPickLine: (line: string) => void;
}) {
  const { title, lines, onPickLine } = opts;

  const container = document.createElement("div");
  container.style.maxWidth = "260px";
  container.style.maxHeight = "320px";
  container.style.overflowY = "auto";

  // ---- Title ----
  const h = document.createElement("div");
  h.style.fontWeight = "700";
  h.style.marginBottom = "6px";
  h.textContent = title;
  container.appendChild(h);

  // ---- Meta ----
  const meta = document.createElement("div");
  meta.style.fontSize = "12px";
  meta.style.opacity = "0.8";
  meta.style.marginBottom = "8px";
  meta.textContent = `Linjer vid hållplatsen (${lines.length})`;
  container.appendChild(meta);

  // ---- Content ----
  if (lines.length === 0) {
    const empty = document.createElement("div");
    empty.style.fontSize = "12px";
    empty.style.opacity = "0.75";
    empty.textContent = "Inga linjer hittades.";
    container.appendChild(empty);
    return container;
  }

  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexWrap = "wrap";
  list.style.gap = "6px";
  container.appendChild(list);

  const MAX = 30;
  const visible = lines.slice(0, MAX);

  for (const line of visible) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `Linje ${line}`;
    btn.style.padding = "6px 8px";
    btn.style.borderRadius = "999px";
    btn.style.border = "1px solid rgba(0,0,0,0.25)";
    btn.style.cursor = "pointer";
    btn.style.background = "#ffffff";
    btn.style.fontSize = "12px";

    btn.onclick = () => {
      onPickLine(line);
    };

    list.appendChild(btn);
  }

  if (lines.length > MAX) {
    const more = document.createElement("div");
    more.style.marginTop = "8px";
    more.style.fontSize = "12px";
    more.style.opacity = "0.7";
    more.textContent = `Visar ${MAX} av ${lines.length}.`;
    container.appendChild(more);
  }

  return container;
}
