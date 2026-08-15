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
    sabratha: "صبراتة",
    zuwara: "زوارة",
    zliten: "زليتن",
    sirte: "سرت",
    tobruk: "طبرق",
    bayda: "البيضاء",
    susah: "سوسة",
  },
  en: {
    tripoli: "Tripoli",
    misrata: "Misrata",
    benghazi: "Benghazi",
    zawiya: "Zawiya",
    khoms: "Khoms",
    sabratha: "Sabratha",
    zuwara: "Zuwara",
    zliten: "Zliten",
    sirte: "Sirte",
    tobruk: "Tobruk",
    bayda: "Bayda",
    susah: "Susah",
  },
};

export const AREAS: Record<Locale, Vocab> = {
  ar: {
    // Tripoli.
    janzour: "جنزور",
    tajoura: "تاجوراء",
    ain_zara: "عين زارة",
    airport_road: "طريق المطار",
    gargaresh: "قرقارش",
    regatta: "ريجاتا",
    // Outside Tripoli. «تليل» is the coastal strip west of Sabratha where the
    // resorts sit; people give it as the address instead of the town.
    talil: "تليل",
    sidi_khalifa: "سيدي خليفة",
    qasr_ahmed: "قصر أحمد",
    // The aggregation's fallback bucket when an event carried neither an area
    // nor a city. A key from the API, labelled here.
    all: "الكل",
  },
  en: {
    janzour: "Janzour",
    tajoura: "Tajoura",
    ain_zara: "Ain Zara",
    airport_road: "Airport Road",
    gargaresh: "Gargaresh",
    regatta: "Regatta",
    talil: "Talil",
    sidi_khalifa: "Sidi Khalifa",
    qasr_ahmed: "Qasr Ahmed",
    all: "All areas",
  },
};

export const VERTICALS: Record<Locale, Vocab> = {
  ar: { coast: "شاليهات واستراحات", hall: "قاعات أفراح", service: "خدمات" },
  en: { coast: "Chalets & estirahas", hall: "Wedding halls", service: "Services" },
};

/**
 * What one bookable unit is, inside a property (`UnitKind` in @ciao/shared).
 *
 * A resort sells several of these from one gate — Lancaster lists chalets, a
 * villa and a duplex suite behind the same facilities — so this is the word
 * that tells a family which thing they are actually paying for. `estiraha`
 * keeps its own name in English for the reason given at the top of this file.
 */
export const UNIT_KINDS_LABEL: Record<Locale, Vocab> = {
  ar: {
    chalet: "شاليه",
    villa: "فيلا",
    estiraha: "استراحة",
    apartment: "شقة",
    room: "غرفة",
    suite: "جناح",
    hall: "قاعة",
    service: "خدمة",
  },
  en: {
    chalet: "Chalet",
    villa: "Villa",
    estiraha: "Estiraha",
    apartment: "Apartment",
    room: "Room",
    suite: "Suite",
    hall: "Hall",
    service: "Service",
  },
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
    // What the property has, shared by every unit behind the same gate.
    beach: "شاطئ خاص",
    kids_pool: "مسبح للأطفال",
    wifi: "إنترنت عالي السرعة",
    security_24h: "أمن وحراسة ٢٤ ساعة",
    restaurant: "مطعم",
    cafe: "كافيه",
    room_service: "خدمة الغرف",
    laundry: "غسيل وكي",
    nursery: "حضانة أطفال",
    barber: "صالون حلاقة",
    meeting_room: "غرفة اجتماعات",
    mini_market: "ميني ماركت",
    // What the unit itself has — the half of the list a family compares two
    // chalets on, once they have already chosen the resort.
    private_pool: "مسبح خاص",
    sea_view: "إطلالة على البحر",
    kitchen: "مطبخ متكامل",
    air_conditioning: "تكييف",
    smart_tv: "تلفزيون ذكي",
    outdoor_seating: "جلسات خارجية",
    garden: "مساحات خضراء",
    bbq: "شواء",
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
    beach: "Private beach",
    kids_pool: "Children's pool",
    wifi: "High-speed internet",
    security_24h: "Security on the gate, 24 hours",
    restaurant: "Restaurant",
    cafe: "Café",
    room_service: "Room service",
    laundry: "Laundry and ironing",
    nursery: "Children's nursery",
    barber: "Barber shop",
    meeting_room: "Meeting room",
    mini_market: "Mini-market on site",
    private_pool: "Private pool",
    sea_view: "Looks out on the sea",
    kitchen: "Full kitchen",
    air_conditioning: "Air conditioning",
    smart_tv: "Smart TV",
    outdoor_seating: "Outdoor seating",
    garden: "Green space",
    bbq: "Barbecue",
  },
};

/**
 * One glyph per amenity, for the same reason as the neighbour glyphs above and
 * with the same rule: nothing newer than Emoji 5, because half this audience is
 * reading it on a phone that ships a 2017 font and a blank box says less than
 * no glyph at all. Not per-locale — a generator is a generator.
 */
export const AMENITY_EMOJI: Record<string, string> = {
  generator: "⚡",
  water_tank: "💧",
  pool: "🏊",
  bride_suite: "👰",
  prayer_space: "🕌",
  parking: "🅿",
  kosha: "💒",
  tasting: "😋",
  delivery_setup: "🚚",
  service_staff: "👥",
  menu_fixed: "📋",
  photo_video: "📸",
  female_staff: "👩",
  printed_album: "📔",
  delivery_time: "⏱",
  trial: "✨",
  home_visit: "🏠",
  original_products: "💯",
  female_only: "🚺",
  bridal: "💇",
  appointment: "📅",
  privacy: "🔒",
  female_hours: "⏰",
  female_trainer: "🏋",
  equipment: "⚙",
  membership: "🎟",
  tiered_cake: "🎂",
  custom_design: "🎨",
  beach: "🏖",
  kids_pool: "👶",
  wifi: "📶",
  security_24h: "🛡",
  restaurant: "🍽",
  cafe: "☕",
  room_service: "🛎",
  laundry: "👕",
  nursery: "🍼",
  barber: "💈",
  meeting_room: "💼",
  mini_market: "🛒",
  private_pool: "🏊",
  sea_view: "🌊",
  kitchen: "🍳",
  air_conditioning: "❄",
  smart_tv: "📺",
  outdoor_seating: "⛱",
  garden: "🌳",
  bbq: "🍖",
};

/**
 * What the nightly rate feeds you (`BoardBasis` in @ciao/shared).
 *
 * This is the difference between a 3,600 villa and a 600 chalet looking like a
 * scandal and looking like two different products, so the label spells the
 * meals out rather than leaving "half board" to be guessed at — the phrase is
 * hotel English, and most of the families reading it have never stayed in one.
 */
export const BOARD: Record<Locale, Vocab> = {
  ar: {
    room_only: "بدون وجبات",
    breakfast: "يشمل الإفطار",
    half_board: "إفطار وعشاء",
    full_board: "إقامة كاملة — إفطار وغداء وعشاء",
  },
  en: {
    room_only: "Room only",
    breakfast: "Breakfast included",
    half_board: "Half board — breakfast and dinner",
    full_board: "Full board — all meals",
  },
};

/**
 * Conditions of entry (`RequirementKey` in @ciao/shared).
 *
 * These are not house rules and they are not a warning label. Each one is a
 * thing that gets a family turned away at a gate in Sabratha at nine at night,
 * so it is written as the guest has to act on it — bring this, expect that —
 * and never as a suspicion about who is asking.
 */
export const REQUIREMENTS: Record<Locale, Vocab> = {
  ar: {
    family_proof: "إثبات الوضع العائلي",
    id_card: "بطاقة شخصية أو جواز",
    marriage_certificate: "عقد الزواج",
    deposit_on_arrival: "تأمين عند الوصول",
    no_single_men: "عائلات فقط",
    no_music_after_hours: "بدون موسيقى بعد وقت محدد",
    no_pets: "بدون حيوانات أليفة",
  },
  en: {
    family_proof: "Proof of family status",
    id_card: "ID or passport",
    marriage_certificate: "Marriage certificate",
    deposit_on_arrival: "Refundable deposit on arrival",
    no_single_men: "Families only",
    no_music_after_hours: "No music after hours",
    no_pets: "No pets",
  },
};

/**
 * What sort of thing a neighbour is — the eleven kinds our agents record.
 *
 * The list is short by design (see the API's `listings/neighbours.ts`): a long
 * form makes a bored agent and a bored agent writes filler. The label is only
 * the bucket; the sentence the agent wrote about the place is what a family
 * actually reads, so nothing here tries to be clever.
 *
 * «منفذ إلى الشاطئ» rather than «شاطئ»: on this coast the question is never
 * whether the sea is there, it is whether there is a way down to it from the
 * property without getting back in the car.
 */
export const NEIGHBOUR_KINDS_LABELS: Record<Locale, Vocab> = {
  ar: {
    supermarket: "سوبرماركت",
    bakery: "مخبزة",
    cafe: "مقهى",
    restaurant: "مطعم",
    pharmacy: "صيدلية",
    clinic: "عيادة",
    mosque: "مسجد",
    petrol: "محطة وقود",
    atm: "صراف آلي",
    beach_access: "نزلة البحر",
    playground: "ملعب أطفال",
  },
  en: {
    supermarket: "Supermarket",
    bakery: "Bakery",
    cafe: "Café",
    restaurant: "Restaurant",
    pharmacy: "Pharmacy",
    clinic: "Clinic",
    mosque: "Mosque",
    petrol: "Petrol station",
    atm: "ATM",
    beach_access: "Way down to the beach",
    playground: "Playground",
  },
};

/**
 * One glyph per kind, so a list of six scans in a glance rather than being
 * read. Not per-locale — a bakery is a bakery in both — and deliberately old
 * emoji: 🛝 (the obvious playground glyph) is Emoji 14 and renders as a blank
 * box on the cheap Android phones a lot of this audience is holding, so the
 * carousel horse does the job instead.
 */
export const NEIGHBOUR_KIND_EMOJI: Record<string, string> = {
  supermarket: "🛒",
  bakery: "🥖",
  cafe: "☕",
  restaurant: "🍽",
  pharmacy: "💊",
  clinic: "🏥",
  mosque: "🕌",
  petrol: "⛽",
  atm: "🏧",
  beach_access: "🏖",
  playground: "🎠",
};

/** The kinds in the order the agent's picker offers them. */
export const NEIGHBOUR_KIND_KEYS = [
  "supermarket",
  "bakery",
  "cafe",
  "restaurant",
  "pharmacy",
  "clinic",
  "mosque",
  "petrol",
  "atm",
  "beach_access",
  "playground",
] as const;

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
    // Where a partner receives money, rather than where a guest pays it.
    bank_app: "تطبيق المصرف",
  },
  en: {
    sadad: "Sadad (Almadar)",
    adfali: "Adfali (Bank of Commerce & Development)",
    local_card: "Local bank card",
    tlync: "Bank apps (T-Lync)",
    mpgs: "Visa / Mastercard international",
    cash: "Cash on arrival",
    bank_app: "Bank app",
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
    finance: "مالية",
    ops: "عمليات",
    admin: "مدير",
  },
  en: {
    guest: "Guest",
    host: "Host",
    agent: "Field agent",
    finance: "Finance",
    ops: "Operations",
    admin: "Admin",
  },
};

/**
 * Partner control-panel vocabulary.
 *
 * Where a job came from. These read as a partner would say them, not as a
 * CRM would: «واتساب» rather than "inbound messaging channel". `ciao` is
 * deliberately named with the brand, because the whole value of this column
 * to a partner is being able to see at a glance how much of their work we
 * actually brought them.
 */
export const JOB_SOURCES: Record<Locale, Vocab> = {
  ar: {
    ciao: "تشاو",
    whatsapp: "واتساب",
    phone: "مكالمة",
    walk_in: "زيارة مباشرة",
    instagram: "إنستقرام",
    facebook: "فيسبوك",
    repeat: "زبون سابق",
    direct: "مباشر",
    other: "غير ذلك",
  },
  en: {
    ciao: "Ciao",
    whatsapp: "WhatsApp",
    phone: "Phone call",
    walk_in: "Walk-in",
    instagram: "Instagram",
    facebook: "Facebook",
    repeat: "Returning client",
    direct: "Direct",
    other: "Other",
  },
};

export const JOB_STATUS: Record<Locale, Vocab> = {
  ar: {
    enquiry: "استفسار",
    quoted: "أُرسل عرض",
    confirmed: "مؤكد",
    done: "تم",
    cancelled: "ملغى",
    no_show: "لم يحضر",
  },
  en: {
    enquiry: "Enquiry",
    quoted: "Quoted",
    confirmed: "Confirmed",
    done: "Done",
    cancelled: "Cancelled",
    no_show: "No-show",
  },
};

export const JOB_STATUS_TONE: Record<string, string> = {
  enquiry: "bg-sand text-muted",
  quoted: "bg-amber/25 text-sea-dark dark:text-link",
  confirmed: "badge-success",
  done: "bg-sea/10 text-muted",
  cancelled: "badge-danger",
  no_show: "badge-danger",
};

export const JOB_KINDS: Record<Locale, Vocab> = {
  ar: {
    stay: "إقامة",
    day_use: "يوم كامل",
    event: "مناسبة",
    session: "فترة",
    appointment: "موعد",
    visit: "معاينة",
  },
  en: {
    stay: "Stay",
    day_use: "Day use",
    event: "Event",
    session: "Session",
    appointment: "Appointment",
    visit: "Viewing",
  },
};

export const QUOTE_STATUS: Record<Locale, Vocab> = {
  ar: {
    draft: "مسودة",
    sent: "مُرسل",
    accepted: "مقبول",
    declined: "مرفوض",
    expired: "منتهي",
    withdrawn: "مسحوب",
  },
  en: {
    draft: "Draft",
    sent: "Sent",
    accepted: "Accepted",
    declined: "Declined",
    expired: "Expired",
    withdrawn: "Withdrawn",
  },
};

export const QUOTE_STATUS_TONE: Record<string, string> = {
  draft: "bg-sand text-muted",
  sent: "bg-amber/25 text-sea-dark dark:text-link",
  accepted: "badge-success",
  declined: "badge-danger",
  expired: "bg-sand text-muted",
  withdrawn: "bg-sand text-muted",
};

/**
 * Team roles inside a partner business — distinct from the platform roles
 * above, which describe someone's relationship with Ciao. A hall manager is
 * `host` to the platform and `manager` to their employer, and conflating the
 * two words on one screen is how a permission gets granted by accident.
 */
export const PARTNER_ROLES: Record<Locale, Vocab> = {
  ar: { owner: "صاحب النشاط", manager: "مدير", staff: "موظف" },
  en: { owner: "Owner", manager: "Manager", staff: "Staff" },
};

export const PARTNER_ROLE_HINT: Record<Locale, Vocab> = {
  ar: {
    owner: "كل شيء — بما فيه الحساب البنكي والفريق والاشتراك",
    manager: "المواعيد والتقويم والعروض والزبائن والأرقام",
    staff: "شغل اليوم والتقويم فقط — بلا أي أرقام مالية",
  },
  en: {
    owner: "Everything — including the payout account, the team and the plan",
    manager: "The diary, calendar, quotes, clients and the numbers",
    staff: "Today's work and the calendar only — no money screens",
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
