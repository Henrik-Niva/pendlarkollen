import { API_BASE_URL } from "./config";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView from "./MapView/MapView";
import "./App.css";

declare const __APP_VERSION__: string;

type Operator = "SL" | "UL" | "X-trafik";
type BackendOp = "ul" | "sl" | "xt";

type LineItem = { operator: Operator; line: string };
type LineSelection = { operator: Operator; line: string };

type SearchMode = "line" | "stop";
type StopItem = { operator: Operator; stop_id: string; name: string; lat: number; lon: number };
type FocusedStop = StopItem;

type MapMode = "focus-selected" | "browse-lines" | "browse-stops" | "focus-stop";

type RtStatusResponse = Record<string, { ok: boolean; reason?: string | null }>;
type UiHint = { text: string; variant: "neutral" | "error" };

export default function App() {

  const APP_VERSION = __APP_VERSION__;

  // ✅ Start: ingen operatör vald
  const [selectedOperator, setSelectedOperator] = useState<Operator | null>(null);

  const [searchMode, setSearchMode] = useState<SearchMode>("line");
  const [lineQuery, setLineQuery] = useState("");

  // Slots 0–2 = selectedLines[0..2]
  const [selectedLines, setSelectedLines] = useState<LineSelection[]>([]);
  const selectedLinesRef = useRef<LineSelection[]>([]);
  useEffect(() => {
    selectedLinesRef.current = selectedLines;
  }, [selectedLines]);

  const [lineResults, setLineResults] = useState<LineItem[]>([]);

  const [isDockOpen, setIsDockOpen] = useState(false);
  const [isResultsOpen, setIsResultsOpen] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [maxPulse, setMaxPulse] = useState(false);
  const [uiHint, setUiHint] = useState<UiHint | null>(null);

  // ✅ NYTT: vilken redan-vald rad som klickades (för inline hint i knappen)
  const [selectedClickKey, setSelectedClickKey] = useState<string | null>(null);

  const [stopResults, setStopResults] = useState<StopItem[]>([]);
  const [stopLoading, setStopLoading] = useState(false);

  const searchDockRef = useRef<HTMLDivElement | null>(null);
  const uiHintTimerRef = useRef<number | null>(null);

  const [mapMode, setMapMode] = useState<MapMode>("focus-selected");
  const [focusedStop, setFocusedStop] = useState<FocusedStop | null>(null);

  // ✅ zoom trigger till MapView (senast valda slot)
  const [fitSlot, setFitSlot] = useState<0 | 1 | 2 | null>(null);
  const [fitNonce, setFitNonce] = useState(0);

  // ✅ Om ingen operatör vald: tom lista (inget fetch, ingen flyTo)
  const enabledOperators = useMemo<Operator[]>(
    () => (selectedOperator ? [selectedOperator] : []),
    [selectedOperator]
  );

  // ✅ Realtidsvarning (UI-state)
  const [rtWarning, setRtWarning] = useState<string | null>(null);
  const [lineRtWarning, setLineRtWarning] = useState<string | null>(null);

  function uiOpToBackend(op: Operator): BackendOp {
    if (op === "UL") return "ul";
    if (op === "SL") return "sl";
    return "xt";
  }

  function backendOpToUi(op: string): Operator {
    const k = (op || "").toLowerCase();
    if (k === "sl") return "SL";
    if (k === "ul") return "UL";
    return "X-trafik";
  }

  function formatOpListSw(ops: string[]) {
    const uniq = Array.from(new Set(ops)).filter(Boolean);
    if (uniq.length === 0) return "";
    if (uniq.length === 1) return uniq[0];
    if (uniq.length === 2) return `${uniq[0]} och ${uniq[1]}`;
    return `${uniq.slice(0, -1).join(", ")} och ${uniq[uniq.length - 1]}`;
  }

  function showHint(msg: string, variant: "neutral" | "error" = "neutral") {
    if (uiHintTimerRef.current !== null) {
      window.clearTimeout(uiHintTimerRef.current);
      uiHintTimerRef.current = null;
    }

    setUiHint({ text: msg, variant });

    uiHintTimerRef.current = window.setTimeout(() => {
      setUiHint(null);
      uiHintTimerRef.current = null;
    }, 1800);
  }

  function triggerPickerPulse() {
    setMaxPulse(true);
    window.setTimeout(() => setMaxPulse(false), 550);
  }

  function requestFit(slot: 0 | 1 | 2) {
    setFitSlot(slot);
    setFitNonce((n) => n + 1);
  }

  function afterSuccessfulPick() {
    setSelectedClickKey(null);

    // ✅ Rensa sökrutan + gamla resultat så nästa öppning är “ren”
    setLineQuery("");
    setStopResults([]);
    setUiHint(null);

    // 🔔 visa pulse direkt
    triggerPickerPulse();

    // ⏱️ vänta lite innan UI stängs
    window.setTimeout(() => {
      setIsResultsOpen(false);
      setIsDockOpen(false);
      setIsSearchFocused(false);
    }, 70);
  }

  function nextFreeSlot(lines: LineSelection[]): 0 | 1 | 2 | null {
    if (!lines[0]) return 0;
    if (!lines[1]) return 1;
    if (!lines[2]) return 2;
    return null;
  }

  function clearSlot(slot: 0 | 1 | 2) {
    setSelectedLines((prev) => {
      if (slot === 0) return [];
      if (slot === 1) return prev.slice(0, 1);
      return prev.slice(0, 2);
    });

    // 🔔 Feedback till användaren: dags att välja ny linje
    triggerPickerPulse();
  }

  function setSlotSelection(slot: 0 | 1 | 2, sel: LineSelection) {
    setSelectedLines((prev) => {
      const dupElsewhere = prev.some((x, i) => i !== slot && x.operator === sel.operator && x.line === sel.line);
      if (dupElsewhere) return prev;

      const next = [...prev];
      next[slot] = sel;
      return next.slice(0, 3);
    });

    requestFit(slot);
    setMapMode("focus-selected");
    setFocusedStop(null);
  }

  const maxLinesReached = selectedLines.length >= 3;

  type PickResult = "picked" | "cleared" | "blocked";

  const handlePickLine = useCallback((sel: LineSelection): PickResult => {
    const cur = selectedLinesRef.current;

    const idx = cur.findIndex(
      (x) => x.operator === sel.operator && x.line === sel.line
    );

    // Linjen är redan vald -> blockera + visa tydlig feedback
    if (idx !== -1) {
      setSelectedClickKey(`${sel.operator}-${sel.line}`);
      showHint("Linjen är redan vald. Rensa den i sidopanelen.", "error");

      window.setTimeout(() => {
        setSelectedClickKey((curKey) =>
          curKey === `${sel.operator}-${sel.line}` ? null : curKey
        );
      }, 1600);

      return "blocked";
    }

    const slot = nextFreeSlot(cur);

    if (slot === null) {
      showHint("Max antal linjeval (3). Rensa en linje för att välja ny.", "error");
      return "blocked";
    }

    setSlotSelection(slot, sel);
    return "picked";

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- RT-statuscheck (alla operatörer) ----------
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function fetchRtStatus() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/realtime/status`);
        if (!res.ok) throw new Error(`realtime/status failed: ${res.status}`);

        const data = (await res.json()) as RtStatusResponse;

        const badOps: { op: Operator; reason?: string }[] = [];
        for (const [op, v] of Object.entries(data)) {
          if (!v?.ok) badOps.push({ op: backendOpToUi(op), reason: v.reason ?? undefined });
        }

        if (cancelled) return;

        if (badOps.length === 0) {
          setRtWarning(null);
          return;
        }

        const ops = badOps.map((x) => x.op);
        const opsText = formatOpListSw(ops);
        const plural = ops.length > 1;

        setRtWarning(
          `Störning i realtidsdata från ${opsText}. ` +
            `Fordon för ${plural ? "dessa operatörer" : "denna operatör"} kan ej visas.`
        );
      } catch (e) {
        console.error(e);
        if (!cancelled) setRtWarning("Kunde inte kontrollera realtidsstatus just nu.");
      }
    }

    fetchRtStatus();
    timer = window.setInterval(fetchRtStatus, 60000);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, []);

  // ---------- Fetch lines list ----------
  async function fetchLinesForOperator(op: Operator): Promise<LineItem[]> {
    const code = uiOpToBackend(op);
    const res = await fetch(`${API_BASE_URL}/api/lines?operator=${code}`);
    if (!res.ok) throw new Error(`lines ${code} failed: ${res.status}`);

    const data = (await res.json()) as { line: string }[];
    return data.map((d) => ({ operator: op, line: d.line }));
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (enabledOperators.length === 0) {
          if (!cancelled) setLineResults([]);
          return;
        }
        const all = await Promise.all(enabledOperators.map(fetchLinesForOperator));
        const merged = all.flat();
        if (!cancelled) setLineResults(merged);
      } catch (e) {
        console.error(e);
        if (!cancelled) setLineResults([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabledOperators]);

  const filteredLineResults = useMemo(() => {
  const q = lineQuery.trim().toLowerCase();
  if (!q) return []; // 👈 visa inget förrän användaren skriver
  return lineResults
    .filter((x) => x.line.toLowerCase().includes(q))
    .slice(0, 50);
}, [lineQuery, lineResults]);

  useEffect(() => {
    return () => {
      if (uiHintTimerRef.current !== null) {
        window.clearTimeout(uiHintTimerRef.current);
      }
    };
  }, []);

  // ---------- Fetch stops search ----------
  async function fetchStopsSearch(op: Operator, q: string): Promise<StopItem[]> {
    const code = uiOpToBackend(op);
    const qs = new URLSearchParams({ operator: code, q });

    const res = await fetch(`${API_BASE_URL}/api/stops/search?${qs.toString()}`);
    if (!res.ok) throw new Error(`stops search ${code} failed: ${res.status}`);

    const data = (await res.json()) as { stop_id: string; name: string; lat: number; lon: number }[];
    return data.map((d) => ({ operator: op, ...d }));
  }

  useEffect(() => {
    if (searchMode !== "stop") return;
    if (enabledOperators.length === 0) return;

    const q = lineQuery.trim();
    if (q.length < 2) {
      setStopResults([]);
      return;
    }

    let cancelled = false;
    setStopLoading(true);

    (async () => {
      try {
        const all = await Promise.all(enabledOperators.map((op) => fetchStopsSearch(op, q)));
        const merged = all.flat();
        if (!cancelled) setStopResults(merged.slice(0, 50));
      } catch (e) {
        console.error(e);
        if (!cancelled) setStopResults([]);
      } finally {
        if (!cancelled) setStopLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchMode, lineQuery, enabledOperators]);

  // ---------- Click outside dock ----------
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      const el = searchDockRef.current;
      if (!el) return;

      if (!el.contains(e.target as Node)) {
        setIsResultsOpen(false);
        setIsSearchFocused(false);
        // ✅ När man stänger listan: rensa inline hint
        setSelectedClickKey(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    // Rensa söktext när man byter mellan "line" och "stop"
    setLineQuery("");

    // (valfritt men bra) rensa resultat/hints så UI känns “rent”
    setStopResults([]);
    setSelectedClickKey(null);
    setUiHint(null);

    // om du vill: stäng resultatpanelen när man byter läge
    setIsResultsOpen(false);
    setIsSearchFocused(false);
  }, [searchMode]);

  // ---------- MapMode auto ----------
  useEffect(() => {
    // ✅ Om användaren är i ett browse-läge: låt det vara
    if (mapMode === "browse-lines" || mapMode === "browse-stops") {
      return;
    }

    // ✅ Focused stop vinner (så länge vi inte är i browse-läge)
    if (focusedStop) {
      setMapMode("focus-stop");
      return;
    }

    // ✅ Valda linjer -> focus-selected
    if (selectedLines.length > 0) {
      setMapMode("focus-selected");
      return;
    }

    // ✅ Inget valt -> default browse beroende på sökläge
    setMapMode(searchMode === "stop" ? "browse-stops" : "browse-lines");
  }, [selectedLines.length, searchMode, focusedStop, mapMode]);

  // ---------- UI labels ----------
  const selectedCount = selectedLines.length as 0 | 1 | 2 | 3;

  const bottomLabel =
    maxLinesReached
      ? "Max tre linjeval"
      : searchMode === "stop"
        ? "Välj hållplats"
        : selectedCount === 0
          ? "Välj linje"
          : selectedCount === 1
            ? "Välj anslutande linje"
            : "Välj ytterligare anslutande linje";

  const bottomSlotClass =
    searchMode === "stop" ? "slotStop" : selectedCount === 0 ? "slot0" : selectedCount === 1 ? "slot1" : "slot2";

  const activeSlotColorClass =
    selectedOperator === null
      ? ""
      : searchMode === "stop"
        ? "slotStop"
        : `slot${Math.min(selectedCount, 2)}`;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebarFixedTop">
          <div className="brandBlock">
            <h1 className="title">Pendlarkartan</h1>
            <div className="appVersion">v{APP_VERSION}</div>
          </div>
          <div className="sidebarDivider" />
        </div>

        <div className="sidebarMiddle">
          {selectedLines[0] && (
            <div className="section">
              <div className="label uiSectionTitle">Valda linjer</div>
              <button type="button" className="slotBtn slot0" onClick={() => clearSlot(0)} title="Klicka för att rensa">
                {selectedLines[0].operator} • Linje {selectedLines[0].line} (klicka för att rensa)
              </button>
            </div>
          )}

          {selectedLines[1] && (
            <div className="section">
              <button type="button" className="slotBtn slot1" onClick={() => clearSlot(1)} title="Klicka för att rensa">
                {selectedLines[1].operator} • Linje {selectedLines[1].line} (klicka för att rensa)
              </button>
            </div>
          )}

          {selectedLines[2] && (
            <div className="section">
              <button type="button" className="slotBtn slot2" onClick={() => clearSlot(2)} title="Klicka för att rensa">
                {selectedLines[2].operator} • Linje {selectedLines[2].line} (klicka för att rensa)
              </button>
            </div>
          )}
        </div>

        <div className="section">
          <label className="label uiSectionTitle">Operatör</label>
          <div className="operatorRow">
            <label>
              <input
                type="radio"
                name="operator"
                disabled={selectedOperator === null}
                checked={selectedOperator === "SL"}
                onChange={() => setSelectedOperator("SL")}
              />{" "}
              SL
            </label>
            <label>
              <input
                type="radio"
                name="operator"
                disabled={selectedOperator === null}
                checked={selectedOperator === "UL"}
                onChange={() => setSelectedOperator("UL")}
              />{" "}
              UL
            </label>
            <label>
              <input
                type="radio"
                name="operator"
                disabled={selectedOperator === null}
                checked={selectedOperator === "X-trafik"}
                onChange={() => setSelectedOperator("X-trafik")}
              />{" "}
              X-trafik
            </label>
          </div>
        </div>

        <div className="sidebarPicker">
          <button
            type="button"
            className={`pickerMainBtn ${bottomSlotClass} ${maxLinesReached ? "maxReached" : ""} ${
              maxPulse ? "pulse" : ""
            }`}
            disabled={selectedOperator === null || maxLinesReached}
            onClick={() => {
              if (selectedOperator === null) return;
              if (maxLinesReached) return; // ✅ lås även i hållplatsläge

              if (searchMode === "stop") {
                setMapMode("browse-stops");
                setFocusedStop(null);
              } else {
                setMapMode("browse-lines");
                setFocusedStop(null);
              }

              setIsDockOpen(true);
              setIsResultsOpen(false);
              setIsSearchFocused(true);
            }}
          >
            {selectedOperator !== null ? bottomLabel : "Välj operatör först"}
          </button>

          <div className="pickerModeRow">
            <button
              type="button"
              className={`uiPill searchModeBtn ${searchMode === "line" ? "active" : ""}`}
              disabled={selectedOperator === null}
              onClick={() => {
                if (selectedOperator === null) return;

                setSearchMode("line");
                setFocusedStop(null);
                setMapMode("browse-lines");

                setIsDockOpen(true);
                setIsResultsOpen(false);
                setIsSearchFocused(true);
                setSelectedClickKey(null);
              }}
            >
              Linje
            </button>

            <button
              type="button"
              className={`uiPill searchModeBtn ${searchMode === "stop" ? "active" : ""}`}
              disabled={selectedOperator === null}
              onClick={() => {
                if (selectedOperator === null) return;

                setSearchMode("stop");
                setFocusedStop(null);
                setMapMode("browse-stops");

                setIsDockOpen(true);
                setIsResultsOpen(false);
                setIsSearchFocused(true);
                setSelectedClickKey(null);
              }}
            >
              Hållplats
            </button>
          </div>
        </div>
      </aside>

      <main className={`mapArea ${activeSlotColorClass} ${maxLinesReached ? "mapNoBorder" : ""}`}>
        {rtWarning ? <div className="rtWarningBanner">{rtWarning}</div> : null}

        {lineRtWarning ? (
          <div className="rtWarningBanner" style={{ top: rtWarning ? 64 : 12 }}>
            {lineRtWarning}
          </div>
        ) : null}

        {uiHint ? (
          <div className={`mapToast ${uiHint.variant === "error" ? "mapToastError" : ""}`}>
            {uiHint.text}
          </div>
        ) : null}

        {/* ✅ On-load overlay: Välj operatör */}
        {selectedOperator === null ? (
          <div className="operatorOverlay">
            <div className="operatorOverlayCard">
              <div className="operatorOverlayTitle">Välj operatör</div>
              <div className="operatorOverlayButtons">
                <button
                  type="button"
                  className="uiPill operatorOverlayBtn"
                  onClick={() => {
                    setSelectedOperator("SL");
                    setMapMode("browse-lines");
                    triggerPickerPulse();
                  }}
                >
                  SL
                </button>
                <button
                  type="button"
                  className="uiPill operatorOverlayBtn"
                  onClick={() => {
                    setSelectedOperator("UL");
                    setMapMode("browse-lines");
                    triggerPickerPulse();
                  }}
                >
                  UL
                </button>
                <button
                  type="button"
                  className="uiPill operatorOverlayBtn"
                  onClick={() => {
                    setSelectedOperator("X-trafik");
                    setMapMode("browse-lines");
                    triggerPickerPulse();
                  }}
                >
                  X-trafik
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div ref={searchDockRef} className={`searchDock ${isDockOpen ? "open" : ""} ${isResultsOpen ? "results" : ""} dockMounted`}>
          <div className="searchResultsPanel">
            <div className="searchResultsHeader">
              {isSearchFocused ? (
                <>
                  <div className="label uiSectionTitle">Resultat</div>
                  {searchMode === "stop" && stopLoading ? <div className="hint">Söker...</div> : null}
                </>
              ) : null}
            </div>

            <div className="searchResultsList">
              {searchMode === "line" ? (
                filteredLineResults.map((item) => {
                  const sel = { operator: item.operator, line: item.line };
                  const isSelected = selectedLines.some((x) => x.operator === sel.operator && x.line === sel.line);

                  const rowKey = `${item.operator}-${item.line}`;
                  const showInline = isSelected && selectedClickKey === rowKey;

                  return (
                    <button
                      key={rowKey}
                      type="button"
                      className={`listItem ${isSelected ? "listItemSelected" : ""}`}
                      onClick={() => {
                        if (isSelected) {
                          setSelectedClickKey(rowKey);
                          window.setTimeout(() => {
                            setSelectedClickKey((cur) => (cur === rowKey ? null : cur));
                          }, 1600);
                          return;
                        }

                        if (maxLinesReached) {
                          showHint("Max antal linjeval (3). Rensa en linje för att välja ny.");
                          return;
                        }

                        setSelectedClickKey(null);
                        handlePickLine(sel);
                        afterSuccessfulPick();
                      }}
                      title={isSelected ? "Linjen redan vald (rensa i sidopanelen)" : "Klicka för att välja linje"}
                    >
                      <div>
                        {item.operator} • Linje {item.line}
                        {isSelected ? " ✓" : ""}
                      </div>

                      {showInline ? <div className="inlineHintError">Linjen är redan vald. Rensa den i sidopanelen.</div> : null}
                    </button>
                  );
                })
              ) : (
                stopResults.map((s) => (
                  <button
                    key={`${s.operator}-${s.stop_id}`}
                    type="button"
                    className="listItem"
                    onClick={() => {
                      // 👇 Detta gör att MapView triggar stopbrowse:open-parent (via effekten)
                      setFocusedStop(s);
                      setMapMode("browse-stops");

                      // UI-stängning (som du redan har)
                      setIsResultsOpen(false);
                      setIsSearchFocused(false);
                      setSelectedClickKey(null);
                    }}
                    title="Klicka för att välja hållplats"
                  >
                    {s.operator} • {s.name}
                    <div style={{ fontSize: 12, opacity: 0.75 }}>{s.stop_id}</div>
                  </button>
                ))
              )}

              {searchMode === "stop" && !stopLoading && stopResults.length === 0 && lineQuery.trim().length >= 2 ? (
                <div className="hint">Inga hållplatser hittades.</div>
              ) : null}

              {uiHint ? (
                <div className={`hint uiHint ${uiHint.variant === "error" ? "uiHintError" : ""}`}>
                  {uiHint.text}
                </div>
              ) : null}
            </div>
          </div>

          <div className="searchCard">
            <div className="searchBar">
              {/* Linje */}
              <button
                type="button"
                className={`uiPill searchModeBtn ${searchMode === "line" ? "active" : ""} ${
                  maxLinesReached ? "disabledBtn" : ""
                }`}
                disabled={selectedOperator === null || (maxLinesReached && searchMode === "line")}
                onClick={() => {
                  if (selectedOperator === null) return;

                  setSearchMode("line");
                  setLineQuery("");
                  setStopResults([]);
                  setStopLoading(false);

                  setFocusedStop(null);
                  setMapMode("browse-lines");

                  setIsDockOpen(true);
                  setIsResultsOpen(false);
                  setIsSearchFocused(true);
                  setSelectedClickKey(null);
                }}
                title="Sök linje"
              >
                Linje
              </button>

              <input
                className="searchInput"
                disabled={selectedOperator === null || (maxLinesReached && searchMode === "line")}
                placeholder={
                  selectedOperator === null
                    ? "Välj operatör först"
                    : maxLinesReached && searchMode === "line"
                    ? "Max antal linjeval"
                    : searchMode === "line"
                    ? "Sök linje (t.ex. 4, 6, 101...)"
                    : "Sök hållplats (minst 2 tecken)"
                }
                value={lineQuery}
                onChange={(e) => setLineQuery(e.target.value)}
                onFocus={() => {
                  if (selectedOperator === null) return;
                  if (!isDockOpen) setIsDockOpen(true);
                  setIsResultsOpen(true);
                  setIsSearchFocused(true);
                }}
              />

              {/* Hållplats */}
              <button
                type="button"
                className={`uiPill searchModeBtn ${searchMode === "stop" ? "active" : ""}`}
                disabled={selectedOperator === null}
                onClick={() => {
                  if (selectedOperator === null) return;

                  setSearchMode("stop");
                  setLineQuery("");
                  setStopResults([]);
                  setStopLoading(false);

                  setFocusedStop(null);
                  setMapMode("browse-stops");

                  setIsDockOpen(true);
                  setIsResultsOpen(false);
                  setIsSearchFocused(true);
                  setSelectedClickKey(null);
                }}
                title="Sök hållplats"
              >
                Hållplats
              </button>
            </div>

            <div className="searchOperatorsInCard" role="radiogroup" aria-label="Operatör">
              <label className={`uiPill opPill ${selectedOperator === "SL" ? "active" : ""} ${selectedOperator === null ? "disabledBtn" : ""}`}>
                <input
                  type="radio"
                  name="operatorDock"
                  disabled={selectedOperator === null}
                  checked={selectedOperator === "SL"}
                  onChange={() => setSelectedOperator("SL")}
                />
                SL
              </label>

              <label className={`uiPill opPill ${selectedOperator === "UL" ? "active" : ""} ${selectedOperator === null ? "disabledBtn" : ""}`}>
                <input
                  type="radio"
                  name="operatorDock"
                  disabled={selectedOperator === null}
                  checked={selectedOperator === "UL"}
                  onChange={() => setSelectedOperator("UL")}
                />
                UL
              </label>

              <label className={`uiPill opPill ${selectedOperator === "X-trafik" ? "active" : ""} ${selectedOperator === null ? "disabledBtn" : ""}`}>
                <input
                  type="radio"
                  name="operatorDock"
                  disabled={selectedOperator === null}
                  checked={selectedOperator === "X-trafik"}
                  onChange={() => setSelectedOperator("X-trafik")}
                />
                X-trafik
              </label>
            </div>
          </div>
        </div>

        <MapView
          styleUrl={import.meta.env.VITE_MAPTILER_STYLE_URL}
          enabledOperators={enabledOperators}
          selectedLines={selectedLines}
          mapMode={mapMode}
          focusedStop={focusedStop}
          onCloseFocusedStop={() => {
            setFocusedStop(null);
            setMapMode("browse-stops");
          }}
          onPickLine={(sel) => {
            const res = handlePickLine(sel);

            // ✅ Stäng searchDock/searchbar när man VALT en linje via kartan
            if (res === "picked") {
              afterSuccessfulPick();
            }
          }}
          onFocusStop={(stop) => {
            setFocusedStop(stop);
            setMapMode("focus-stop");
          }}
          fitSlot={fitSlot}
          fitNonce={fitNonce}
          onVehicleRealtimeWarningChange={setLineRtWarning}
        />
      </main>
    </div>
  );
}