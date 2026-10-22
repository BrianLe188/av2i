export interface PortRange {
  from: number;
  to: number;
}

/** Parses "80, 443, 8000-8100" into ranges. Returns null when any entry is malformed. */
export function parsePorts(text: string): PortRange[] | null {
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  const out: PortRange[] = [];
  for (const part of parts) {
    const m = /^(\d{1,5})(?:\s*-\s*(\d{1,5}))?$/.exec(part);
    if (!m) return null;
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (from < 1 || to > 65535 || from > to) return null;
    out.push({ from, to });
  }
  return out;
}
