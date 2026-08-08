/**
 * The brand message on the marketplace home page — read by everyone, written
 * from Ciao Business.
 *
 * Two audiences, two shapes. The public route answers one question — "what
 * should this page say right now" — and answers it with the finished sentence,
 * so the marketplace never has to know what a priority or an end date is. The
 * business routes are the content calendar: every message ever written, live,
 * queued or finished, with the scheduling fields intact.
 *
 * The selection rule itself is deliberately not here. It lives in
 * `@ciao/shared` because the composer's preview has to reach exactly the same
 * verdict as the page, and the only reliable way to guarantee that is to make
 * it literally the same function.
 */
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  libyaDay,
  pickBrandMessage,
  renderBrandMessage,
  type BrandMessage,
  type RenderedBrandMessage,
} from "@ciao/shared";
import { db, schema } from "../../db/client.js";
import { CiaoError } from "../../lib/errors.js";

/** The founder's standing copy, shipped so the band is never empty. */
export const STANDING_MESSAGE: BrandMessage = {
  id: "00000000-0000-0000-0000-000000000000",
  name: "الرسالة الثابتة",
  overlineAr: "لكل مناسبة، مكانها",
  overlineEn: "Every occasion has its place",
  headlineAr: "المكان الجميل يخلّي الذكرى",
  headlineEn: "The right place makes the memory",
  accentAr: "أجمل",
  accentEn: "better",
  bodyAr: "من أول جلسة عائلية إلى ليلة العمر، نقرّبك من أماكن يحبها أهل ليبيا ويثقون فيها.",
  bodyEn:
    "From the first family afternoon to the night of a lifetime, we bring you the places Libyans love and trust.",
  imageUrl: null,
  imageAltAr: null,
  imageAltEn: null,
  ctaLabelAr: null,
  ctaLabelEn: null,
  ctaHref: null,
  startsOn: null,
  endsOn: null,
  city: null,
  vertical: null,
  priority: -1000,
  active: true,
};

/*
 * Why the standing copy is a constant and not a seeded row.
 *
 * It has to survive an empty database, a failed migration and an operator who
 * retires every message in the list on a Thursday afternoon. A row can be
 * deleted; a constant compiled into the bundle cannot, so the worst state this
 * feature can reach is "the home page says what it said before the feature
 * existed". Its priority is far below anything anyone can type, so it loses to
 * every real message and wins only when there is nothing else.
 */

export const BrandMessageInput = z.object({
  name: z.string().min(1).max(80),
  overlineAr: z.string().max(120).nullish(),
  overlineEn: z.string().max(120).nullish(),
  headlineAr: z.string().min(1).max(160),
  headlineEn: z.string().max(160).nullish(),
  accentAr: z.string().max(60).nullish(),
  accentEn: z.string().max(60).nullish(),
  bodyAr: z.string().max(400).nullish(),
  bodyEn: z.string().max(400).nullish(),
  imageUrl: z.string().max(500).nullish(),
  imageAltAr: z.string().max(200).nullish(),
  imageAltEn: z.string().max(200).nullish(),
  ctaLabelAr: z.string().max(40).nullish(),
  ctaLabelEn: z.string().max(40).nullish(),
  /*
   * Somewhere on Ciao, or nowhere.
   *
   * A relative path only: an absolute URL here would turn the most prominent
   * band on the home page into an open redirect that a marketer can point
   * anywhere, and "market something" always means something of ours. The
   * leading slash and the refusal of `//` together stop `//evil.example`,
   * which a browser reads as a protocol-relative URL and follows off-site.
   */
  ctaHref: z
    .string()
    .max(200)
    .regex(/^\/(?!\/)[\w\-/?=&.#%]*$/u, "cta_href_must_be_a_ciao_path")
    .nullish(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  city: z.string().max(40).nullish(),
  vertical: z.enum(["coast", "hall", "service"]).nullish(),
  priority: z.number().int().min(0).max(100).default(0),
  active: z.boolean().default(true),
});

export type BrandMessageInput = z.infer<typeof BrandMessageInput>;

/**
 * Rules that are about meaning rather than shape, so Zod is the wrong place.
 *
 * Both exist because of the same failure: a message that looks saved and is
 * not on screen, with nothing anywhere to say why. A backwards window can
 * never be live on any day, and an accent word that is not the tail of the
 * headline renders as a gold word floating after a sentence that already
 * ended — the second is a design rule, so it warns rather than refuses.
 */
export function validateWindow(input: BrandMessageInput): void {
  if (input.startsOn && input.endsOn && input.endsOn < input.startsOn)
    throw new CiaoError("VALIDATION", "window_ends_before_it_starts");
}

const columns = {
  id: schema.brandMessages.id,
  name: schema.brandMessages.name,
  overlineAr: schema.brandMessages.overlineAr,
  overlineEn: schema.brandMessages.overlineEn,
  headlineAr: schema.brandMessages.headlineAr,
  headlineEn: schema.brandMessages.headlineEn,
  accentAr: schema.brandMessages.accentAr,
  accentEn: schema.brandMessages.accentEn,
  bodyAr: schema.brandMessages.bodyAr,
  bodyEn: schema.brandMessages.bodyEn,
  imageUrl: schema.brandMessages.imageUrl,
  imageAltAr: schema.brandMessages.imageAltAr,
  imageAltEn: schema.brandMessages.imageAltEn,
  ctaLabelAr: schema.brandMessages.ctaLabelAr,
  ctaLabelEn: schema.brandMessages.ctaLabelEn,
  ctaHref: schema.brandMessages.ctaHref,
  startsOn: schema.brandMessages.startsOn,
  endsOn: schema.brandMessages.endsOn,
  city: schema.brandMessages.city,
  vertical: schema.brandMessages.vertical,
  priority: schema.brandMessages.priority,
  active: schema.brandMessages.active,
};

/** Everything ever written, newest first. The content calendar. */
export async function listMessages(): Promise<(BrandMessage & { updatedAt: Date })[]> {
  const rows = await db
    .select({ ...columns, updatedAt: schema.brandMessages.updatedAt })
    .from(schema.brandMessages)
    .orderBy(desc(schema.brandMessages.priority), desc(schema.brandMessages.createdAt))
    .limit(200);
  return rows as (BrandMessage & { updatedAt: Date })[];
}

/**
 * The candidates for a given day, narrowed in SQL before the shared rule runs.
 *
 * The window is filtered here and the audience is not, on purpose: a day
 * comparison is an index range, while "city is null or city = $1" over a table
 * this small is noise either way — and leaving audience matching to the shared
 * function means there is exactly one implementation of it rather than one in
 * TypeScript and a second, subtly different one in SQL.
 */
async function liveCandidates(day: string): Promise<BrandMessage[]> {
  const rows = await db
    .select(columns)
    .from(schema.brandMessages)
    .where(
      and(
        eq(schema.brandMessages.active, true),
        or(isNull(schema.brandMessages.startsOn), sql`${schema.brandMessages.startsOn} <= ${day}`),
        or(isNull(schema.brandMessages.endsOn), sql`${schema.brandMessages.endsOn} >= ${day}`),
      ),
    )
    .limit(100);
  return rows as BrandMessage[];
}

export type ResolvedBrandMessage = RenderedBrandMessage & {
  id: string;
  /** True when nothing was scheduled and the standing copy is showing. */
  standing: boolean;
};

/**
 * What the page should say, already in the right language.
 *
 * The marketplace receives a finished sentence rather than a row, which keeps
 * the scheduling model — priorities, windows, targeting — entirely on this
 * side of the wire. A future change to how a winner is chosen then needs no
 * deploy of the web app at all.
 */
export async function resolveMessage(
  locale: "ar" | "en",
  at: { city?: string | null; vertical?: string | null },
  day = libyaDay(),
): Promise<ResolvedBrandMessage> {
  const candidates = await liveCandidates(day);
  const winner = pickBrandMessage([...candidates, STANDING_MESSAGE], day, at);
  const m = winner ?? STANDING_MESSAGE;
  return { ...renderBrandMessage(m, locale), id: m.id, standing: m.id === STANDING_MESSAGE.id };
}

export async function createMessage(
  input: BrandMessageInput,
  actorId: string,
): Promise<BrandMessage> {
  validateWindow(input);
  const [row] = await db
    .insert(schema.brandMessages)
    .values({ ...input, createdById: actorId })
    .returning(columns);
  return row as BrandMessage;
}

export async function updateMessage(
  id: string,
  input: BrandMessageInput,
): Promise<BrandMessage> {
  validateWindow(input);
  const [row] = await db
    .update(schema.brandMessages)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(schema.brandMessages.id, id))
    .returning(columns);
  if (!row) throw new CiaoError("VALIDATION", "brand_message_not_found");
  return row as BrandMessage;
}

/**
 * Retire rather than delete.
 *
 * A finished campaign is the record of what the country was told and when, and
 * next Eid it is the draft nobody has to write again. Deleting rows to mean
 * "not showing any more" also loses the distinction between a message that was
 * taken down and one that simply ran out — a distinction the composer draws,
 * and cannot draw from an absent row.
 */
export async function retireMessage(id: string): Promise<BrandMessage> {
  const [row] = await db
    .update(schema.brandMessages)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(schema.brandMessages.id, id))
    .returning(columns);
  if (!row) throw new CiaoError("VALIDATION", "brand_message_not_found");
  return row as BrandMessage;
}
