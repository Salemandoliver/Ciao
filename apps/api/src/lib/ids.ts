import { randomBytes, randomInt } from "node:crypto";

/** Human/WhatsApp-friendly booking code, e.g. "CIA-7K3M9Q" — unambiguous alphabet. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function bookingCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `CIA-${s}`;
}

export function receiptNo(): string {
  const y = new Date().getUTCFullYear();
  return `RC${y}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export function invoiceNo(bookingCode: string, attempt: number): string {
  return `${bookingCode}-${attempt}-${Date.now()}`;
}

export function otpCode(): string {
  return String(randomInt(100000, 1000000));
}
