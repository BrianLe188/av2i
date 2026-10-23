export interface Cidr {
  /** first address as an unsigned 32-bit integer */
  base: number;
  prefix: number;
}

export function parseCidr(s: unknown): Cidr | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(s);
  if (!m) return null;
  const octets = [m[1], m[2], m[3], m[4]].map(Number);
  const prefix = Number(m[5]);
  if (octets.some((o) => o > 255) || prefix > 32) return null;
  const addr = ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { base: (addr & mask) >>> 0, prefix };
}

export const lastAddress = (c: Cidr): number => (c.base + 2 ** (32 - c.prefix) - 1) >>> 0;

/** `inner` lies inside `outer` (or equals it). */
export const contains = (outer: Cidr, inner: Cidr): boolean =>
  inner.prefix >= outer.prefix && inner.base >= outer.base && lastAddress(inner) <= lastAddress(outer);

export const overlaps = (a: Cidr, b: Cidr): boolean => a.base <= lastAddress(b) && b.base <= lastAddress(a);

export const isIpv6 = (s: unknown): boolean => typeof s === "string" && s.includes(":");
