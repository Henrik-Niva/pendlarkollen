import type { RouteVariant } from "./fetchRouteVariants";

export function pickBestVariant(
  variants: RouteVariant[],
  line: string
): RouteVariant | null {
  const filtered = variants.filter((v) => v.line === line);

  if (filtered.length === 0) return null;

  // Välj varianten med flest trips som proxy för "huvudvariant"
  return [...filtered].sort((a, b) => b.trip_count - a.trip_count)[0];
}