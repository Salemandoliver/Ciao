/**
 * Libyan phone normalization. Users type the familiar local format
 * (09X XXXXXXX — Libyana/Almadar prefixes 091–095); we store E.164 (+2189…).
 * Foreign numbers (diaspora, §5.1 P3) pass through with their country code.
 */

export function normalizePhone(input: string): string {
  const d = input.replace(/[\s\-().]/g, "");
  if (/^\+\d{9,15}$/.test(d)) return d; // already E.164
  if (/^00\d{9,15}$/.test(d)) return `+${d.slice(2)}`; // 00-prefixed international
  if (/^09\d{8}$/.test(d)) return `+218${d.slice(1)}`; // local mobile 09XXXXXXXX
  if (/^9\d{8}$/.test(d)) return `+218${d}`; // local without leading 0
  if (/^218\d{9}$/.test(d)) return `+${d}`; // country code without +
  // Fallback: assume the caller included their country code. A leading zero is
  // excluded deliberately — no country code starts with 0, so "091111111"
  // (a Libyan number one digit short) must fail here rather than quietly
  // becoming "+091111111" and opening an account the owner can never sign
  // back into. A typo should bounce at the keypad, not months later.
  if (/^[1-9]\d{8,14}$/.test(d)) return `+${d}`;
  return d;
}

/** Display an E.164 Libyan number back in the familiar local format. */
export function localPhone(e164: string): string {
  if (e164.startsWith("+2189")) return `0${e164.slice(4)}`;
  return e164;
}

export function isValidPhoneInput(input: string): boolean {
  // E.164 proper: a '+', then a country code that never starts with 0.
  return /^\+[1-9]\d{8,14}$/.test(normalizePhone(input));
}
