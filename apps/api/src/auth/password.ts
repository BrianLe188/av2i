import { randomInt } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

export { checkNewPassword, MIN_PASSWORD_LENGTH, type PasswordProblem } from "@av2i/authz";

// argon2id (the library's default algorithm) with the OWASP minimum cost
const COST = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string): Promise<string> => hash(password, COST);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;
/** Checked when the username does not exist, so that answering takes as long as for a real one. */
export async function burnVerify(password: string): Promise<void> {
  dummy ??= hashPassword("not-a-real-password");
  await verifyPassword(await dummy, password);
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
/** A temporary password for a new or reset account; the person must change it at the first sign in. */
export function temporaryPassword(length = 16): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
