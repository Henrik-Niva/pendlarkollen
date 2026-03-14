export function harvestPlatformLabel(
  parentName: string,
  childName: string,
  childStopId: string,
  meta?: { platform_code?: string }
) {
  const p = (parentName || "").trim();
  let c = (childName || "").trim();

  const platform = String(meta?.platform_code ?? "").trim();
  if (platform) return `Läge ${platform}`;

  // Om child-namnet börjar med stationsnamnet: skär bort
  if (p && c.toLowerCase().startsWith(p.toLowerCase())) {
    c = c.slice(p.length).trim();
  }

  c = c.replace(/^[-–—,:|/]+/, "").trim();
  if (c && c !== p) return c;

  // Fallback: suffix ur stop_id (OBS: detta är en "hittepå"-fallback)
  const m = String(childStopId).match(/(\d{1,4})\s*$/);
  if (m?.[1]) return `Läge ${parseInt(m[1], 10)}`;

  return childStopId;
}
