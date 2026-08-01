import type { Locale } from "./i18n";

/**
 * Shared vocabulary — the words that appear on more than one screen.
 *
 * Page prose lives next to its page; this file holds only the terms that must
 * read identically everywhere, because a booking that is "مؤكد" on one screen
 * and "Confirmed" on the next in the same language is how people stop
 * believing the status.
 *
 * Two judgement calls worth stating.
 *
 * Place names are transliterated, not translated: Janzour, Tajoura, Ain Zara.
 * An English-reading user still has to say the name to a taxi driver, and
 * "Airport Road" is the exception only because that is what people actually
 * call it in English too.
 *
 * «استراحة» has no English equivalent. It is not a villa, not a rental, not a
 * guest house — it is a walled day-and-night place a family takes for
 * themselves, and the privacy is the point. So English keeps the word,
 * "estiraha", the way English kept "riad". Translating it away would lose the
 * category.
 */

type Vocab = Record<string, string>;

export const CITIES: Record<Locale, Vocab> = {
  ar: { tripoli: "طرابلس", misrata: "مصراتة", benghazi: "بنغازي" },
  en: { tripoli: "Tripoli", misrata: "Misrata", benghazi: "Benghazi" },
};

export const AREAS: Record<Locale, Vocab> = {
  ar: {
    janzour: "جنزور",
    tajoura: "تاجوراء",
    ain_zara: "عين زارة",
    airport_road: "طريق المطار",
  },
  en: {
    janzour: "Janzour",
    tajoura: "Tajoura",
    ain_zara: "Ain Zara",
    airport_road: "Airport Road",
  },
};

export const VERTICALS: Record<Locale, Vocab> = {
  ar: { coast: "شاليهات واستراحات", hall: "قاعات أفراح", service: "خدمات" },
  en: { coast: "Chalets & estirahas", hall: "Wedding halls", service: "Services" },
};

export const SERVICE_CATEGORY_LABELS: Record<Locale, Vocab> = {
  ar: {
    catering: "ضيافة وبوفيهات",
    photography: "تصوير",
    makeup: "ميكب",
    hair: "كوافير",
    cakes: "كيك وحلويات",
    gym: "جيم ولياقة",
  },
  en: {
    catering: "Catering & buffets",
    photography: "Photography",
    makeup: "Makeup",
    hair: "Hair styling",
    cakes: "Cakes & sweets",
    gym: "Gym & fitness",
  },
};

/** Amenity truth-table keys (§8.5) — stays, halls and services. */
export const AMENITIES: Record<Locale, Vocab> = {
  ar: {
    generator: "مولّد كهرباء",
    water_tank: "خزان مياه",
    pool: "مسبح",
    bride_suite: "جناح العروس",
    prayer_space: "مصلّى",
    parking: "موقف سيارات",
    kosha: "كوشة",
    tasting: "تذوق قبل التعاقد",
    delivery_setup: "توصيل وتجهيز",
    service_staff: "طاقم خدمة",
    menu_fixed: "قائمة وأسعار مكتوبة",
    photo_video: "تصوير فوتو وفيديو",
    female_staff: "طاقم نسائي",
    printed_album: "ألبوم مطبوع",
    delivery_time: "مدة التسليم",
    trial: "تجربة قبل الموعد",
    home_visit: "خدمة في البيت",
    original_products: "منتجات أصلية",
    female_only: "نسائي بالكامل",
    bridal: "تسريحات عرايس",
    appointment: "بالموعد فقط",
    privacy: "خصوصية تامة",
    female_hours: "أوقات نسائية",
    female_trainer: "مدربة سيدة",
    equipment: "أجهزة حديثة",
    membership: "اشتراكات",
    tiered_cake: "كيك متعدد الطوابق",
    custom_design: "تصميم حسب الطلب",
  },
  en: {
    generator: "Backup generator",
    water_tank: "Water tank",
    pool: "Pool",
    bride_suite: "Bridal suite",
    prayer_space: "Prayer room",
    parking: "Parking",
    kosha: "Kosha (bridal stage)",
    tasting: "Tasting before you commit",
    delivery_setup: "Delivery and setup",
    service_staff: "Service staff",
    menu_fixed: "Written menu and prices",
    photo_video: "Photo and video",
    female_staff: "Female staff",
    printed_album: "Printed album",
    delivery_time: "Delivery time",
    trial: "Trial before the day",
    home_visit: "Comes to your home",
    original_products: "Genuine products",
    female_only: "Women only",
    bridal: "Bridal styling",
    appointment: "By appointment only",
    privacy: "Full privacy",
    female_hours: "Women's hours",
    female_trainer: "Female trainer",
    equipment: "Modern equipment",
    membership: "Memberships",
    tiered_cake: "Tiered cake",
    custom_design: "Made to order",
  },
};

/** Listing lifecycle, as shown in the business console. */
export const LISTING_STATUS: Record<Locale, Vocab> = {
  ar: { draft: "مسودة", live: "منشور", paused: "موقوف مؤقتًا", delisted: "مسحوب" },
  en: { draft: "Draft", live: "Live", paused: "Paused", delisted: "Delisted" },
};

export const ROLES: Record<Locale, Vocab> = {
  ar: {
    guest: "ضيف",
    host: "مضيف",
    agent: "مندوب ميداني",
    ops: "عمليات",
    admin: "مدير",
  },
  en: {
    guest: "Guest",
    host: "Host",
    agent: "Field agent",
    ops: "Operations",
    admin: "Admin",
  },
};

/** Ledger accounts, as shown in the finance screens. */
export const LEDGER_ACCOUNTS: Record<Locale, Vocab> = {
  ar: {
    platform_revenue: "إيرادات تشاو",
    guest_deposits_held: "عرابين محتجزة",
    host_payables: "مستحقات المضيفين",
    guest_credit: "رصيد الضيوف",
    refund_reserve: "احتياطي الاسترجاع",
  },
  en: {
    platform_revenue: "Ciao revenue",
    guest_deposits_held: "Deposits held",
    host_payables: "Host payables",
    guest_credit: "Guest credit",
    refund_reserve: "Refund reserve",
  },
};

/** Small words that recur on every screen. */
export const UI: Record<Locale, Vocab> = {
  ar: {
    back: "رجوع",
    save: "حفظ",
    cancel: "إلغاء",
    close: "إغلاق",
    loading: "جارٍ التحميل…",
    retry: "أعد المحاولة",
    search: "ابحث",
    seeAll: "عرض الكل ←",
    none: "لا يوجد",
    noData: "لا بيانات بعد",
    signIn: "دخول",
    signOut: "خروج",
    about: "من نحن",
    account: "حسابي",
    hosts: "للمضيفين",
    wishlist: "المفضلة",
    perNight: "/ ليلة",
    onRequest: "حسب الطلب",
  },
  en: {
    back: "Back",
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    loading: "Loading…",
    retry: "Try again",
    search: "Search",
    seeAll: "See all →",
    none: "None",
    noData: "Nothing yet",
    signIn: "Sign in",
    signOut: "Sign out",
    about: "About",
    account: "Account",
    hosts: "For hosts",
    wishlist: "Saved",
    perNight: "/ night",
    onRequest: "On request",
  },
};

/** Look a key up, falling back to the key itself rather than to blank. */
export function term(map: Record<Locale, Vocab>, locale: Locale, key: string | undefined): string {
  if (!key) return "";
  return map[locale][key] ?? map.ar[key] ?? key;
}

/** A place, the way it is spoken: "Tajoura · Tripoli". */
export function placeLabel(
  locale: Locale,
  city: string | undefined,
  area: string | undefined,
): string {
  const parts = [term(AREAS, locale, area), term(CITIES, locale, city)].filter(Boolean);
  return parts.join(" · ");
}

/** Dates, in the reader's calendar conventions. */
export function fmtDate(
  locale: Locale,
  value: string | Date,
  opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" },
): string {
  const d = typeof value === "string" ? new Date(value) : value;
  // Western digits in Arabic for the same reason as money: a date that renders
  // in Arabic-Indic on one phone and Western on another looks like a bug.
  return d.toLocaleDateString(locale === "en" ? "en-GB" : "ar-LY-u-nu-latn", opts);
}

/** Numbers, same reasoning. */
export function fmtNum(locale: Locale, n: number, opts: Intl.NumberFormatOptions = {}): string {
  return n.toLocaleString(locale === "en" ? "en-GB" : "ar-LY-u-nu-latn", opts);
}
