/**
 * Seed: realistic Phase A supply — Janzour–Tajoura coastal strip + Ain Zara
 * estirahas + one Tripoli wedding hall (design doc §14.2 anchor venues).
 * Idempotent: skips if seed data already present.
 */
import { eq } from "drizzle-orm";
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
          .set({ approxLat: c.lat, approxLng: c.lng, updatedAt: new Date() })
          .where(eq(schema.venues.id, row.venueId));
      }
    }
  }
  console.log("Listing media synced.");
}

async function main() {
  const [existing] = await db
    .select({ id: schema.listings.id })
    .from(schema.listings)
    .where(eq(schema.listings.slug, "janzour-marina-villa"))
    .limit(1);
  if (existing) {
    console.log("Seed data already present — syncing media only.");
    await syncMedia();
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

  await syncMedia();
  console.log("Seeded 3 coast venues + 1 wedding hall with packages. تشاو!");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
