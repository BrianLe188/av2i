export const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 256;
const COMMON = new Set(["admin", "administrator", "password", "changeme", "qwerty", "letmein", "123456789012", "adminadminadmin", "passwordpassword"]);

export type PasswordProblem = "too_short" | "too_long" | "same_as_username" | "too_common" | "same_as_old";

/** The rules for a password somebody chooses: at least 12 characters, not the username, not `admin` or another well known one. */
export function checkNewPassword(password: string, username: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "too_short";
  if (password.length > MAX_PASSWORD_LENGTH) return "too_long";
  const lower = password.toLowerCase();
  if (lower === username.toLowerCase()) return "same_as_username";
  if (COMMON.has(lower)) return "too_common";
  return null;
}
