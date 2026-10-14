const MARKER_BODY = " ([a-z]+)-gate:(?:([a-z-]+):)?(\\d+)";

const MARKER_LINE = new RegExp(`^(?:#|//)${MARKER_BODY}$`);

const MARKER_COMMENT_BODY = new RegExp(`^${MARKER_BODY}$`);

export function isMarkerBody(body: string): boolean {
  return MARKER_COMMENT_BODY.test(body);
}

const OURS = "agent";

type MarkerLine = { readonly tool: string; readonly part: string | null; readonly version: number };

type OurMarker = { readonly part: string; readonly version: number };

export function markerLine(line: string): MarkerLine | null {
  const found = MARKER_LINE.exec(line);
  if (found === null) return null;
  const [, tool, part, version] = found;
  if (tool === undefined || version === undefined) return null;
  return { tool, part: part ?? null, version: Number(version) };
}

export function ourMarker(text: string): OurMarker | null {
  for (const line of text.split("\n")) {
    const marker = markerLine(line);
    if (marker?.tool === OURS && marker.part !== null) return { part: marker.part, version: marker.version };
  }
  return null;
}
