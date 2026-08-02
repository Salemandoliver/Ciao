"use client";
/**
 * The greeting above the hero.
 *
 * The home page is a cached server component (`revalidate = 300`), so this is
 * the one thing on it that is allowed to know who you are. It is a client
 * component for that reason, and a deliberately quiet one: it renders nothing
 * at all until it knows there is a session, so a logged-out visitor pays
 * nothing for it — no request, no reserved space, no flash of someone else's
 * name on a shared phone.
 *
 * Time of day comes from the **device** clock. A Libyan in Manchester opening
 * this at 8am should read «صباح الخير», not whatever hour it is in Tripoli.
 * That means it can only be computed after mount, which is also why nothing is
 * rendered on the server pass.
 */
import { useEffect, useState } from "react";
import { Link, useLocale } from "@/lib/locale";
import { api, hasSession, rememberDisplayName, storedDisplayName } from "@/lib/api";
import type { Locale } from "@/lib/i18n";

/**
 * Arabic has two greetings where English has three, so this is a function per
 * language rather than a shared set of keys — «مساء الخير» covers everything
 * from midday to midnight, and inventing a third Arabic greeting to match the
 * English shape would be a translation artefact, not Arabic.
 */
const copy = {
  ar: {
    timeOfDay: (hour: number) => (hour < 12 ? "صباح الخير" : "مساء الخير"),
    named: (greeting: string, name: string) => `${greeting}، ${name}`,
    nameless: (greeting: string) => `${greeting}، أهلاً بك`,
    addName: "أضف اسمك",
  },
  en: {
    timeOfDay: (hour: number) =>
      hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening",
    named: (greeting: string, name: string) => `${greeting}, ${name}`,
    nameless: (greeting: string) => `${greeting} — welcome back`,
    addName: "Add your name",
  },
} satisfies Record<Locale, unknown>;

export function Greeting() {
  const locale = useLocale();
  const c = copy[locale];
  /** `null` = we do not know yet, and while we do not know we render nothing. */
  const [hour, setHour] = useState<number | null>(null);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSession()) return; // logged out: no name, no request, no greeting

    const stored = storedDisplayName();
    if (stored) {
      setName(stored);
      setHour(new Date().getHours());
      return;
    }

    /*
     * No name cached — someone who signed in before this existed, or who
     * joined without one. `/v1/me` settles it and is cached for next time.
     * A failure here means no greeting rather than a half-greeting: an empty
     * space is honest, "Hello undefined" is a bug on the front page.
     */
    let live = true;
    api<{ displayName: string | null }>("/v1/me")
      .then((me) => {
        if (!live) return;
        rememberDisplayName(me.displayName);
        setName(storedDisplayName());
        setHour(new Date().getHours());
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (hour === null) return null;

  const greeting = c.timeOfDay(hour);
  return (
    <p className="pt-1 pb-2 text-sm text-muted">
      <span className="font-bold text-sea">
        {name ? c.named(greeting, name) : c.nameless(greeting)}
      </span>
      {/* Offered only to the people it applies to, and only as a link — a
          nameless member is not an incomplete member. */}
      {name ? null : (
        <>
          {" · "}
          <Link href="/account?tab=settings" className="text-link font-bold">
            {c.addName}
          </Link>
        </>
      )}
    </p>
  );
}
