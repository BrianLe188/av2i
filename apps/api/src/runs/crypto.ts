import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { HttpError } from "../errors.ts";

export interface Sealed {
  keyId: string;
  nonce: Buffer;
  data: Buffer;
}

/** A short name for a key, kept next to what it encrypted so a rotated key can still find the old one. */
export const keyIdOf = (key: Buffer): string => createHash("sha256").update(key).digest("hex").slice(0, 8);

export function requireKey(key: Buffer | undefined): Buffer {
  if (!key) throw new HttpError(503, "state_key_missing", "STATE_ENCRYPTION_KEY is not set on this server, so state cannot be stored. Set it (openssl rand -base64 32) and restart.");
  return key;
}

/** AES-256-GCM with a fresh nonce; the 16-byte tag is appended to the data. */
export function seal(key: Buffer, plain: Buffer): Sealed {
  const nonce = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, nonce);
  const data = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  return { keyId: keyIdOf(key), nonce, data };
}

export function open(key: Buffer, sealed: { keyId: string; nonce: Buffer; data: Buffer }): Buffer {
  if (sealed.keyId !== keyIdOf(key)) throw new HttpError(500, "state_key_mismatch", `This was encrypted with key ${sealed.keyId}, not the key now configured.`);
  const d = createDecipheriv("aes-256-gcm", key, sealed.nonce);
  d.setAuthTag(sealed.data.subarray(sealed.data.length - 16));
  return Buffer.concat([d.update(sealed.data.subarray(0, sealed.data.length - 16)), d.final()]);
}
