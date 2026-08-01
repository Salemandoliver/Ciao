/**
 * Operator announcement bar.
 *
 * Set from the business console and shown across the public app. This is how
 * Ciao speaks to everyone at once when something is happening — a citywide
 * power cut, an Eid closure, a payment rail down — instead of letting guests
 * discover it one failed booking at a time.
 *
 * Renders nothing when there is nothing to say, so it costs an empty string
 * in the HTML on a normal day.
 *
 * The announcement itself is written by an operator, in Arabic, minutes before
 * it goes up. It is never translated here: a machine paraphrase of "the coast
 * road is closed tonight" is exactly the sentence you cannot afford to get
 * wrong, and a stale English version would be worse than none. So the text is
 * rendered as-is with `lang`/`dir` set, which keeps it legible and correctly
 * spoken inside an English page, while the chrome around it follows the
 * reader's language.
 */
import { API_URL } from "@/lib/api";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";

const copy = {
  ar: { paused: "الحجز متوقف مؤقتًا — التصفح متاح، وسنعود قريبًا." },
  en: { paused: "Booking is paused for now — browsing still works, and we will be back soon." },
} satisfies Record<Locale, unknown>;

export async function AnnouncementBar({ locale = DEFAULT_LOCALE }: { locale?: Locale } = {}) {
  const c = copy[locale];
  let text = "";
  let acceptingBookings = true;
  try {
    const res = await fetch(`${API_URL}/v1/settings/public`, { next: { revalidate: 60 } });
    if (res.ok) {
      const body = (await res.json()) as {
        announcementAr?: string;
        acceptingBookings?: boolean;
      };
      text = body.announcementAr?.trim() ?? "";
      acceptingBookings = body.acceptingBookings !== false;
    }
  } catch {
    /* the control plane being unreachable must never blank the app */
  }

  if (!text && acceptingBookings) return null;

  return (
    <div className="bg-amber text-sea-dark text-center text-sm py-1.5 px-4 font-bold">
      {text ? (
        <span lang="ar" dir="rtl">
          {text}
        </span>
      ) : null}
      {!acceptingBookings ? <span className={text ? "ms-2" : ""}>{c.paused}</span> : null}
    </div>
  );
}
