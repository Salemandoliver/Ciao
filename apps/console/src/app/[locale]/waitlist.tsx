"use client";
/**
 * Waitlist — the people a sold-out unit turned away, and who to ring about it.
 *
 * A fully-booked unit used to vanish from a dated search, which threw away the
 * cleanest demand signal a marketplace gets: a named person who wanted a
 * specific place on specific dates and could not have it. This screen is the
 * ops side of that list, and it is built around one number.
 *
 * **The count per unit is the headline, not the row.** A single person waiting
 * on a chalet is weather. Three people waiting on the same chalet is a
 * sentence you can say out loud to its owner — "four families asked for your
 * duplex last month, open more dates" — and it is also the argument for
 * signing the resort next door. So rows are grouped by listing and the groups
 * are ordered by how many people are still waiting, never by recency. The
 * newest request is rarely the most useful one on this page.
 *
 * **The waiting count ignores the filter.** Filtering to «converted» must not
 * quietly redefine demand as "the ones who eventually booked". The count beside
 * a unit always means people still waiting on it right now, whatever slice the
 * chips are showing.
 *
 * **Everything is fetched once and sliced here.** The endpoint takes a
 * `?status=`, but both numbers this screen exists for — the chip counts and the
 * per-unit demand — need the whole set, and asking for four slices to add them
 * back up is three requests too many. The server caps the response at 300 rows;
 * if this list ever runs past that, paging it is a good problem and a later
 * commit.
 *
 * Phone numbers again, so `catalogue` again: unmet demand is a supply fact
 * before it is anything else, and finance's remit is the books.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { localPhone } from "@ciao/shared";
import type { Locale } from "@/lib/i18n";
import { CITIES, fmtDate, term } from "@/lib/vocab";
import { Pill, Section } from "./lib";

interface WaitRow {
  id: string;
  phone: string;
  checkIn: string | null;
  checkOut: string | null;
  guests: number | null;
  status: string;
  createdAt: string;
  listingId: string;
  titleAr: string | null;
  venueNameAr: string | null;
  city: string | null;
}

const STATUSES = ["waiting", "notified", "converted", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

/** Same temperature reading as the leads queue: open → worked → won / lost. */
const TONE: Record<Status, "amber" | "sand" | "green" | "red"> = {
  waiting: "amber",
  notified: "sand",
  converted: "green",
  cancelled: "red",
};

/**
 * Where a queue stops being a coincidence. Below three, a unit is popular;
 * at three the group header goes amber, because that is the point where the
 * call to the owner pays for itself.
 */
const CROWD = 3;

const copy = {
  ar: {
    title: "قائمة الانتظار",
    hint: "ناس طلبوا وحدة كانت محجوزة وخلّوا أرقامهم. العدد اللي جنب كل وحدة هو سبب المكالمة لصاحبها.",
    empty:
      "ما فيش أحد في الانتظار. الاسم يوصل هنا لما وحدة تكون محجوزة بالكامل ويطلب واحد نخبّروه أول ما تتفرّغ.",
    emptyFiltered: "ما فيش أحد في هذي الحالة.",
    all: "الكل",
    status: {
      waiting: "في الانتظار",
      notified: "تم إبلاغه",
      converted: "حجز",
      cancelled: "ألغى",
    } as Record<Status, string>,
    waitingHere: (n: number) => (n === 1 ? "واحد في الانتظار" : `${n} في الانتظار`),
    unknownUnit: "وحدة غير معروفة",
    noDates: "بدون تواريخ",
    nights: (n: number) => (n === 1 ? "ليلة" : n === 2 ? "ليلتين" : `${n} ليالٍ`),
    guests: (n: number) => (n === 1 ? "ضيف واحد" : n === 2 ? "ضيفين" : `${n} ضيوف`),
    today: "اليوم",
    yesterday: "أمس",
    daysAgo: (n: number) => `قبل ${n} يوم`,
    failed: "ما تمّش الحفظ. حاول مرة أخرى.",
    forbidden: "ما عندكش صلاحية لهذا.",
  },
  en: {
    title: "Waitlist",
    hint: "People who asked for a unit that was already taken. The number beside a unit is the reason to ring its owner.",
    empty:
      "Nobody is waiting. Names land here when a unit is fully booked and someone asks to be told the moment it frees up.",
    emptyFiltered: "Nobody in that state.",
    all: "All",
    status: {
      waiting: "Waiting",
      notified: "Told",
      converted: "Booked",
      cancelled: "Dropped",
    } as Record<Status, string>,
    waitingHere: (n: number) => `${n} waiting`,
    unknownUnit: "Unknown unit",
    noDates: "No dates given",
    nights: (n: number) => `${n} night${n === 1 ? "" : "s"}`,
    guests: (n: number) => `${n} guest${n === 1 ? "" : "s"}`,
    today: "Today",
    yesterday: "Yesterday",
    daysAgo: (n: number) => `${n} days ago`,
    failed: "That didn't save. Try again.",
    forbidden: "You don't have permission for that.",
  },
} satisfies Record<Locale, unknown>;

export function WaitlistTab() {
  const locale = useLocale();
  const t = copy[locale];
  const [items, setItems] = useState<WaitRow[]>([]);
  const [filter, setFilter] = useState<Status | "">("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: WaitRow[] }>("/v1/biz/waitlist");
      setItems(r.items);
      setError("");
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? t.forbidden : t.failed);
    }
  }, [t.forbidden, t.failed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(id: string, status: Status) {
    try {
      await api(`/v1/biz/waitlist/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setError("");
      await load();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? t.forbidden : t.failed);
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const row of items) c[row.status] = (c[row.status] ?? 0) + 1;
    return c;
  }, [items]);

  const groups = useMemo(() => {
    // Live demand, computed off the whole set so the chips can't change it.
    const waiting = new Map<string, number>();
    for (const row of items) {
      if (row.status === "waiting")
        waiting.set(row.listingId, (waiting.get(row.listingId) ?? 0) + 1);
    }

    const shown = filter ? items.filter((row) => row.status === filter) : items;
    const byListing = new Map<string, WaitRow[]>();
    for (const row of shown) {
      const bucket = byListing.get(row.listingId);
      if (bucket) bucket.push(row);
      else byListing.set(row.listingId, [row]);
    }

    return [...byListing.entries()]
      .map(([listingId, rows]) => {
        const sorted = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return {
          listingId,
          rows: sorted,
          waiting: waiting.get(listingId) ?? 0,
          // Every row in a group carries the same venue, so the first one
          // labels the whole group.
          head: sorted[0] as WaitRow,
        };
      })
      .sort(
        (a, b) =>
          b.waiting - a.waiting || b.head.createdAt.localeCompare(a.head.createdAt),
      );
  }, [items, filter]);

  const total = items.length;

  return (
    <Section title={t.title} hint={t.hint}>
      <div className="flex flex-wrap gap-2 mb-4">
        <FilterChip label={`${t.all} (${total})`} on={filter === ""} onClick={() => setFilter("")} />
        {STATUSES.map((s) => (
          <FilterChip
            key={s}
            label={`${t.status[s]} (${counts[s] ?? 0})`}
            on={filter === s}
            onClick={() => setFilter(s)}
          />
        ))}
      </div>

      {error ? <p className="text-danger text-sm font-bold mb-3">{error}</p> : null}

      {groups.length === 0 ? (
        <p className="text-faint text-sm">{total === 0 ? t.empty : t.emptyFiltered}</p>
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => (
            <li key={g.listingId} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-sea truncate text-start">
                    {g.head.venueNameAr ?? t.unknownUnit}
                  </p>
                  <p className="text-xs text-muted truncate text-start">
                    {g.head.titleAr ?? ""}
                    {g.head.city ? ` · ${term(CITIES, locale, g.head.city)}` : ""}
                  </p>
                </div>
                {/* The count is the whole point of the grouping, so it is the
                    only thing on this row that carries a colour. */}
                {g.waiting > 0 ? (
                  <Pill tone={g.waiting >= CROWD ? "amber" : "sand"}>
                    {t.waitingHere(g.waiting)}
                  </Pill>
                ) : null}
              </div>

              <ul className="mt-3 space-y-3 border-s-2 border-sand ps-3">
                {g.rows.map((row) => (
                  <li key={row.id}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        {/* Latin digits, local 09… form, selectable: an agent
                            is going to copy this into WhatsApp. */}
                        <p dir="ltr" className="font-bold text-sea text-start select-all">
                          {localPhone(row.phone)}
                        </p>
                        <p className="text-xs text-muted text-start">
                          {dateLabel(locale, t, row)}
                          {row.guests ? ` · ${t.guests(row.guests)}` : ""}
                        </p>
                        <p className="text-[11px] text-faint text-start">{since(t, row.createdAt)}</p>
                      </div>
                      <Pill tone={TONE[row.status as Status] ?? "sand"}>
                        {t.status[row.status as Status] ?? row.status}
                      </Pill>
                    </div>

                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {STATUSES.map((s) => (
                        <button
                          key={s}
                          disabled={row.status === s}
                          onClick={() => void setStatus(row.id, s)}
                          className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                            row.status === s
                              ? "bg-amber text-sea-dark"
                              : "bg-sand text-muted hover:text-sea"
                          }`}
                        >
                          {t.status[s]}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * The dates asked for, or an honest admission that none were.
 *
 * Most rows arrive without dates, because the storefront asks a family for a
 * phone number and nothing else — one field is the reason people finish that
 * form at all. A dateless row means "any dates", which is worth knowing rather
 * than hiding behind a dash.
 */
function dateLabel(locale: Locale, t: (typeof copy)[Locale], row: WaitRow): string {
  if (!row.checkIn) return t.noDates;
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  const from = fmtDate(locale, row.checkIn, opts);
  if (!row.checkOut) return from;
  const nights = Math.round(
    (new Date(`${row.checkOut}T00:00:00Z`).getTime() -
      new Date(`${row.checkIn}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  // An en dash rather than an arrow: an arrow points the wrong way the moment
  // the console is read in Arabic.
  return `${from} – ${fmtDate(locale, row.checkOut, opts)}${
    nights > 0 ? ` · ${t.nights(nights)}` : ""
  }`;
}

/** Age in whole days — the resolution at which "ring them back" is decided. */
function since(t: (typeof copy)[Locale], createdAt: string): string {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
  if (days <= 0) return t.today;
  if (days === 1) return t.yesterday;
  return t.daysAgo(days);
}

function FilterChip({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
        on ? "bg-sea text-white" : "bg-sand text-muted hover:text-sea"
      }`}
    >
      {label}
    </button>
  );
}
