"use client";
/**
 * "What's nearby" — the six lines our agent wrote standing outside the gate.
 *
 * The obvious version of this section is a Places API call and a list of pins.
 * That was rejected on the server side (see the API's `listings/neighbours.ts`)
 * and the UI has to hold up the same argument, because a layout that leads
 * with the name and the distance IS the generic POI list, whatever the data
 * behind it cost to collect.
 *
 * So the sentence leads. «قسم عائلي في الطابق الأول» is the reason a family
 * picks this estiraha over the one next door; the café's name is not, and the
 * fact that it is 400 metres away is available from any map. Name, kind and
 * walking time drop to the meta line underneath, where they belong.
 *
 * A client component only so the directions link can be counted. Everything it
 * renders comes from props, so it still ships in the server-rendered HTML and
 * search engines see the prose — which is worth having, given the prose is the
 * part no competitor can copy.
 */
import { hostText, textProps } from "@/lib/content";
import { useLocale } from "@/lib/locale";
import { trackClient } from "@/lib/tracker";
import type { NeighbourRecord } from "@/lib/types";
import { NEIGHBOUR_KINDS_LABELS, NEIGHBOUR_KIND_EMOJI, fmtDate, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";

const copy = {
  ar: {
    heading: "ما حول المكان",
    /*
     * The provenance line. It is the whole competitive point of this section,
     * so it says who and when in one breath and then gets out of the way — a
     * paragraph defending the data would make it look like it needed defending.
     */
    sourceDated: (when: string) => `سجّلها مندوب تشاو بنفسه أثناء زيارة التوثيق يوم ${when}.`,
    source: "سجّلها مندوب تشاو بنفسه أثناء زيارة التوثيق للمكان.",
    walk: (n: number) =>
      n === 1 ? "دقيقة مشي" : n === 2 ? "دقيقتين مشي" : `${n} ${n <= 10 ? "دقائق" : "دقيقة"} مشي`,
    drive: (n: number) =>
      n === 1
        ? "دقيقة بالسيارة"
        : n === 2
          ? "دقيقتين بالسيارة"
          : `${n} ${n <= 10 ? "دقائق" : "دقيقة"} بالسيارة`,
    directions: "الطريق ↗",
    directionsFor: (name: string) => `افتح الطريق إلى ${name} في تطبيق الخرائط`,
  },
  en: {
    heading: "What's nearby",
    sourceDated: (when: string) =>
      `Written down by the Ciao agent who visited this place on ${when} — not taken from a map.`,
    source: "Written down by the Ciao agent who visited this place — not taken from a map.",
    walk: (n: number) => `${n} min walk`,
    drive: (n: number) => `${n} min drive`,
    directions: "Directions ↗",
    directionsFor: (name: string) => `Open directions to ${name} in your maps app`,
  },
} satisfies Record<Locale, unknown>;

/**
 * Coordinates, never a name — the same rule the API's `navigationUrl` follows.
 * Half the bakeries on this coast road share a name; the pin is the point.
 */
function directionsUrl(lat: string, lng: string): string {
  const params = new URLSearchParams({ api: "1", destination: `${lat},${lng}` });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function Nearby({
  listingId,
  neighbours,
  verifiedAt,
}: {
  listingId: string;
  neighbours?: NeighbourRecord[];
  verifiedAt?: string;
}) {
  const locale = useLocale();
  const c = copy[locale];

  // Nothing recorded yet is not a state worth a box. An empty "coming soon"
  // panel advertises the gap on every listing an agent has not reached.
  if (!neighbours?.length) return null;

  return (
    <div className="card p-4">
      <h2 className="font-bold text-sea">{c.heading}</h2>
      <p className="text-xs text-faint mt-0.5">
        {verifiedAt
          ? c.sourceDated(fmtDate(locale, verifiedAt, { month: "long", year: "numeric" }))
          : c.source}
      </p>

      <ul className="divide-y divide-sand mt-2">
        {neighbours.map((n, i) => {
          const name = hostText(locale, n.nameAr, n.nameEn);
          const note = hostText(locale, n.noteAr, n.noteEn);
          // The glyph is decorative, so the kind stays in text beside it —
          // it is what a screen reader has to work from, and it is the word
          // someone scanning six rows is actually looking for.
          const kind = term(NEIGHBOUR_KINDS_LABELS, locale, n.kind);
          const distance = [
            n.walkMinutes ? c.walk(n.walkMinutes) : "",
            n.driveMinutes ? c.drive(n.driveMinutes) : "",
          ].filter(Boolean);
          const url = n.lat && n.lng ? directionsUrl(n.lat, n.lng) : null;
          return (
            <li key={`${n.kind}-${i}`} className="flex items-start gap-3 py-3">
              <span aria-hidden className="text-xl leading-none mt-0.5">
                {NEIGHBOUR_KIND_EMOJI[n.kind] ?? "📍"}
              </span>
              <div className="min-w-0 flex-1">
                {/* The line the agent wrote, at the weight it earned. Where
                    there is no note the name takes the slot rather than
                    leaving a heading-shaped hole above the meta line. */}
                {note ? (
                  <p className="font-bold text-sea leading-snug" {...textProps(note)}>
                    {note.text}
                  </p>
                ) : name ? (
                  <p className="font-bold text-sea leading-snug" {...textProps(name)}>
                    {name.text}
                  </p>
                ) : null}
                <p className="text-xs text-muted mt-0.5">
                  {kind}
                  {note && name ? (
                    <>
                      {" · "}
                      <span {...textProps(name)}>{name.text}</span>
                    </>
                  ) : null}
                  {distance.length ? ` · ${distance.join(" · ")}` : ""}
                </p>
              </div>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={c.directionsFor(name?.text ?? "")}
                  className="chip shrink-0 font-bold"
                  onClick={() =>
                    trackClient("navigation.opened", {
                      listingId,
                      target: "neighbour",
                      kind: n.kind,
                    })
                  }
                >
                  {c.directions}
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
