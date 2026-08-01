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
  ar: {
    tripoli: "طرابلس",
    misrata: "مصراتة",
    benghazi: "بنغازي",
    zawiya: "الزاوية",
    khoms: "الخمس",
  },
  en: {
    tripoli: "Tripoli",
    misrata: "Misrata",
    benghazi: "Benghazi",
    zawiya: "Zawiya",
    khoms: "Khoms",
  },
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

/**
 * The dimensions a guest scores after a stay (§8.8).
 *
 * «الستر» is scored together with privacy because that is how guests talk about
 * it — whether the walls, the pool and the approach let the women in the party
 * relax. English says "privacy and screening"; it is a description of the
 * place, never a judgement about the guests.
 */
export const REVIEW_DIMENSIONS: Record<Locale, Vocab> = {
  ar: {
    cleanliness: "النظافة",
    accuracy: "المطابقة",
    privacy: "الخصوصية والستر",
    communication: "التواصل",
    value: "القيمة",
  },
  en: {
    cleanliness: "Cleanliness",
    accuracy: "As described",
    privacy: "Privacy and screening",
    communication: "Communication",
    value: "Value",
  },
};

/**
 * Payment rails, as the guest picks them at checkout.
 *
 * The bank and scheme names are proper nouns and stay as they are in both
 * languages — someone paying with سداد is looking for the word "Sadad" on
 * their phone either way — with the operator named in brackets, because in
 * Libya which bank runs the rail is what tells you whether it will work today.
 */
export const PAYMENT_RAILS: Record<Locale, Vocab> = {
  ar: {
    sadad: "سداد (المدار)",
    adfali: "إدفعلي (مصرف التجارة والتنمية)",
    local_card: "بطاقة مصرفية محلية",
    tlync: "تطبيقات المصارف (T-Lync)",
    mpgs: "Visa / Mastercard دولية",
    cash: "نقدًا عند الوصول",
  },
  en: {
    sadad: "Sadad (Almadar)",
    adfali: "Adfali (Bank of Commerce & Development)",
    local_card: "Local bank card",
    tlync: "Bank apps (T-Lync)",
    mpgs: "Visa / Mastercard international",
    cash: "Cash on arrival",
  },
};

/**
 * Booking states, in the guest's words.
 *
 * These live here rather than beside the tracker because the same state is
 * shown on «حجوزاتي», at the top of the booking page and again in its timeline,
 * and a booking that is "مؤكد" in one place and something else two screens
 * later reads like two different bookings. Each label says what happened to the
 * person whose money is involved, not what the state machine calls itself.
 *
 * The refund promises in these strings are the product's actual rules, so the
 * English says exactly what the Arabic says: a full refund is a full refund,
 * and the goodwill payment on a host timeout is 5%.
 */
export const BOOKING_STATUS: Record<Locale, Vocab> = {
  ar: {
    payment_pending: "بانتظار دفع العربون",
    payment_held: "العربون مدفوع — بانتظار تأكيد المضيف",
    confirmed: "✅ الحجز مؤكد",
    pre_arrival_reconfirmed: "✅ مؤكد — والمكان جاهز",
    checked_in: "🏖 إقامة جارية",
    completed: "اكتملت الإقامة — قيّم تجربتك",
    reviewed: "شكرًا على تقييمك!",
    host_declined: "اعتذر المضيف — العربون راجع كاملًا",
    host_timeout: "انتهت مهلة المضيف — العربون راجع + هدية ٥٪",
    payment_failed: "لم يكتمل الدفع",
    cancelled_by_guest: "ألغيتَ الحجز",
    cancelled_by_host: "ألغى المضيف — تعويض كامل + رصيد",
    expired: "انتهت صلاحية الطلب",
  },
  en: {
    payment_pending: "Waiting for your deposit",
    payment_held: "Deposit paid — waiting for the host to confirm",
    confirmed: "✅ Booking confirmed",
    pre_arrival_reconfirmed: "✅ Confirmed — and the place is ready",
    checked_in: "🏖 Stay in progress",
    completed: "Stay finished — rate your experience",
    reviewed: "Thanks for your review!",
    host_declined: "The host said no — your deposit comes back in full",
    host_timeout: "The host ran out of time — full refund plus a 5% gift",
    payment_failed: "The payment did not go through",
    cancelled_by_guest: "You cancelled this booking",
    cancelled_by_host: "The host cancelled — full compensation plus credit",
    expired: "The request expired",
  },
};

/** The line under a state, where the guest is owed an explanation. */
export const BOOKING_STATUS_HINT: Record<Locale, Vocab> = {
  ar: {
    payment_pending: "حجزك محجوز مؤقتًا — أكمل الدفع لقفل التاريخ.",
    payment_held:
      "أرسلنا للمضيف واتساب و SMS. لو ما ردّش في المهلة، عربونك يرجع كاملًا فورًا.",
  },
  en: {
    payment_pending: "Your dates are held for now — pay the deposit to lock them in.",
    payment_held:
      "We have sent the host a WhatsApp message and an SMS. If they do not answer in time, your deposit comes back in full, straight away.",
  },
};

/** The colour a state is shown in — one map, because a refund is not more
 *  alarming in English than it is in Arabic. */
export const BOOKING_STATUS_TONE: Record<string, string> = {
  payment_pending: "bg-amber/20 text-link",
  payment_held: "bg-sea/10 text-sea",
  confirmed: "badge-success",
  pre_arrival_reconfirmed: "badge-success",
  checked_in: "bg-sea/10 text-sea",
  completed: "bg-sand text-sea",
  reviewed: "bg-sand text-sea",
  host_declined: "badge-danger",
  host_timeout: "badge-danger",
  payment_failed: "badge-danger",
  cancelled_by_guest: "bg-sand text-muted",
  cancelled_by_host: "badge-danger",
  expired: "bg-sand text-muted",
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

/**
 * A ledger account as an operator should read it.
 *
 * Two account families carry a suffix rather than being fixed keys: money sat
 * with a named payment rail awaiting settlement, and per-guest credit
 * balances. The rail name is an identifier the operator has to be able to
 * quote back to the provider, so it is printed verbatim; the guest id is not
 * useful on a trial balance, so it is dropped.
 */
export function accountLabel(locale: Locale, account: string): string {
  const known = LEDGER_ACCOUNTS[locale][account] ?? LEDGER_ACCOUNTS.ar[account];
  if (known) return known;
  if (account.startsWith("rail_settlement_pending:")) {
    const rail = account.split(":")[1] ?? "";
    return locale === "en" ? `In settlement · ${rail}` : `تحت التسوية · ${rail}`;
  }
  if (account.startsWith("guest_credit:")) return locale === "en" ? "Guest credit" : "رصيد ضيف";
  return account;
}

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

/**
 * A moment — date and time together, for ledger rows, messages and timelines.
 *
 * Separate from `fmtDate` because `toLocaleDateString` refuses a time option,
 * and because these are the places where the exact minute is the point: when
 * the refund landed, when the host replied.
 */
export function fmtDateTime(
  locale: Locale,
  value: string | Date,
  opts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString(locale === "en" ? "en-GB" : "ar-LY-u-nu-latn", opts);
}

/** Numbers, same reasoning. */
export function fmtNum(locale: Locale, n: number, opts: Intl.NumberFormatOptions = {}): string {
  return n.toLocaleString(locale === "en" ? "en-GB" : "ar-LY-u-nu-latn", opts);
}
