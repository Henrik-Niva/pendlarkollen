// src/MapView/popups/buildStationPopup.ts
export function buildStationPopup(opts: {
  title: string;
  countLabel: string;

  // ✅ section = “kortet” för ett läge
  sections: Array<{ heading: string; lines: string[]; stop_id?: string }>;

  onPickLine: (line: string) => void;

  showClose?: boolean;

  // ✅ “linjen redan vald”
  isLineSelected?: (line: string) => boolean;
  alreadySelectedText?: string;

  // ✅ klick på hela kortet
  onPickSection?: (payload: { heading: string; stop_id: string }) => void;

  // hover från panel -> markera punkt på kartan
  onHoverSection?: (payload: { heading: string; stop_id: string } | null) => void;
}) {
    const {
    title,
    countLabel,
    sections,
    onPickLine,
    showClose = true,
    isLineSelected,
    alreadySelectedText = "Linjen är redan vald. Rensa den i sidopanelen.",
    onPickSection,
    onHoverSection,
  } = opts;

  const container = document.createElement("div");
  container.style.maxWidth = "360px";

  // ---- Header row: title + close ----
  const headerRow = document.createElement("div");
  headerRow.style.display = "flex";
  headerRow.style.alignItems = "flex-start";
  headerRow.style.justifyContent = "space-between";
  headerRow.style.gap = "10px";
  headerRow.style.marginBottom = "6px";
  container.appendChild(headerRow);

  const h = document.createElement("div");
  h.style.fontWeight = "800";
  h.style.fontSize = "18px";
  h.style.lineHeight = "1.2";
  h.textContent = title;
  headerRow.appendChild(h);

  if (showClose) {
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Stäng");
    closeBtn.setAttribute("title", "Stäng");
    closeBtn.setAttribute("data-close", "1");
    closeBtn.textContent = "×";

    closeBtn.style.flex = "0 0 auto";
    closeBtn.style.width = "32px";
    closeBtn.style.height = "32px";
    closeBtn.style.borderRadius = "10px";
    closeBtn.style.border = "1px solid rgba(0,0,0,0.12)";
    closeBtn.style.background = "white";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.fontSize = "20px";
    closeBtn.style.lineHeight = "28px";
    closeBtn.style.display = "grid";
    closeBtn.style.placeItems = "center";

    closeBtn.addEventListener("mouseenter", () => {
      closeBtn.style.background = "rgba(0,0,0,0.04)";
    });
    closeBtn.addEventListener("mouseleave", () => {
      closeBtn.style.background = "white";
    });

    headerRow.appendChild(closeBtn);
  }

  const meta = document.createElement("div");
  meta.style.fontSize = "15px";
  meta.style.fontWeight = "600";
  meta.style.lineHeight = "1.35";
  meta.style.opacity = "0.85";
  meta.style.marginBottom = "10px";
  meta.textContent = countLabel;
  container.appendChild(meta);

  const body = document.createElement("div");
  body.style.maxHeight = "320px";
  body.style.overflowY = "auto";
  body.style.padding = "6px";
  body.style.paddingRight = "10px";
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "10px";
  container.appendChild(body);

  type SectionNormalized = { heading: string; lines: string[]; stop_id: string };

  const normalizedSections: SectionNormalized[] = (sections ?? []).map((s) => ({
    heading: String(s.heading ?? ""),
    lines: Array.isArray(s.lines) ? s.lines.map((x) => String(x)) : [],
    stop_id: s.stop_id ? String(s.stop_id) : "",
  }));

  // ✅ Accordion bara när vi har flera sektioner (parent-panel).
  // Child-popup har normalt bara 1 sektion => ingen accordion där.
  const useAccordion = normalizedSections.length > 1;

  // Om sections är tom: visa inget mer (countLabel räcker)
  if (normalizedSections.length === 0) return container;

  // Inline hint state (som i App)
  let hintTimer: number | undefined;

  // Accordion-state per section
  const expandedSections = new Map<string, boolean>();

  function showInlineHint(btn: HTMLButtonElement) {
    const prev = btn.querySelector(".inlineHintError");
    if (prev) prev.remove();

    const hint = document.createElement("div");
    hint.className = "inlineHintError";
    hint.textContent = alreadySelectedText;
    btn.appendChild(hint);

    if (hintTimer !== undefined) window.clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => {
      const el = btn.querySelector(".inlineHintError");
      if (el) el.remove();
    }, 1600);
  }

  function renderLineButtonsInto(
    chipsEl: HTMLElement,
    linesToRender: string[],
    attachGlowSuppressorToButton?: (btnEl: HTMLElement) => void
  ) {
    chipsEl.innerHTML = "";

    for (const line of linesToRender) {
      const btn = document.createElement("button");
      btn.type = "button";

      const selected = isLineSelected ? !!isLineSelected(line) : false;
      btn.className = `listItem ${selected ? "listItemSelected" : ""}`;
      btn.style.width = "100%";
      btn.style.textAlign = "center";
      btn.style.padding = "8px 10px";
      btn.style.whiteSpace = "nowrap";

      btn.textContent = `Linje ${line}`;
      btn.title = selected ? "Linjen redan vald (rensa i sidopanelen)" : "Klicka för att välja linje";

      btn.onclick = (ev) => {
        ev.stopPropagation(); // ✅ viktigt så section-click inte triggas
        if (selected) {
          showInlineHint(btn);
          return;
        }
        onPickLine(line);
      };

      // ✅ släck kort-glow när man hovrar line-knappen
      attachGlowSuppressorToButton?.(btn);

      chipsEl.appendChild(btn);
    }
  }

  for (const s of normalizedSections) {
    const section = document.createElement("div");
    const canPickSection = !!onPickSection && !!s.stop_id;

    section.style.padding = "10px";
    section.style.border = "1px solid #aaa7a7";
    section.style.borderRadius = "12px";
    section.style.background = "white";
    section.style.transition = "box-shadow 120ms ease, transform 120ms ease";

    // --- glow helpers per section ---
    let pointerInsideSection = false;

    function setSectionGlow(on: boolean) {
      section.style.boxShadow = on ? "0 0 0 2px #ffd54f, 0 4px 12px rgba(0,0,0,0.12)" : "none";
    }

    // ✅ När man hovrar knappar inuti kortet: släck kortets glow
    function attachGlowSuppressorToButton(btnEl: HTMLElement) {
      btnEl.addEventListener("mouseenter", (ev) => {
        ev.stopPropagation();
        setSectionGlow(false);
      });
      btnEl.addEventListener("mouseleave", (ev) => {
        ev.stopPropagation();
        if (pointerInsideSection) setSectionGlow(true);
      });
    }

    // ✅ klickbart “kort” -> open child popup (parent-panel)
      if (canPickSection) {
        section.style.cursor = "pointer";

        section.addEventListener("mouseenter", () => {
          pointerInsideSection = true;
          setSectionGlow(true);
          onHoverSection?.({ heading: s.heading, stop_id: s.stop_id });
        });

        section.addEventListener("mouseleave", () => {
          pointerInsideSection = false;
          setSectionGlow(false);
          onHoverSection?.(null);
        });

        section.addEventListener("click", (ev) => {
          const target = ev.target as HTMLElement | null;
          if (target && target.closest("button")) return;
          onPickSection?.({ heading: s.heading, stop_id: s.stop_id });
        });
      }

    // --- Section header row: heading (left) + toggle (right) ---
    const secHeader = document.createElement("div");
    secHeader.style.display = "flex";
    secHeader.style.alignItems = "center";
    secHeader.style.justifyContent = "space-between";
    secHeader.style.gap = "10px";
    secHeader.style.marginBottom = "8px";

    const sh = document.createElement("div");
    sh.style.fontWeight = "800";
    sh.style.fontSize = "12px";
    sh.textContent = s.heading;

    secHeader.appendChild(sh);
    section.appendChild(secHeader);

    // --- Chips grid ---
    const chips = document.createElement("div");
    chips.style.display = "grid";
    chips.style.gridTemplateColumns = "repeat(auto-fill, minmax(86px, 1fr))";
    chips.style.gap = "8px";
    section.appendChild(chips);

    const lines = s.lines ?? [];
    const key = s.stop_id || s.heading;

    const expanded = expandedSections.get(key) === true;

    // ✅ Parent: visa kort lista tills expand
    // ✅ Child: visa allt (useAccordion=false)
    const visibleLines = useAccordion ? (expanded ? lines : lines.slice(0, 3)) : lines;

    renderLineButtonsInto(chips, visibleLines, attachGlowSuppressorToButton);

    // ✅ Toggle endast i parent-panel och endast om det finns fler än 3 linjer
    if (useAccordion && lines.length > 3) {
      const toggle = document.createElement("button");
      toggle.type = "button";

      toggle.textContent = expanded ? "Visa färre" : `Visa alla (${lines.length})`;

      // ✅ pill-look som searchbar (uiPill)
      toggle.className = "uiPill";
      toggle.style.flex = "0 0 auto";
      toggle.style.fontSize = "11px";
      toggle.style.padding = "4px 8px";
      toggle.style.whiteSpace = "nowrap";
      toggle.style.transform = "scale(0.92)";

      // ✅ släck kort-glow när man hovrar toggle
      attachGlowSuppressorToButton(toggle);

      toggle.onclick = (ev) => {
        ev.stopPropagation();

        const nowExpanded = !(expandedSections.get(key) === true);
        expandedSections.set(key, nowExpanded);

        const nextVisible = nowExpanded ? lines : lines.slice(0, 3);
        renderLineButtonsInto(chips, nextVisible, attachGlowSuppressorToButton);

        toggle.textContent = nowExpanded ? "Visa färre" : `Visa alla (${lines.length})`;
      };

      secHeader.appendChild(toggle);
    }

    body.appendChild(section);
  }

  return container;
}