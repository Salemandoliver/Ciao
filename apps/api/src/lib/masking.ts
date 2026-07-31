/**
 * Pre-deposit contact masking (§8.7): phone numbers (incl. Arabic-Indic digits)
 * and URLs are masked in chat until the deposit is paid.
 */

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";

function normalizeDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)));
}

// Libyan numbers: 09x-xxxxxxx local, +2189x international; catch generic runs too.
const PHONE_RE =
  /(\+?\s*2\s*1\s*8|0)\s*9\s*[1-5](?:[\s.\-_]*\d){6,8}|\d(?:[\s.\-_]*\d){8,13}/g;
const URL_RE = /(https?:\/\/|www\.|wa\.me\/|t\.me\/)[^\s]+/gi;

export function maskContacts(text: string): { masked: string; hadContact: boolean } {
  const normalized = normalizeDigits(text);
  let hadContact = false;
  let masked = normalized.replace(PHONE_RE, () => {
    hadContact = true;
    return "[رقم مخفي حتى دفع العربون]";
  });
  masked = masked.replace(URL_RE, () => {
    hadContact = true;
    return "[رابط مخفي]";
  });
  return { masked, hadContact };
}
