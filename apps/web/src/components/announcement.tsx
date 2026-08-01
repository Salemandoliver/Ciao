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
 */
import { API_URL } from "@/lib/api";

export async function AnnouncementBar() {
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
      {text ? <span>{text}</span> : null}
      {!acceptingBookings ? (
        <span className={text ? "ms-2" : ""}>
          الحجز متوقف مؤقتًا — التصفح متاح، وسنعود قريبًا.
        </span>
      ) : null}
    </div>
  );
}
