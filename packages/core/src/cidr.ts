export interface Cidr {
  ip: number;
  prefix: number;
}

export function parseCidr(input: string): Cidr | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(String(input).trim());
  if (!m) return null;
  const octets = m.slice(1, 5).map(Number);
  const prefix = Number(m[5]);
  if (octets.some((o) => o > 255) || prefix > 32) return null;
  const ip = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  return { ip, prefix };
}

function mask(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** Inclusive [start, end] address range of the block. */
export function cidrRange(c: Cidr): [number, number] {
  const start = (c.ip & mask(c.prefix)) >>> 0;
  return [start, start + 2 ** (32 - c.prefix) - 1];
}

export function cidrContains(outer: Cidr, inner: Cidr): boolean {
  const [os, oe] = cidrRange(outer);
  const [is, ie] = cidrRange(inner);
  return is >= os && ie <= oe;
}

export function cidrOverlaps(a: Cidr, b: Cidr): boolean {
  const [as, ae] = cidrRange(a);
  const [bs, be] = cidrRange(b);
  return as <= be && bs <= ae;
}

export function formatCidr(ip: number, prefix: number): string {
  return `${(ip >>> 24) & 255}.${(ip >>> 16) & 255}.${(ip >>> 8) & 255}.${ip & 255}/${prefix}`;
}

/** First /`prefix` block inside `vpcCidr` that doesn't overlap any of `used`. */
export function nextSubnetCidr(vpcCidr: string, used: string[], prefix = 24): string | null {
  const vpc = parseCidr(vpcCidr);
  if (!vpc || vpc.prefix > prefix) return null;
  const usedBlocks = used.map(parseCidr).filter((c): c is Cidr => c !== null);
  const [start, end] = cidrRange(vpc);
  const step = 2 ** (32 - prefix);
  for (let ip = start; ip + step - 1 <= end; ip += step) {
    const candidate = { ip, prefix };
    if (!usedBlocks.some((u) => cidrOverlaps(candidate, u))) return formatCidr(ip, prefix);
  }
  return null;
}
