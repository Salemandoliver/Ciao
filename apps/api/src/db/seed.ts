/**
 * Seed: realistic Phase A supply — Janzour–Tajoura coastal strip + Ain Zara
 * estirahas + one Tripoli wedding hall (design doc §14.2 anchor venues).
 * Idempotent: skips if seed data already present.
 */
import { and, eq } from "drizzle-orm";
import { db, pool, schema } from "./client.js";

/** Real listing photos (served from the web app's /public/media). */
const MEDIA: Record<string, { url: string; kind: string; order: number }[]> = {
  "janzour-marina-villa": [
    { url: "/media/janzour-marina-villa/1.webp", kind: "photo", order: 1 },
    { url: "/media/janzour-marina-villa/2.webp", kind: "photo", order: 2 },
  ],
  "tajoura-golden-sands": [
    { url: "/media/tajoura-golden-sands/1.webp", kind: "photo", order: 1 },
    { url: "/media/tajoura-golden-sands/2.webp", kind: "photo", order: 2 },
  ],
  "ain-zara-palms": [
    { url: "/media/ain-zara-palms/1.webp", kind: "photo", order: 1 },
    { url: "/media/ain-zara-palms/2.webp", kind: "photo", order: 2 },
  ],
  "andalus-hall-tripoli": [
    { url: "/media/andalus-hall-tripoli/1.webp", kind: "photo", order: 1 },
    { url: "/media/andalus-hall-tripoli/2.webp", kind: "photo", order: 2 },
    { url: "/media/andalus-hall-tripoli/3.webp", kind: "photo", order: 3 },
    { url: "/media/andalus-hall-tripoli/4.webp", kind: "photo", order: 4 },
  ],
  // Services vertical
  "kaakat-cakes-tripoli": [
    { url: "/media/kaakat-cakes-tripoli/1.webp", kind: "photo", order: 1 },
    { url: "/media/kaakat-cakes-tripoli/2.webp", kind: "photo", order: 2 },
    { url: "/media/kaakat-cakes-tripoli/3.webp", kind: "photo", order: 3 },
    { url: "/media/kaakat-cakes-tripoli/4.webp", kind: "photo", order: 4 },
  ],
  "diwan-catering-tripoli": [
    { url: "/media/diwan-catering-tripoli/1.webp", kind: "photo", order: 1 },
    { url: "/media/diwan-catering-tripoli/2.webp", kind: "photo", order: 2 },
    { url: "/media/diwan-catering-tripoli/3.webp", kind: "photo", order: 3 },
    { url: "/media/diwan-catering-tripoli/4.webp", kind: "photo", order: 4 },
  ],
  "adasa-photography-tripoli": [
    { url: "/media/adasa-photography-tripoli/1.webp", kind: "photo", order: 1 },
    { url: "/media/adasa-photography-tripoli/2.webp", kind: "photo", order: 2 },
  ],
  "lamsa-makeup-tripoli": [
    { url: "/media/lamsa-makeup-tripoli/1.webp", kind: "photo", order: 1 },
    { url: "/media/lamsa-makeup-tripoli/2.webp", kind: "photo", order: 2 },
  ],
  "noon-hair-tripoli": [
    { url: "/media/noon-hair-tripoli/1.webp", kind: "photo", order: 1 },
    { url: "/media/noon-hair-tripoli/2.webp", kind: "photo", order: 2 },
  ],
  "sahha-gym-tripoli": [
    { url: "/media/sahha-gym-tripoli/1.webp", kind: "photo", order: 1 },
    { url: "/media/sahha-gym-tripoli/2.webp", kind: "photo", order: 2 },
  ],
};

/** Softer trust voice: we personally vet and approve every site (no spec-boasting). */
const DESCRIPTIONS: Record<string, string> = {
  "janzour-marina-villa":
    "فيلا مطلة على البحر بمسبح خاص — زارها فريق تشاو بنفسه، فحصها واعتمدها، والصور من تصويرنا.",
  "tajoura-golden-sands":
    "شاليه عائلي على البحر مباشرة — معتمد من فريق تشاو بعد زيارة ميدانية كاملة.",
  "ain-zara-palms":
    "استراحة يوم كامل بمسبح — زارها فريق تشاو واعتمدها، وما تشوفه في الصور هو الموجود.",
  "andalus-hall-tripoli":
    "قاعة أفراح معتمدة من تشاو — الباقات موحّدة للمقارنة، والسعة مؤكدة من فريقنا.",
};

/** Approximate coordinates per listing (privacy: ~500m fuzz, §7.1) for map search. */
const COORDS: Record<string, { lat: string; lng: string }> = {
  "janzour-marina-villa": { lat: "32.8305", lng: "13.0110" },
  "tajoura-golden-sands": { lat: "32.8815", lng: "13.3510" },
  "ain-zara-palms": { lat: "32.7910", lng: "13.2330" },
  "andalus-hall-tripoli": { lat: "32.7520", lng: "13.1560" },
  // services — approximate business locations across Tripoli
  "diwan-catering-tripoli": { lat: "32.7640", lng: "13.1720" },
  "adasa-photography-tripoli": { lat: "32.8180", lng: "13.0290" },
  "lamsa-makeup-tripoli": { lat: "32.8020", lng: "13.2410" },
  "noon-hair-tripoli": { lat: "32.8390", lng: "13.0450" },
  "sahha-gym-tripoli": { lat: "32.7860", lng: "13.2185" },
  "kaakat-cakes-tripoli": { lat: "32.8730", lng: "13.3390" },
};

/**
 * What's around each place — the kind of thing our agent writes down on the
 * verification visit. Seeded so the demo shows the feature working; in
 * production these arrive through the verification bundle and its approval.
 *
 * Note what makes each line worth reading: not that a café exists, but whether
 * a family can sit in it, and whether the shop still trades when the power is
 * out. That is the part no map API can tell you, and the reason this is
 * collected by a person rather than bought per request.
 */
const NEIGHBOURS: Record<string, unknown[]> = {
  "tajoura-golden-sands": [
    { kind: "supermarket", nameAr: "بقالة النور", nameEn: "Al-Noor Market", walkMinutes: 5,
      noteAr: "تفتح إلى منتصف الليل ومعها مولّد", noteEn: "Open until midnight and has its own generator" },
    { kind: "cafe", nameAr: "مقهى الشط", nameEn: "Al-Shatt Cafe", walkMinutes: 8,
      noteAr: "قسم عائلي في الطابق الأول", noteEn: "Family section on the first floor" },
    { kind: "bakery", nameAr: "مخبز تاجوراء", nameEn: "Tajoura Bakery", walkMinutes: 6,
      noteAr: "يفتح ٦ صباحًا، حتى أيام العيد", noteEn: "Opens at 6am, even during Eid" },
    { kind: "pharmacy", nameAr: "صيدلية البحر", nameEn: "Al-Bahr Pharmacy", driveMinutes: 4,
      noteAr: "أقرب صيدلية مناوبة ليلًا", noteEn: "The nearest pharmacy on night duty" },
  ],
  "janzour-marina-villa": [
    { kind: "supermarket", nameAr: "سوق جنزور المركزي", nameEn: "Janzour Central Market", driveMinutes: 6,
      noteAr: "أكبر سوق قريب، وفيه قسم لحوم", noteEn: "The biggest market nearby, with a butcher" },
    { kind: "beach_access", nameAr: "نزلة البحر الغربية", nameEn: "West beach path", walkMinutes: 3,
      noteAr: "نزلة ممهّدة، مناسبة للعربات والأطفال", noteEn: "A made path — fine for prams and small children" },
    { kind: "restaurant", nameAr: "مطعم الشاطئ", nameEn: "Al-Shati Restaurant", walkMinutes: 12,
      noteAr: "أسماك طازجة، ويقبل الحجز للعائلات", noteEn: "Fresh fish, and takes family bookings" },
    { kind: "mosque", nameAr: "جامع جنزور الكبير", nameEn: "Janzour Grand Mosque", walkMinutes: 7 },
  ],
  "ain-zara-palms": [
    { kind: "supermarket", nameAr: "بقالة الواحة", nameEn: "Al-Waha Market", walkMinutes: 4,
      noteAr: "قريبة جدًا، لكن تقفل بعد المغرب", noteEn: "Very close, but shuts after sunset" },
    { kind: "petrol", nameAr: "محطة عين زارة", nameEn: "Ain Zara petrol station", driveMinutes: 5,
      noteAr: "املأ قبل الوصول — الطوابير طويلة أحيانًا", noteEn: "Fill up before you arrive — the queues can be long" },
    { kind: "playground", nameAr: "حديقة الأطفال", nameEn: "Children's park", walkMinutes: 9,
      noteAr: "مسوّرة وفيها إضاءة ليلية", noteEn: "Walled, and lit at night" },
  ],
};

/** Always keep listing media + copy in sync with the shipped files (idempotent). */
async function syncMedia() {
  for (const [slug, media] of Object.entries(MEDIA)) {
    await db
      .update(schema.listings)
      .set({
        media,
        ...(DESCRIPTIONS[slug] ? { descriptionAr: DESCRIPTIONS[slug] } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.listings.slug, slug));
    const c = COORDS[slug];
    if (c) {
      const [row] = await db
        .select({ venueId: schema.listings.venueId })
        .from(schema.listings)
        .where(eq(schema.listings.slug, slug))
        .limit(1);
      if (row) {
        await db
          .update(schema.venues)
          .set({
            approxLat: c.lat,
            approxLng: c.lng,
            ...(NEIGHBOURS[slug] ? { neighbours: NEIGHBOURS[slug] } : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.venues.id, row.venueId));
      }
    }
  }
  console.log("Listing media synced.");
}

/** Services vertical (Airbnb-style خدمات) — idempotent create-if-missing. */
const SERVICES: {
  slug: string;
  category: string;
  nameAr: string;
  titleAr: string;
  descriptionAr: string;
  hostPhone: string;
  hostName: string;
  area: string;
}[] = [
  {
    slug: "diwan-catering-tripoli",
    category: "catering",
    nameAr: "ضيافة الديوان",
    titleAr: "ضيافة الديوان — بوفيهات أعراس ومناسبات",
    descriptionAr: "بوفيهات كاملة للأعراس والمناسبات — قوائم موحّدة للمقارنة، وتذوق قبل التعاقد. معتمدة من فريق تشاو.",
    hostPhone: "+218914000001",
    hostName: "ضيافة الديوان",
    area: "airport_road",
  },
  {
    slug: "adasa-photography-tripoli",
    category: "photography",
    nameAr: "استوديو عدسة",
    titleAr: "استوديو عدسة — تصوير أعراس ومناسبات",
    descriptionAr: "تصوير فوتو وفيديو للأعراس — باقات واضحة تشمل الألبوم المطبوع. أعمال سابقة معاينة من فريقنا.",
    hostPhone: "+218914000002",
    hostName: "استوديو عدسة",
    area: "janzour",
  },
  {
    slug: "lamsa-makeup-tripoli",
    category: "makeup",
    nameAr: "لمسة — ميكب آرتيست",
    titleAr: "لمسة — ميكب عرايس في بيتك أو الصالون",
    descriptionAr: "ميكب عرايس ومناسبات، تجربة قبل الموعد — أسعار معلنة بلا مفاجآت.",
    hostPhone: "+218914000003",
    hostName: "لمسة بيوتي",
    area: "ain_zara",
  },
  {
    slug: "noon-hair-tripoli",
    category: "hair",
    nameAr: "صالون نون",
    titleAr: "صالون نون — تسريحات عرايس ومناسبات (نسائي)",
    descriptionAr: "صالون نسائي خاص بالكامل — تسريحات عرايس ومناسبات بمواعيد محجوزة مسبقًا وخصوصية تامة. معتمد من فريق تشاو.",
    hostPhone: "+218914000005",
    hostName: "صالون نون",
    area: "janzour",
  },
  {
    slug: "sahha-gym-tripoli",
    category: "gym",
    nameAr: "صحّة — نادي لياقة",
    titleAr: "صحّة — نادي لياقة بأوقات نسائية مخصصة",
    descriptionAr: "نادي لياقة بأجهزة حديثة وأوقات نسائية مخصصة بالكامل — اشتراكات شهرية وحصص خاصة. زاره فريق تشاو واعتمده.",
    hostPhone: "+218914000006",
    hostName: "نادي صحّة",
    area: "ain_zara",
  },
  {
    slug: "kaakat-cakes-tripoli",
    category: "cakes",
    nameAr: "كعكات",
    titleAr: "كعكات — كيك أعراس وحفلات حسب الطلب",
    descriptionAr: "كيك أعراس متعدد الطوابق وحلويات مناسبات — صور أعمال حقيقية ومواعيد تسليم ملتزمة.",
    hostPhone: "+218914000004",
    hostName: "كعكات",
    area: "tajoura",
  },
];

/** Service truth-table rows — same present/absent shape as venue amenities. */
const SERVICE_FACTS: Record<string, { key: string; present: boolean; detail?: string }[]> = {
  catering: [
    { key: "tasting", present: true, detail: "تذوق مجاني قبل التعاقد" },
    { key: "delivery_setup", present: true, detail: "توصيل وتجهيز داخل طرابلس" },
    { key: "service_staff", present: true, detail: "طاقم خدمة بالزي الموحّد" },
    { key: "menu_fixed", present: true, detail: "قائمة وأسعار مكتوبة قبل الدفع" },
  ],
  photography: [
    { key: "photo_video", present: true, detail: "تصوير فوتو وفيديو" },
    { key: "female_staff", present: true, detail: "مصوّرة سيدة متاحة للقسم النسائي" },
    { key: "printed_album", present: true, detail: "ألبوم مطبوع ضمن الباقة" },
    { key: "delivery_time", present: true, detail: "التسليم خلال ٣ أسابيع" },
  ],
  makeup: [
    { key: "trial", present: true, detail: "تجربة قبل يوم المناسبة" },
    { key: "home_visit", present: true, detail: "الخدمة في بيتك أو في الصالون" },
    { key: "female_staff", present: true, detail: "سيدات فقط" },
    { key: "original_products", present: true, detail: "منتجات أصلية معاينة من فريقنا" },
  ],
  hair: [
    { key: "female_only", present: true, detail: "صالون نسائي مغلق بالكامل" },
    { key: "bridal", present: true, detail: "تسريحات عرايس ومناسبات" },
    { key: "appointment", present: true, detail: "بالموعد فقط — لا انتظار" },
    { key: "privacy", present: true, detail: "خصوصية تامة، ممنوع التصوير" },
  ],
  gym: [
    { key: "female_hours", present: true, detail: "أوقات نسائية مخصصة يوميًا" },
    { key: "female_trainer", present: true, detail: "مدربة سيدة للحصص النسائية" },
    { key: "equipment", present: true, detail: "أجهزة كارديو ومقاومة حديثة" },
    { key: "membership", present: true, detail: "اشتراك شهري أو حصص مفردة" },
  ],
  cakes: [
    { key: "tiered_cake", present: true, detail: "كيك أعراس متعدد الطوابق" },
    { key: "tasting", present: true, detail: "تذوق قبل تأكيد الطلب" },
    { key: "delivery_setup", present: true, detail: "توصيل وتركيب في القاعة" },
    { key: "custom_design", present: true, detail: "تصميم حسب طلبك" },
  ],
};

/** Keep service facts in sync on every seed run (idempotent). */
async function syncServiceFacts() {
  for (const svc of SERVICES) {
    const facts = SERVICE_FACTS[svc.category];
    if (!facts) continue;
    const [row] = await db
      .select({ venueId: schema.listings.venueId })
      .from(schema.listings)
      .where(eq(schema.listings.slug, svc.slug))
      .limit(1);
    if (!row) continue;
    await db
      .update(schema.venues)
      .set({ amenities: facts, updatedAt: new Date() })
      .where(eq(schema.venues.id, row.venueId));
  }
  console.log("Service facts synced.");
}

async function syncServices() {
  for (const svc of SERVICES) {
    const [exists] = await db
      .select({ id: schema.listings.id })
      .from(schema.listings)
      .where(eq(schema.listings.slug, svc.slug))
      .limit(1);
    if (exists) continue;
    let [host] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.phone, svc.hostPhone))
      .limit(1);
    if (!host) {
      [host] = await db
        .insert(schema.users)
        .values({ phone: svc.hostPhone, role: "host", displayName: svc.hostName })
        .returning();
    }
    const [venue] = await db
      .insert(schema.venues)
      .values({
        type: "service",
        nameAr: svc.nameAr,
        city: "tripoli",
        area: svc.area,
        hostId: host!.id,
        // Most service providers here work from home. Area-only is the default
        // they would choose; widening it is theirs to do, not ours.
        locationDisclosure: "area",
        verificationGrade: "local_attestation",
        verifiedAt: new Date(),
        verificationExpiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
        amenities: [],
      })
      .returning();
    await db.insert(schema.listings).values({
      venueId: venue!.id,
      slug: svc.slug,
      status: "live",
      titleAr: svc.titleAr,
      descriptionAr: svc.descriptionAr,
      serviceCategory: svc.category,
      bookingTypes: ["visit"],
      baseNightly: 0,
      cancellationTier: "moderate",
      media: [],
    });
  }
  console.log("Services synced.");
}


/**
 * Demo trust history — completed stays, published reviews, and one dispute
 * that was opened and resolved. Without this the trust dialog would show
 * empty states, and the whole point is that trust data is visible from day one.
 * Idempotent: skipped per-listing once reviews exist.
 */
const REVIEWERS: { phone: string; displayName: string; publicName: string }[] = [
  { phone: "+218945100001", displayName: "سارة الزوي", publicName: "س. ز" },
  { phone: "+218945100002", displayName: "محمد العابد", publicName: "م. ع" },
  { phone: "+218945100003", displayName: "فاطمة بن عمر", publicName: "ف. ب" },
  { phone: "+218945100004", displayName: "نور الحضيري", publicName: "ن. ح" },
  { phone: "+218945100005", displayName: "أحمد مفتاح", publicName: "أ. م" },
  { phone: "+218945100006", displayName: "ريم الطاهر", publicName: "ر. ط" },
];

type DemoReview = {
  scores: Record<string, number>;
  text: string;
  hostReply?: string;
};

const DEMO_REVIEWS: Record<string, DemoReview[]> = {
  "janzour-marina-villa": [
    {
      scores: { cleanliness: 5, accuracy: 5, privacy: 5, communication: 5, value: 5 },
      text: "المكان مطابق للصور تمامًا، والمسبح مسوَّر فعلًا كما وُصف. أول مرة نحجز بدون مكالمات ولا وساطة.",
      hostReply: "شكرًا على زيارتكم، أهلًا بكم دائمًا.",
    },
    {
      scores: { cleanliness: 5, accuracy: 5, privacy: 5, communication: 4, value: 5 },
      text: "الخصوصية ممتازة للعائلة، والمولّد اشتغل مباشرة لما انقطعت الكهرباء.",
    },
    {
      scores: { cleanliness: 5, accuracy: 5, privacy: 5, communication: 5, value: 4 },
      text: "نظيفة جدًا والعنوان وصلنا فورًا بعد العربون. السعر مناسب لآخر الأسبوع.",
    },
    {
      scores: { cleanliness: 4, accuracy: 5, privacy: 5, communication: 5, value: 4 },
      text: "تجربة مريحة. الاستقبال كان سريع والباقي دفعناه نقدًا عند الوصول بدون أي مشاكل.",
    },
    {
      scores: { cleanliness: 5, accuracy: 4, privacy: 5, communication: 5, value: 5 },
      text: "غرفة واحدة كانت أصغر مما تخيلت لكن كل شيء آخر ممتاز. الشاطئ قريب فعلًا.",
      hostReply: "شكرًا لملاحظتك — حدّثنا الصور لتوضيح مقاس الغرفة.",
    },
    {
      scores: { cleanliness: 3, accuracy: 4, privacy: 5, communication: 4, value: 4 },
      text: "النظافة كانت متوسطة يوم وصولنا وتمّت معالجتها بسرعة بعد ما بلّغنا تشاو.",
      hostReply: "اعتذارنا، غيّرنا شركة التنظيف بعد هذه الملاحظة.",
    },
  ],
  "tajoura-golden-sands": [
    {
      scores: { cleanliness: 5, accuracy: 5, privacy: 5, communication: 5, value: 5 },
      text: "على البحر مباشرة كما هو مكتوب. الأطفال ما طلعوش من المية.",
      hostReply: "نورتوا الشاليه.",
    },
    {
      scores: { cleanliness: 5, accuracy: 5, privacy: 4, communication: 5, value: 5 },
      text: "الحجز كان سهل والعربون بسيط. أفضل من التعامل بالواتساب مع ناس ما نعرفهمش.",
    },
    {
      scores: { cleanliness: 4, accuracy: 5, privacy: 4, communication: 5, value: 5 },
      text: "ممتاز للعائلة، والمضيف ردّ على تأكيد الحجز خلال دقائق.",
    },
    {
      scores: { cleanliness: 5, accuracy: 4, privacy: 4, communication: 4, value: 5 },
      text: "قضينا يومين ممتازين. الطريق للشاليه يحتاج انتباه بالليل.",
    },
  ],
  "ain-zara-palms": [
    {
      scores: { cleanliness: 5, accuracy: 5, privacy: 4, communication: 5, value: 5 },
      text: "حجزناها ليوم كامل لعيد ميلاد. المسبح نظيف والمكان واسع.",
      hostReply: "شكرًا لكم، مبروك المناسبة.",
    },
    {
      scores: { cleanliness: 4, accuracy: 5, privacy: 3, communication: 5, value: 5 },
      text: "قيمة ممتازة مقابل السعر. الجيران يشوفوا جزء من الحديقة فانتبهوا لو تبون ستر كامل.",
    },
    {
      scores: { cleanliness: 5, accuracy: 5, privacy: 4, communication: 4, value: 5 },
      text: "استراحة مريحة ونهار كامل بسعر معقول.",
    },
  ],
  "andalus-hall-tripoli": [
    {
      scores: { cleanliness: 5, accuracy: 5, privacy: 5, communication: 5, value: 4 },
      text: "قاعة عرس بنتي كانت ممتازة. الباقة الذهبية شملت كل شيء بدون مفاجآت في الحساب.",
      hostReply: "مبروك مرة أخرى، شرّفتونا.",
    },
    {
      scores: { cleanliness: 5, accuracy: 5, privacy: 5, communication: 4, value: 4 },
      text: "السعة كما هي مكتوبة بالضبط — ٥٠٠ ضيفة وما ضاقت القاعة.",
    },
    {
      scores: { cleanliness: 5, accuracy: 4, privacy: 5, communication: 5, value: 4 },
      text: "التنسيق والإضاءة جميلة. الصوتيات كانت عالية شوي في البداية وتم ضبطها.",
    },
  ],
  "diwan-catering-tripoli": [
    {
      scores: { quality: 5, accuracy: 5, punctuality: 5, communication: 5, value: 4 },
      text: "البوفيه وصل في وقته بالضبط والكمية كانت كافية لـ٣٠٠ ضيف. التذوق قبل التعاقد ساعدنا كثير.",
      hostReply: "شكرًا لثقتكم.",
    },
    {
      scores: { quality: 5, accuracy: 5, punctuality: 4, communication: 5, value: 5 },
      text: "الأكل ممتاز والطاقم مرتب. تعاملنا كان عبر تشاو والسعر ثبت من البداية.",
    },
    {
      scores: { quality: 4, accuracy: 5, punctuality: 5, communication: 5, value: 5 },
      text: "خدمة محترمة وأسعار واضحة بلا مفاجآت.",
    },
  ],
  "kaakat-cakes-tripoli": [
    {
      scores: { quality: 5, accuracy: 5, punctuality: 5, communication: 5, value: 5 },
      text: "الكيكة طلعت أحلى من الصورة اللي اتفقنا عليها، ووصلت للقاعة قبل الموعد.",
      hostReply: "مبروك، وشكرًا على الثقة.",
    },
    {
      scores: { quality: 5, accuracy: 4, punctuality: 5, communication: 5, value: 4 },
      text: "الطعم ممتاز. اللون طلع أفتح شوي من المتفق عليه لكن الشكل كان راقي.",
    },
    {
      scores: { quality: 5, accuracy: 5, punctuality: 5, communication: 4, value: 5 },
      text: "التوصيل والتركيب في القاعة كان احترافي.",
    },
  ],
};

async function syncDemoTrust() {
  // reviewers
  const reviewerIds: string[] = [];
  for (const r of REVIEWERS) {
    let [u] = await db.select().from(schema.users).where(eq(schema.users.phone, r.phone)).limit(1);
    if (!u) {
      [u] = await db
        .insert(schema.users)
        .values({ phone: r.phone, role: "guest", displayName: r.displayName, publicName: r.publicName })
        .returning();
    }
    reviewerIds.push(u!.id);
  }

  let seededDispute = false;
  for (const [slug, reviews] of Object.entries(DEMO_REVIEWS)) {
    const [row] = await db
      .select({ listing: schema.listings, venue: schema.venues })
      .from(schema.listings)
      .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
      .where(eq(schema.listings.slug, slug))
      .limit(1);
    if (!row) continue;

    const [already] = await db
      .select({ id: schema.reviews.id })
      .from(schema.reviews)
      .where(eq(schema.reviews.listingId, row.listing.id))
      .limit(1);
    if (already) continue;

    for (let i = 0; i < reviews.length; i++) {
      const r = reviews[i]!;
      const guestId = reviewerIds[i % reviewerIds.length]!;
      // Past stay: 20..120 days ago, 2 nights.
      const daysAgo = 20 + i * 14;
      const checkIn = new Date(Date.now() - daysAgo * 24 * 3600 * 1000);
      const checkOut = new Date(checkIn.getTime() + 2 * 24 * 3600 * 1000);
      const total = row.listing.baseNightly * 2;
      const deposit = Math.round(total * 0.2);
      const [booking] = await db
        .insert(schema.bookings)
        .values({
          code: `CIA-D${slug.slice(0, 2).toUpperCase()}${i}${Math.floor(Math.random() * 900 + 100)}`,
          listingId: row.listing.id,
          venueId: row.venue.id,
          guestId,
          hostId: row.venue.hostId,
          type: row.venue.type === "hall" ? "event_date" : row.venue.type === "service" ? "visit" : "stay",
          state: "reviewed",
          checkIn: checkIn.toISOString().slice(0, 10),
          checkOut: checkOut.toISOString().slice(0, 10),
          totalAmount: total,
          depositAmount: deposit,
          balanceOnArrival: total - deposit,
          commissionAmount: Math.round(total * 0.1),
          completedAt: checkOut,
          createdAt: new Date(checkIn.getTime() - 10 * 24 * 3600 * 1000),
        })
        .returning();

      await db.insert(schema.reviews).values({
        bookingId: booking!.id,
        listingId: row.listing.id,
        authorRole: "guest",
        authorId: guestId,
        scores: r.scores,
        text: r.text,
        hostReply: r.hostReply,
        publishedAt: new Date(checkOut.getTime() + 2 * 24 * 3600 * 1000),
        createdAt: new Date(checkOut.getTime() + 24 * 3600 * 1000),
      });

      // One real dispute in the history: opened on the cleanliness complaint,
      // resolved inside the 48h SLA with a partial refund.
      if (!seededDispute && slug === "janzour-marina-villa" && i === reviews.length - 1) {
        const opened = new Date(checkOut.getTime() + 6 * 3600 * 1000);
        await db.insert(schema.disputes).values({
          bookingId: booking!.id,
          openedById: guestId,
          category: "misrepresentation",
          statement: "النظافة عند الوصول لم تكن بالمستوى المتوقع.",
          status: "resolved",
          resolution: "تم التحقق مع المضيف واسترجاع جزء من العربون للضيف، والتزم المضيف بتغيير شركة التنظيف.",
          remedy: "partial_refund",
          dueAt: new Date(opened.getTime() + 48 * 3600 * 1000),
          resolvedAt: new Date(opened.getTime() + 20 * 3600 * 1000),
          createdAt: opened,
        });
        seededDispute = true;
      }
    }
  }
  console.log("Demo trust history synced (reviews + dispute record).");
}

/**
 * Demo diary for the partner control panel.
 *
 * A control panel that opens empty demonstrates nothing — and the thing this
 * one has to demonstrate is not "you can add a job", it is the argument: that
 * a partner's own book, the part Ciao never touched, lives here too. So the
 * seeded data is deliberately mostly *not* Ciao's: WhatsApp jobs, a walk-in, a
 * returning client, and a real unpaid balance somebody has to chase.
 *
 * Built around صالون نون and لمسة from the services seed, because a make-up
 * artist and a salon are the clearest case for this product — several
 * appointments a day, no system at all today, and everything currently living
 * in a chat thread.
 *
 * Idempotent: keyed on the job title per partner, so re-seeding is safe.
 */
/**
 * Lancaster Al Salam, Talil / Sabratha — the first venue seeded from a real
 * published price list rather than from our own assumptions.
 *
 * Every number here is copied from the summer-2026 rate card the resort sent
 * over Facebook Messenger on 4 August 2026. It is seeded, and kept seeded,
 * because it is the only fixture in the project that can fail honestly: if a
 * future change to the pricing engine stops reproducing this table, the change
 * is wrong, and no synthetic chalet would have told us.
 *
 * It exercises, in one property, nearly everything this release added: a venue
 * with three differently-priced units, a rate that covers two guests of six, a
 * flat weekend supplement no basis-point value can express, full board,
 * children's bands, a dated special offer, an eleven-to-five reservations desk,
 * a sold-out unit, fifteen facilities, a west-coast city that did not exist in
 * our vocabulary, and proof of family status as a condition of entry.
 */
async function syncLancaster() {
  const [host] = await db
    .insert(schema.users)
    .values({
      phone: "+218912931616",
      role: "host",
      displayName: "منتجع لانكستر السلام",
    })
    .onConflictDoNothing()
    .returning();

  const hostId =
    host?.id ??
    (
      await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.phone, "+218912931616"))
        .limit(1)
    )[0]?.id;

  /** The fifteen facilities, exactly as they list them. */
  const amenities = [
    { key: "beach", present: true },
    { key: "pool", present: true, detail: "مسبح للكبار" },
    { key: "kids_pool", present: true },
    { key: "wifi", present: true },
    { key: "parking", present: true, detail: "مواقف خاصة" },
    { key: "security_24h", present: true },
    { key: "restaurant", present: true },
    { key: "cafe", present: true, detail: "داخلية وخارجية" },
    { key: "room_service", present: true },
    { key: "laundry", present: true },
    { key: "nursery", present: true },
    { key: "barber", present: true },
    { key: "meeting_room", present: true },
    { key: "mini_market", present: true },
    { key: "generator", present: true },
  ];

  const [venue] = await db
    .insert(schema.venues)
    .values({
      type: "coast",
      nameAr: "منتجع لانكستر السلام",
      nameEn: "Lancaster Al Salam Resort",
      slug: "lancaster-al-salam",
      city: "sabratha",
      area: "talil",
      hostId,
      locationDisclosure: "staged",
      approxLat: "32.7930",
      approxLng: "12.4870",
      amenities,
      /*
       * 11:00–17:00 daily. The line in their price list that quietly broke our
       * confirmation countdown: a booking at seven in the evening used to
       * auto-decline at nine and dock their reliability for being shut.
       */
      officeHours: { from: "11:00", to: "17:00" },
      verificationGrade: "utility_bill_attestation",
      verifiedAt: new Date(),
      foundingHost: true,
    })
    .onConflictDoNothing()
    .returning();

  const venueId =
    venue?.id ??
    (
      await db
        .select({ id: schema.venues.id })
        .from(schema.venues)
        .where(eq(schema.venues.slug, "lancaster-al-salam"))
        .limit(1)
    )[0]?.id;
  if (!venueId) return;

  /** Proof of family status is a condition of entry, not a preference. */
  const requirements = [
    {
      key: "family_proof",
      mustAcknowledge: true,
      detailAr: "يشترط إحضار إثبات الوضع العائلي عند الوصول",
      detailEn: "Proof of family status is required on arrival",
    },
  ];

  const childBands = { childFreeUnder: 6, childReducedUnder: 11, childReducedBps: 5000 };

  const units: (typeof schema.listings.$inferInsert)[] = [
    {
      venueId,
      slug: "lancaster-villa-sea-view",
      status: "live",
      titleAr: "فيلا بمسبح خاص وإطلالة على البحر — لانكستر السلام",
      titleEn: "Villa with private pool and sea view — Lancaster Al Salam",
      descriptionAr:
        "٣ غرف نوم، ٣ حمامات، صالون فاخر، مطبخ متكامل، مسبح خاص، جلسات خارجية ومساحات خضراء، بإطلالة مباشرة على البحر. الإقامة كاملة تشمل الإفطار والغداء والعشاء بوفيه مفتوح.",
      unitKind: "villa",
      baseNightly: 3_600_000,
      // Their weekend is +600 flat, which as a ratio is 7/6 — not
      // representable in basis points at any rounding. This is why the column
      // exists.
      weekendSupplement: 600_000,
      includedGuests: 2,
      extraGuestFee: 300_000,
      extraBedPrice: 150_000,
      boardBasis: "full_board",
      maxGuests: 6,
      bedrooms: 3,
      bathrooms: 3,
      checkInTime: "15:00",
      checkOutTime: "12:00",
      cancellationTier: "moderate",
      familyOnly: true,
      requirements,
      ...childBands,
    },
    {
      venueId,
      slug: "lancaster-chalet",
      status: "live",
      titleAr: "شاليه عائلي — لانكستر السلام",
      titleEn: "Family chalet — Lancaster Al Salam",
      descriptionAr:
        "شاليه عائلي داخل المنتجع، إقامة كاملة تشمل ثلاث وجبات بوفيه مفتوح، مع كل مرافق المنتجع: الشاطئ، المسابح، المطعم والكافيه.",
      unitKind: "chalet",
      baseNightly: 1_800_000,
      weekendSupplement: 400_000,
      includedGuests: 2,
      extraGuestFee: 300_000,
      extraBedPrice: 150_000,
      boardBasis: "full_board",
      maxGuests: 4,
      bedrooms: 2,
      bathrooms: 1,
      checkInTime: "15:00",
      checkOutTime: "12:00",
      cancellationTier: "moderate",
      familyOnly: true,
      requirements,
      ...childBands,
    },
    {
      venueId,
      slug: "lancaster-vvip-duplex",
      status: "live",
      titleAr: "فيلا VVIP دوبلكس — لانكستر السلام",
      titleEn: "VVIP Duplex villa — Lancaster Al Salam",
      descriptionAr:
        "دوبلكس فاخر يتسع حتى ٩ أشخاص، بإقامة كاملة وكل مرافق المنتجع. للاستفسار عن التوفر تواصل مع فريق تشاو.",
      unitKind: "villa",
      baseNightly: 6_000_000,
      weekendSupplement: 900_000,
      includedGuests: 2,
      extraGuestFee: 300_000,
      extraBedPrice: 150_000,
      boardBasis: "full_board",
      maxGuests: 9,
      bedrooms: 4,
      bathrooms: 4,
      minNights: 2,
      checkInTime: "15:00",
      checkOutTime: "12:00",
      cancellationTier: "strict",
      familyOnly: true,
      requirements,
      ...childBands,
    },
  ];

  for (const u of units) {
    await db.insert(schema.listings).values(u).onConflictDoNothing();
  }

  /* Their published special offer, 10–20 August. */
  const [villa] = await db
    .select({ id: schema.listings.id })
    .from(schema.listings)
    .where(eq(schema.listings.slug, "lancaster-villa-sea-view"))
    .limit(1);
  if (villa) {
    const existing = await db
      .select({ id: schema.listingRates.id })
      .from(schema.listingRates)
      .where(eq(schema.listingRates.listingId, villa.id))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(schema.listingRates).values({
        listingId: villa.id,
        startDate: "2026-08-10",
        endDate: "2026-08-20",
        nightly: 3_200_000,
        minNights: 2,
        labelAr: "عرض خاص",
        labelEn: "Special offer",
      });
    }
  }

  /*
   * The duplex is sold out, and stays on the page saying so — which is exactly
   * what the resort itself does, because a property whose best unit has gone
   * is a property worth booking today.
   */
  const [duplex] = await db
    .select({ id: schema.listings.id })
    .from(schema.listings)
    .where(eq(schema.listings.slug, "lancaster-vvip-duplex"))
    .limit(1);
  if (duplex) {
    const days: (typeof schema.calendarDays.$inferInsert)[] = [];
    const start = new Date();
    for (let i = 0; i < 45; i++) {
      const d = new Date(start.getTime() + i * 86_400_000);
      days.push({
        listingId: duplex.id,
        day: d.toISOString().slice(0, 10),
        session: "night",
        state: "blocked",
      });
    }
    await db.insert(schema.calendarDays).values(days).onConflictDoNothing();
  }

  console.log("Lancaster Al Salam synced — 3 units, real rate card, Sabratha.");
}

async function syncPartnerDemo() {
  const today = new Date();
  const day = (offset: number) =>
    new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

  const cast: {
    hostPhone: string;
    kind: "venue" | "hall" | "service";
    businessNameAr: string;
    maxJobsPerDay: number;
    clients: { nameAr: string; phone: string }[];
    jobs: {
      titleAr: string;
      client: number;
      day: string;
      startTime?: string;
      source: string;
      kind: string;
      price: number;
      amountPaid: number;
      locationAr?: string;
      notesAr?: string;
      status?: string;
    }[];
  }[] = [
    {
      hostPhone: "+218914000003", // لمسة — ميكب آرتيست
      kind: "service",
      businessNameAr: "لمسة بيوتي",
      maxJobsPerDay: 4,
      clients: [
        { nameAr: "هدى العرفي", phone: "+218915550001" },
        { nameAr: "أم سارة", phone: "+218915550002" },
        { nameAr: "نور بن عثمان", phone: "+218915550003" },
      ],
      jobs: [
        {
          titleAr: "ميكب عروس — عرس هدى",
          client: 0,
          day: day(0),
          startTime: "09:00",
          source: "whatsapp",
          kind: "appointment",
          price: 1_800_000,
          amountPaid: 500_000,
          locationAr: "بيت العروس — جنزور",
          notesAr: "التجربة تمت. تبي فرش أفتح من التجربة.",
        },
        {
          titleAr: "ميكب مناسبة",
          client: 1,
          day: day(0),
          startTime: "16:30",
          source: "repeat",
          kind: "appointment",
          price: 600_000,
          amountPaid: 600_000,
          locationAr: "الصالون",
        },
        {
          titleAr: "تجربة ميكب عروس",
          client: 2,
          day: day(1),
          startTime: "11:00",
          source: "instagram",
          kind: "appointment",
          price: 400_000,
          amountPaid: 0,
          locationAr: "الصالون",
        },
        {
          titleAr: "ميكب عروس — عرس نور",
          client: 2,
          day: day(24),
          startTime: "08:30",
          source: "instagram",
          kind: "appointment",
          price: 1_800_000,
          amountPaid: 400_000,
          locationAr: "قاعة الأندلس — طريق المطار",
        },
        {
          // The unpaid balance from last month — the number that makes the
          // money screen worth opening.
          titleAr: "ميكب مناسبة عائلية",
          client: 1,
          day: day(-21),
          source: "phone",
          kind: "appointment",
          price: 750_000,
          amountPaid: 250_000,
          status: "done",
        },
        {
          titleAr: "ميكب سهرة",
          client: 0,
          day: day(-40),
          source: "walk_in",
          kind: "appointment",
          price: 450_000,
          amountPaid: 450_000,
          status: "done",
        },
      ],
    },
    {
      hostPhone: "+218914000005", // صالون نون
      kind: "service",
      businessNameAr: "صالون نون",
      maxJobsPerDay: 5,
      clients: [
        { nameAr: "مريم الفيتوري", phone: "+218915550010" },
        { nameAr: "أم عبدالله", phone: "+218915550011" },
      ],
      jobs: [
        {
          titleAr: "تسريحة عروس",
          client: 0,
          day: day(2),
          startTime: "10:00",
          source: "whatsapp",
          kind: "appointment",
          price: 900_000,
          amountPaid: 300_000,
          locationAr: "الصالون — جنزور",
        },
        {
          titleAr: "تسريحات مناسبة (٣ سيدات)",
          client: 1,
          day: day(5),
          startTime: "15:00",
          source: "facebook",
          kind: "appointment",
          price: 1_200_000,
          amountPaid: 0,
          locationAr: "الصالون — جنزور",
        },
      ],
    },
    {
      hostPhone: "+218911111111", // a coast host — the notebook case
      kind: "venue",
      businessNameAr: "",
      maxJobsPerDay: 1,
      clients: [{ nameAr: "أبو محمد", phone: "+218915550020" }],
      jobs: [
        {
          // Exactly the booking that causes a double-booking today: taken over
          // the phone, written in a notebook, invisible to the marketplace.
          titleAr: "حجز عائلي — من التلفون",
          client: 0,
          day: day(9),
          source: "phone",
          kind: "stay",
          price: 1_500_000,
          amountPaid: 300_000,
          notesAr: "عائلة من مصراتة، يوصلوا العصر.",
        },
      ],
    },
  ];

  const { createJob, ensureProfile, upsertClient } = await import(
    "../modules/partner/service.js"
  );

  for (const business of cast) {
    const [host] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.phone, business.hostPhone))
      .limit(1);
    if (!host) continue;

    await ensureProfile(host.id, {
      kind: business.kind,
      businessNameAr: business.businessNameAr || undefined,
    });
    await db
      .update(schema.partnerProfiles)
      .set({
        maxJobsPerDay: business.maxJobsPerDay,
        agendaEnabled: true,
        agendaHour: 18,
        onboardedAt: new Date(),
      })
      .where(eq(schema.partnerProfiles.userId, host.id));

    const [listing] = await db
      .select({ id: schema.listings.id })
      .from(schema.listings)
      .innerJoin(schema.venues, eq(schema.listings.venueId, schema.venues.id))
      .where(eq(schema.venues.hostId, host.id))
      .limit(1);

    const clientIds: string[] = [];
    for (const c of business.clients) {
      const row = await upsertClient(host.id, { nameAr: c.nameAr, phone: c.phone }, host.id);
      clientIds.push(row.id);
    }

    for (const job of business.jobs) {
      const [exists] = await db
        .select({ id: schema.partnerJobs.id })
        .from(schema.partnerJobs)
        .where(
          and(
            eq(schema.partnerJobs.partnerId, host.id),
            eq(schema.partnerJobs.titleAr, job.titleAr),
          ),
        )
        .limit(1);
      if (exists) continue;
      await createJob(host.id, host.id, {
        listingId: business.kind === "venue" ? (listing?.id ?? null) : null,
        clientId: clientIds[job.client] ?? null,
        source: job.source,
        kind: job.kind,
        titleAr: job.titleAr,
        day: job.day,
        startTime: job.startTime ?? null,
        status: (job.status ?? "confirmed") as "confirmed" | "done",
        price: job.price,
        amountPaid: job.amountPaid,
        locationAr: job.locationAr ?? null,
        notesAr: job.notesAr ?? null,
        // Only the chalet's off-platform booking closes a marketplace day —
        // a make-up artist's appointment does not take a listing off sale.
        blocksCalendar: business.kind === "venue",
      });
    }
  }
  /*
   * One quote, sent and awaiting an answer.
   *
   * Seeded because the quote is the feature that has to be *seen* to land —
   * describing "a priced document with a share link" to a photographer does
   * nothing, and handing her a phone with one open on it does everything. The
   * code is stable across seeds so a demo link keeps working.
   */
  const [lamsa] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.phone, "+218914000003"))
    .limit(1);
  if (lamsa) {
    const [exists] = await db
      .select({ id: schema.partnerQuotes.id })
      .from(schema.partnerQuotes)
      .where(eq(schema.partnerQuotes.code, "Q-DEMO01"))
      .limit(1);
    if (!exists) {
      const [client] = await db
        .select({ id: schema.partnerClients.id })
        .from(schema.partnerClients)
        .where(
          and(
            eq(schema.partnerClients.partnerId, lamsa.id),
            eq(schema.partnerClients.phone, "+218915550003"),
          ),
        )
        .limit(1);
      const lineItems = [
        { labelAr: "ميكب عروس يوم العرس", qty: 1, unitPrice: 1_500_000 },
        { labelAr: "تجربة ميكب قبل الموعد", qty: 1, unitPrice: 300_000 },
        { labelAr: "تسريحة شعر", qty: 1, unitPrice: 400_000 },
        { labelAr: "تنقل لخارج طرابلس", qty: 1, unitPrice: 150_000 },
      ];
      const subtotal = lineItems.reduce((s, l) => s + l.qty * l.unitPrice, 0);
      await db.insert(schema.partnerQuotes).values({
        code: "Q-DEMO01",
        partnerId: lamsa.id,
        clientId: client?.id ?? null,
        titleAr: "باقة عروس كاملة — ميكب وتسريحة",
        lineItems,
        subtotal,
        discount: 0,
        total: subtotal,
        depositAmount: Math.round(subtotal * 0.25),
        proposedDay: day(24),
        startTime: "08:30",
        validUntil: day(10),
        notesAr: "التجربة تكون قبل الموعد بأسبوع، ونتفق على الستايل من صور تختارينها.",
        termsAr: "العربون يثبّت التاريخ ولا يُسترجع خلال آخر ٧ أيام قبل الموعد.",
        status: "sent",
        sentAt: new Date(),
      });
    }
  }

  console.log("Partner demo diaries synced.");
}

async function main() {
  const [existing] = await db
    .select({ id: schema.listings.id })
    .from(schema.listings)
    .where(eq(schema.listings.slug, "janzour-marina-villa"))
    .limit(1);
  if (existing) {
    console.log("Seed data already present — syncing services + media only.");
    await syncServices();
    await syncServiceFacts();
    await syncMedia();
    await syncDemoTrust();
    await syncPartnerDemo();
    // Lancaster is idempotent create-if-missing, so it must run on the
    // already-seeded path too — otherwise it only ever appears in a database
    // built from scratch, which is nobody's.
    await syncLancaster();
    await pool.end();
    return;
  }

  // ---- users
  const [ops] = await db
    .insert(schema.users)
    .values({ phone: "+218910000001", role: "admin", displayName: "Ciao Ops" })
    .returning();
  const [agent] = await db
    .insert(schema.users)
    .values({ phone: "+218910000002", role: "agent", displayName: "وكيل ميداني — طرابلس" })
    .returning();
  const [hajMustafa] = await db
    .insert(schema.users)
    .values({ phone: "+218911111111", role: "host", displayName: "الحاج مصطفى" })
    .returning();
  const [omar] = await db
    .insert(schema.users)
    .values({ phone: "+218922222222", role: "host", displayName: "عمر — إدارة عقارات" })
    .returning();
  const [hallOwner] = await db
    .insert(schema.users)
    .values({ phone: "+218933333333", role: "host", displayName: "قاعة الأندلس" })
    .returning();
  const [guest] = await db
    .insert(schema.users)
    .values({ phone: "+218944444444", role: "guest", displayName: "سارة الزوي", publicName: "س. ز" })
    .returning();

  console.log("Users seeded:", { ops: ops!.id, agent: agent!.id, guest: guest!.id });

  // ---- venues + listings
  const mk = async (v: {
    host: string;
    type: "coast" | "hall";
    nameAr: string;
    nameEn: string;
    city: string;
    area: string;
    slug: string;
    titleAr: string;
    titleEn: string;
    baseNightly: number; // dirhams
    bedrooms?: number;
    maxGuests?: number;
    familyOnly?: boolean;
    dayUse?: number;
    tier?: "flexible" | "moderate" | "strict";
    privacy?: { walledPool: boolean; overlooked: boolean; separateFamilyEntrance: boolean; score: number };
    amenities: object[];
    capacityWomens?: number;
    capacityMens?: number;
    founding?: boolean;
    verified?: boolean;
  }) => {
    const [venue] = await db
      .insert(schema.venues)
      .values({
        type: v.type,
        nameAr: v.nameAr,
        nameEn: v.nameEn,
        city: v.city,
        area: v.area,
        hostId: v.host,
        approxLat: "32.81",
        approxLng: "13.05",
        exactLat: "32.8123",
        exactLng: "13.0521",
        addressAr: "شارع الساحل، بجوار المسجد الكبير",
        verificationGrade: v.verified ? "utility_bill_attestation" : "unverified",
        verifiedAt: v.verified ? new Date() : null,
        verificationExpiresAt: v.verified
          ? new Date(Date.now() + 365 * 24 * 3600 * 1000)
          : null,
        amenities: v.amenities,
        privacy: v.privacy,
        capacityWomens: v.capacityWomens,
        capacityMens: v.capacityMens,
        foundingHost: v.founding ?? false,
      })
      .returning();
    const [listing] = await db
      .insert(schema.listings)
      .values({
        venueId: venue!.id,
        slug: v.slug,
        status: "live",
        titleAr: v.titleAr,
        titleEn: v.titleEn,
        descriptionAr:
          DESCRIPTIONS[v.slug] ??
          "معتمد من فريق تشاو بعد زيارة ميدانية — ما تشوفه في الصور هو الموجود.",
        baseNightly: v.baseNightly,
        dayUsePrice: v.dayUse,
        maxGuests: v.maxGuests,
        bedrooms: v.bedrooms,
        cancellationTier: v.tier ?? "moderate",
        familyOnly: v.familyOnly ?? false,
        bookingTypes: v.type === "hall" ? ["event_date", "visit"] : v.dayUse ? ["stay", "day_use"] : ["stay"],
        media: MEDIA[v.slug] ?? [],
        houseRulesAr: "عائلات فقط أيام الجمعة والسبت. ممنوع إزعاج الجيران بعد منتصف الليل.",
      })
      .returning();
    return { venue: venue!, listing: listing! };
  };

  const gen = (kva: number) => ({
    key: "generator",
    present: true,
    condition: "good",
    detail: `${kva} KVA ديزل، الوقود مشمول`,
    verifiedAt: new Date().toISOString().slice(0, 10),
  });
  const water = (kind: string) => ({
    key: "water_tank",
    present: true,
    condition: "good",
    detail: kind,
  });
  const pool_ = { key: "pool", present: true, condition: "good", detail: "مسبح خاص 8×4م" };

  await mk({
    host: hajMustafa!.id,
    type: "coast",
    nameAr: "استراحة مارينا جنزور",
    nameEn: "Janzour Marina Villa",
    city: "tripoli",
    area: "janzour",
    slug: "janzour-marina-villa",
    titleAr: "فيلا شاطئية بمسبح خاص — جنزور",
    titleEn: "Beachfront villa with private pool — Janzour",
    baseNightly: 600_000, // 600 LYD
    bedrooms: 4,
    maxGuests: 12,
    familyOnly: true,
    tier: "moderate",
    privacy: { walledPool: true, overlooked: false, separateFamilyEntrance: true, score: 100 },
    amenities: [gen(12), water("خزان 4000 لتر + بئر"), pool_],
    founding: true,
    verified: true,
  });

  await mk({
    host: hajMustafa!.id,
    type: "coast",
    nameAr: "شاليه الرمال الذهبية — تاجوراء",
    nameEn: "Golden Sands Chalet — Tajoura",
    city: "tripoli",
    area: "tajoura",
    slug: "tajoura-golden-sands",
    titleAr: "شاليه عائلي على البحر مباشرة — تاجوراء",
    titleEn: "Family chalet right on the sea — Tajoura",
    baseNightly: 450_000,
    bedrooms: 3,
    maxGuests: 8,
    familyOnly: true,
    tier: "flexible",
    privacy: { walledPool: true, overlooked: false, separateFamilyEntrance: false, score: 85 },
    amenities: [gen(8), water("خزان 2000 لتر")],
    founding: true,
    verified: true,
  });

  await mk({
    host: omar!.id,
    type: "coast",
    nameAr: "استراحة النخيل — عين زارة",
    nameEn: "Palms Estiraha — Ain Zara",
    city: "tripoli",
    area: "ain_zara",
    slug: "ain-zara-palms",
    titleAr: "استراحة يوم كامل بمسبح — عين زارة",
    titleEn: "Day-use estiraha with pool — Ain Zara",
    baseNightly: 350_000,
    dayUse: 250_000,
    bedrooms: 2,
    maxGuests: 15,
    tier: "flexible",
    privacy: { walledPool: true, overlooked: true, separateFamilyEntrance: false, score: 45 },
    amenities: [gen(6), water("مياه الشبكة"), pool_],
    verified: true,
  });

  const hall = await mk({
    host: hallOwner!.id,
    type: "hall",
    nameAr: "قاعة الأندلس — طريق المطار",
    nameEn: "Al-Andalus Hall — Airport Road",
    city: "tripoli",
    area: "airport_road",
    slug: "andalus-hall-tripoli",
    titleAr: "قاعة أفراح ٥٠٠ ضيفة — طريق المطار",
    titleEn: "500-guest wedding hall — Airport Road",
    baseNightly: 0,
    capacityWomens: 500,
    capacityMens: 300,
    tier: "strict",
    amenities: [
      gen(60),
      { key: "bride_suite", present: true, condition: "good", detail: "جناح عروس مكيّف" },
      { key: "prayer_space", present: true },
      { key: "parking", present: true, detail: "موقف ٢٠٠ سيارة" },
      { key: "kosha", present: true, detail: "كوشة وإضاءة مسرحية مشمولة" },
    ],
    verified: true,
  });

  await db.insert(schema.packages).values([
    {
      listingId: hall.listing.id,
      nameAr: "الباقة الفضية — ٣٠٠ ضيفة",
      totalPrice: 18_000_000,
      guestCountMax: 300,
      lineItems: [
        { key: "kosha", labelAr: "كوشة وتنسيق", included: true },
        { key: "dinner", labelAr: "عشاء بوفيه", included: true, detailAr: "٣٠٠ وجبة" },
        { key: "dj", labelAr: "صوتيات وإضاءة", included: true },
        { key: "generator", labelAr: "مولّد احتياطي", included: true },
        { key: "photography", labelAr: "تصوير", included: false, extraPrice: 1_500_000 },
      ],
    },
    {
      listingId: hall.listing.id,
      nameAr: "الباقة الذهبية — ٥٠٠ ضيفة",
      totalPrice: 32_000_000,
      guestCountMax: 500,
      lineItems: [
        { key: "kosha", labelAr: "كوشة ملكية", included: true },
        { key: "dinner", labelAr: "عشاء فاخر", included: true, detailAr: "٥٠٠ وجبة" },
        { key: "dj", labelAr: "صوتيات وإضاءة", included: true },
        { key: "generator", labelAr: "مولّد احتياطي", included: true },
        { key: "bride_suite", labelAr: "جناح العروس", included: true },
        { key: "photography", labelAr: "تصوير وطباعة ألبوم", included: true },
      ],
    },
  ]);

  // Rail health baseline.
  for (const rail of ["sadad", "adfali", "local_card", "tlync", "mpgs"]) {
    await db
      .insert(schema.railHealth)
      .values({ rail, healthy: true })
      .onConflictDoNothing();
  }

  await syncServices();
  await syncServiceFacts();
  await syncMedia();
  await syncDemoTrust();
  await syncPartnerDemo();
  await syncLancaster();
  console.log("Seeded 3 coast venues + 1 wedding hall with packages. تشاو!");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
