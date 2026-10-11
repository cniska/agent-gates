const MARKER_LINE = /^(?:#|\/\/) agent-gate:([a-z-]+):(\d+)$/;

export type MarkerLine = { readonly part: string; readonly version: number };

export function markerLine(line: string): MarkerLine | null {
  const found = MARKER_LINE.exec(line);
  const part = found?.[1];
  const version = found?.[2];
  if (part === undefined || version === undefined) return null;
  return { part, version: Number(version) };
}

export function firstMarkerLine(text: string): MarkerLine | null {
  for (const line of text.split("\n")) {
    const marker = markerLine(line);
    if (marker !== null) return marker;
  }
  return null;
}
