"use client";
/**
 * Everything the platform knows about one business, on one screen.
 *
 * The catalogue table answers "which of our two hundred listings needs
 * attention today". It cannot answer "what is the state of this one", and
 * until now nothing could: the row exposed four buttons and the rest of the
 * record — the rate card, the party rules, the check-in times, the office
 * hours, the storefront link, the booking history, the verification trail —
 * existed only in the database. An operator taking a call from a resort had
 * nothing to read from.
 *
 * The endpoint behind this has existed since the console was built and was
 * never called by anything, which is its own small lesson: a detail API with
 * no detail screen is a feature nobody has.
 *
 * ## The invite
 *
 * The most consequential control here is the smallest. A host account is
 * created when the business is onboarded, but deliberately without a password
 * — nobody at Ciao ever chooses a partner's credential, which is the property
 * that lets us tell a resort owner that nobody here can get into their
 * account. The consequence is that a newly onboarded partner cannot sign in
 * until somebody issues them a one-time link, and there was no button for that
 * anywhere in this product. It was an API call, which in practice meant it did
 * not happen.
 *
 * The link is shown rather than only sent, because messaging is not live yet
 * and because the supply team is usually on the phone to the partner when they
 * do this. It is a credential for a week, so it is displayed once, on demand,
 * with what it is written next to it.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, fmtLyd, mediaSrc } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import type { Locale } from "@/lib/i18n";
import { Pill, Section } from "@/components/panel";
import {
  AREAS,
  BOARD,
  CITIES,
  LISTING_STATUS,
  REQUIREMENTS,
  ROLES,
  UNIT_KINDS_LABEL,
  VERTICALS,
  term,
} from "@/lib/vocab";

interface Detail {
  listing: Record<string, unknown>;
  venue: Record<string, unknown>;
  host: {
    id: string;
    phone: string;
    name?: string | null;
    role: string;
    hasPassword: boolean;
  } | null;
  bookings: {
    id: string;
    code: string;
    state: string;
    total: number;
    checkIn: string | null;
    createdAt: string;
  }[];
  verifications: { id: string; state?: string; createdAt: string }[];
  mediaBase: string;
}

const copy = {
  ar: {
    close: "إغلاق",
    loading: "…",
    failed: "تعذر تحميل التفاصيل",
    overview: "نظرة عامة",
    pricing: "التسعير",
    rules: "الشروط والاستقبال",
    storefront: "صفحة المكان",
    hostPanel: "صاحب المكان",
    bookingsPanel: "آخر الحجوزات",
    verificationsPanel: "المعاينات",
    photos: "الصور",
    noPhotos: "لا توجد صور",
    baseNightly: "السعر الأساسي / الليلة",
    weekend: "زيادة نهاية الأسبوع",
    thursday: "زيادة الخميس",
    dayUse: "دخول يومي",
    included: "السعر يشمل",
    extraGuest: "ضيف إضافي",
    extraBed: "سرير إضافي",
    minNights: "أقل عدد ليالٍ",
    board: "نظام الإقامة",
    guests: (n: number) => `${n} ضيوف`,
    capacity: "السعة",
    bedrooms: "غرف النوم",
    bathrooms: "الحمامات",
    checkIn: "الدخول",
    checkOut: "الخروج",
    childPolicy: "سياسة الأطفال",
    childPolicyText: (free: number, red: number, bps: number) =>
      `مجاني تحت ${free} سنوات · خصم ${bps / 100}% تحت ${red} سنوات`,
    officeHours: "مكتب الحجوزات",
    officeHoursText: (from: string, to: string) => `يوميًا من ${from} إلى ${to}`,
    officeHoursNone: "غير محدد",
    requirements: "شروط لازمة",
    noRequirements: "لا شروط خاصة",
    slug: "رابط الصفحة",
    noSlug: "لا يوجد رابط بعد — أضف slug للمكان حتى يحصل الشريك على رابط لصفحته على فيسبوك",
    copy: "انسخ",
    copied: "✅ نُسخ",
    open: "افتح",
    name: "الاسم",
    phone: "الهاتف",
    role: "الدور",
    canSignIn: "يقدر يدخل لوحة الشريك",
    cannotSignIn: "ما عندهش كلمة سر — ما يقدرش يدخل",
    invite: "أرسل رابط إنشاء كلمة السر",
    reinvite: "أرسل رابطًا جديدًا",
    inviting: "…",
    inviteFailed: "تعذر إنشاء الرابط",
    linkTitle: "رابط إنشاء كلمة السر",
    linkNote:
      "صالح لمدة أسبوع ولمرة واحدة. أرسله للشريك بنفسك — هو يختار كلمة السر، ولا أحد عندنا يعرفها.",
    noHost: "لا يوجد حساب مالك مرتبط",
    noBookings: "لا حجوزات بعد",
    noVerifications: "لا معاينات مسجلة",
    verified: "موثّق",
    notVerified: "غير موثّق",
  },
  en: {
    close: "Close",
    loading: "…",
    failed: "Could not load the details",
    overview: "Overview",
    pricing: "Pricing",
    rules: "Rules and reception",
    storefront: "Venue page",
    hostPanel: "Owner",
    bookingsPanel: "Recent bookings",
    verificationsPanel: "Field visits",
    photos: "Photos",
    noPhotos: "No photos",
    baseNightly: "Base rate / night",
    weekend: "Weekend uplift",
    thursday: "Thursday uplift",
    dayUse: "Day use",
    included: "Rate covers",
    extraGuest: "Extra guest",
    extraBed: "Extra bed",
    minNights: "Minimum nights",
    board: "Board",
    guests: (n: number) => `${n} guests`,
    capacity: "Capacity",
    bedrooms: "Bedrooms",
    bathrooms: "Bathrooms",
    checkIn: "Check-in",
    checkOut: "Check-out",
    childPolicy: "Children",
    childPolicyText: (free: number, red: number, bps: number) =>
      `Free under ${free} · ${bps / 100}% off under ${red}`,
    officeHours: "Booking office",
    officeHoursText: (from: string, to: string) => `Daily ${from} to ${to}`,
    officeHoursNone: "Not set",
    requirements: "Requirements",
    noRequirements: "No special requirements",
    slug: "Page link",
    noSlug:
      "No link yet — give the venue a slug so its owner has something to pin to their Facebook page",
    copy: "Copy",
    copied: "✅ Copied",
    open: "Open",
    name: "Name",
    phone: "Phone",
    role: "Role",
    canSignIn: "Can sign in to the partner panel",
    cannotSignIn: "No password — cannot sign in",
    invite: "Send set-password link",
    reinvite: "Issue a new link",
    inviting: "…",
    inviteFailed: "Could not create the link",
    linkTitle: "Set-password link",
    linkNote:
      "Valid for a week, single use. Send it to the partner yourself — they choose the password and nobody here ever knows it.",
    noHost: "No owner account linked",
    noBookings: "No bookings yet",
    noVerifications: "No field visits recorded",
    verified: "Verified",
    notVerified: "Not verified",
  },
} satisfies Record<Locale, unknown>;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** A label/value pair. Values that are absent are simply not rendered. */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-sand/60 last:border-0">
      <span className="text-xs text-muted shrink-0">{label}</span>
      <span className="text-sm font-bold text-sea text-end">{value}</span>
    </div>
  );
}

export function BusinessDetail({
  listingId,
  webBase,
  onClose,
}: {
  listingId: string;
  webBase?: string;
  onClose: () => void;
}) {
  const locale = useLocale();
  const c = copy[locale];
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState("");
  const [link, setLink] = useState("");
  const [inviting, setInviting] = useState(false);
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    try {
      setD(await api<Detail>(`/v1/biz/businesses/${listingId}`));
    } catch {
      setErr(copy[locale].failed);
    }
  }, [listingId, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite() {
    if (!d?.host) return;
    setInviting(true);
    setErr("");
    try {
      const res = await api<{ link: string }>(`/v1/biz/partners/${d.host.id}/invite`, {
        method: "POST",
        // Not sent by the platform: messaging is not live, and the supply team
        // is on the phone to the partner when they do this anyway. Showing the
        // link is the honest version of what actually happens.
        body: JSON.stringify({ send: false }),
      });
      setLink(res.link);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : c.inviteFailed);
    } finally {
      setInviting(false);
    }
  }

  async function copyText(text: string, tag: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      /* clipboard denied — the text is on screen and selectable */
    }
  }

  const l = d?.listing ?? {};
  const v = d?.venue ?? {};
  const slug = str(v.slug);
  const base = (webBase ?? d?.mediaBase ?? "").replace(/\/+$/, "");
  const storefront = slug && base ? `${base}/v/${slug}` : "";
  const media = Array.isArray(l.media) ? (l.media as { url: string; thumbUrl?: string }[]) : [];
  const office = (v.officeHours ?? null) as { from?: string; to?: string } | null;
  const requirements = Array.isArray(l.requirements) ? (l.requirements as unknown[]) : [];

  return (
    <div
      className="fixed inset-0 z-50 bg-sea-dark/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-surface w-full sm:max-w-4xl max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-bubble shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface/95 backdrop-blur border-b border-sand px-4 py-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-bold text-sea truncate" lang="ar" dir="rtl">
              {str(l.titleAr) ?? c.loading}
            </h2>
            <p className="text-[11px] text-faint truncate">
              {str(v.nameAr)} ·{" "}
              {str(v.area) ? term(AREAS, locale, String(v.area)) : term(CITIES, locale, String(v.city ?? ""))}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={c.close}
            className="w-8 h-8 rounded-full bg-sand text-sea font-bold shrink-0"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3">
          {err ? <p className="text-sm font-bold text-danger">{err}</p> : null}
          {!d ? (
            <p className="text-sm text-faint">{c.loading}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Pill tone={l.status === "live" ? "green" : l.status === "draft" ? "sand" : "slate"}>
                  {term(LISTING_STATUS, locale, String(l.status ?? ""))}
                </Pill>
                <Pill tone="slate">
                  {term(
                    VERTICALS,
                    locale,
                    str(l.serviceCategory) ? "service" : String(v.type ?? ""),
                  )}
                </Pill>
                {str(l.unitKind) ? (
                  <Pill tone="sand">{term(UNIT_KINDS_LABEL, locale, String(l.unitKind))}</Pill>
                ) : null}
                <Pill tone={v.verifiedAt && !v.badgeRevoked ? "green" : "red"}>
                  {v.verifiedAt && !v.badgeRevoked ? c.verified : c.notVerified}
                </Pill>
              </div>

              {/* The storefront link, which is the object a partner actually
                  wants from us — so it is shown at the top, with the honest
                  message when the venue has no slug yet. */}
              <Section title={c.storefront}>
                {storefront ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <code
                      dir="ltr"
                      className="text-xs bg-sand rounded-lg px-2 py-1 break-all flex-1 min-w-0"
                    >
                      {storefront}
                    </code>
                    <button className="chip shrink-0" onClick={() => copyText(storefront, "sf")}>
                      {copied === "sf" ? c.copied : c.copy}
                    </button>
                    <a
                      className="chip shrink-0"
                      href={storefront}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {c.open}
                    </a>
                  </div>
                ) : (
                  <p className="text-xs text-muted leading-relaxed">{c.noSlug}</p>
                )}
              </Section>

              <div className="grid gap-3 sm:grid-cols-2">
                <Section title={c.pricing}>
                  <Row
                    label={c.baseNightly}
                    value={num(l.baseNightly) !== null ? fmtLyd(Number(l.baseNightly), locale) : null}
                  />
                  <Row
                    label={c.weekend}
                    value={
                      num(l.weekendSupplement)
                        ? `+${fmtLyd(Number(l.weekendSupplement), locale)}`
                        : num(l.weekendMultiplierBps)
                          ? `×${(Number(l.weekendMultiplierBps) / 10000).toFixed(2)}`
                          : null
                    }
                  />
                  <Row
                    label={c.thursday}
                    value={
                      num(l.thursdaySupplement)
                        ? `+${fmtLyd(Number(l.thursdaySupplement), locale)}`
                        : num(l.thursdayMultiplierBps)
                          ? `×${(Number(l.thursdayMultiplierBps) / 10000).toFixed(2)}`
                          : null
                    }
                  />
                  <Row
                    label={c.dayUse}
                    value={num(l.dayUsePrice) ? fmtLyd(Number(l.dayUsePrice), locale) : null}
                  />
                  <Row
                    label={c.included}
                    value={num(l.includedGuests) ? c.guests(Number(l.includedGuests)) : null}
                  />
                  <Row
                    label={c.extraGuest}
                    value={num(l.extraGuestFee) ? fmtLyd(Number(l.extraGuestFee), locale) : null}
                  />
                  <Row
                    label={c.extraBed}
                    value={num(l.extraBedPrice) ? fmtLyd(Number(l.extraBedPrice), locale) : null}
                  />
                  <Row label={c.minNights} value={num(l.minNights)} />
                  <Row
                    label={c.board}
                    value={str(l.boardBasis) ? term(BOARD, locale, String(l.boardBasis)) : null}
                  />
                </Section>

                <Section title={c.rules}>
                  <Row label={c.capacity} value={num(l.maxGuests)} />
                  <Row label={c.bedrooms} value={num(l.bedrooms)} />
                  <Row label={c.bathrooms} value={num(l.bathrooms)} />
                  <Row label={c.checkIn} value={str(l.checkInTime)} />
                  <Row label={c.checkOut} value={str(l.checkOutTime)} />
                  <Row
                    label={c.childPolicy}
                    value={
                      num(l.childFreeUnder) !== null && num(l.childReducedUnder) !== null
                        ? c.childPolicyText(
                            Number(l.childFreeUnder),
                            Number(l.childReducedUnder),
                            Number(l.childReducedBps ?? 0),
                          )
                        : null
                    }
                  />
                  <Row
                    label={c.officeHours}
                    value={
                      office?.from && office?.to
                        ? c.officeHoursText(office.from, office.to)
                        : c.officeHoursNone
                    }
                  />
                  <Row
                    label={c.requirements}
                    value={
                      requirements.length
                        ? requirements
                            .map((r) =>
                              term(
                                REQUIREMENTS,
                                locale,
                                String((r as { key?: string }).key ?? ""),
                              ),
                            )
                            .filter(Boolean)
                            .join(" · ")
                        : c.noRequirements
                    }
                  />
                </Section>
              </div>

              <Section title={c.hostPanel}>
                {!d.host ? (
                  <p className="text-xs text-muted">{c.noHost}</p>
                ) : (
                  <>
                    <Row label={c.name} value={d.host.name} />
                    <Row label={c.phone} value={<span dir="ltr">{d.host.phone}</span>} />
                    <Row label={c.role} value={term(ROLES, locale, d.host.role)} />
                    <p
                      className={`text-xs font-bold mt-2 ${
                        d.host.hasPassword ? "text-sea" : "text-danger"
                      }`}
                    >
                      {d.host.hasPassword ? c.canSignIn : c.cannotSignIn}
                    </p>
                    <button
                      className="btn-primary !py-1.5 !px-4 !text-sm mt-2 disabled:opacity-40"
                      disabled={inviting}
                      onClick={invite}
                    >
                      {inviting ? c.inviting : d.host.hasPassword ? c.reinvite : c.invite}
                    </button>
                    {link ? (
                      <div className="mt-3 rounded-xl bg-sand p-3">
                        <p className="text-xs font-bold text-sea">{c.linkTitle}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <code
                            dir="ltr"
                            className="text-[11px] bg-surface rounded-lg px-2 py-1 break-all flex-1 min-w-0"
                          >
                            {link}
                          </code>
                          <button className="chip shrink-0" onClick={() => copyText(link, "inv")}>
                            {copied === "inv" ? c.copied : c.copy}
                          </button>
                        </div>
                        <p className="text-[11px] text-muted mt-2 leading-relaxed">{c.linkNote}</p>
                      </div>
                    ) : null}
                  </>
                )}
              </Section>

              <Section title={c.photos}>
                {media.length === 0 ? (
                  <p className="text-xs text-danger font-bold">{c.noPhotos}</p>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {media.map((m) => (
                      <div key={m.url} className="rounded-lg overflow-hidden bg-sand">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={mediaSrc(m.thumbUrl ?? m.url, d.mediaBase)}
                          alt=""
                          loading="lazy"
                          className="w-full h-16 object-cover"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              <Section title={c.bookingsPanel}>
                {d.bookings.length === 0 ? (
                  <p className="text-xs text-faint">{c.noBookings}</p>
                ) : (
                  <table className="w-full text-xs">
                    <tbody>
                      {d.bookings.map((b) => (
                        <tr key={b.id} className="border-t border-sand/60">
                          <td className="py-1 font-mono" dir="ltr">
                            {b.code}
                          </td>
                          <td className="py-1">{b.state}</td>
                          <td className="py-1" dir="ltr">
                            {b.checkIn ?? "—"}
                          </td>
                          <td className="py-1 text-end font-bold text-sea">
                            {fmtLyd(b.total, locale)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>

              <Section title={c.verificationsPanel}>
                {d.verifications.length === 0 ? (
                  <p className="text-xs text-faint">{c.noVerifications}</p>
                ) : (
                  <ul className="text-xs space-y-1">
                    {d.verifications.map((x) => (
                      <li key={x.id} className="flex justify-between gap-2">
                        <span>{x.state ?? "—"}</span>
                        <span className="text-faint" dir="ltr">
                          {x.createdAt.slice(0, 10)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
