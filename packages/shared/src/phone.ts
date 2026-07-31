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
  if (/^\d{9,15}$/.test(d)) return `+${d}`; // fallback: assume caller included cc
  return d;
}

/** Display an E.164 Libyan number back in the familiar local format. */
export function localPhone(e164: string): string {
  if (e164.startsWith("+2189")) return `0${e164.slice(4)}`;
  return e164;
}

export function isValidPhoneInput(input: string): boolean {
  return /^\+\d{9,15}$/.test(normalizePhone(input));
}
