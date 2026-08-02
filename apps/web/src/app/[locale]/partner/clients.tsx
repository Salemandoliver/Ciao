"use client";
/**
 * The customer book — theirs, not ours.
 *
 * This is a partner's own contact list, often carried over from years before
 * Ciao existed. So the screen says the promise out loud rather than burying it
 * in a policy: we never market to these people, and we never contact them. If
 * that were not true the list would stay empty, and a partner who suspects
 * otherwise will simply keep using their phone's contacts.
 *
 * The number that makes the screen worth opening is "booked with you 4 times".
 * Nobody keeps that by hand across three years of a notebook, and it is the
 * thing that turns a customer list into a business asset.
 */
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, fmtLyd } from "@/lib/api";
import { useLocale } from "@/lib/locale";
import { UI, fmtDate, term } from "@/lib/vocab";
import type { Locale } from "@/lib/i18n";
import { Section } from "@/components/panel";
import type { PartnerClient, PartnerMe } from "./types";

const copy = {
  ar: {
    title: "زبائنك",
    hint: "دفتر زبائنك أنت. تشاو ما ترسل لهم أي إعلانات وما تتواصل معهم — البيانات هذي لك وحدك.",
    search: "ابحث بالاسم أو الرقم",
    empty: "ما عندك زبائن مسجّلين بعد.",
    add: "أضف زبون",
    name: "الاسم",
    phone: "الرقم",
    notes: "ملاحظات",
    save: "احفظ",
    jobs: (n: number) => (n === 1 ? "شغلة وحدة" : `${n} شغلات`),
    spent: "صرف معك",
    lastJob: "آخر شغلة",
    call: "اتصل",
    whatsapp: "واتساب",
    saved: "تم الحفظ",
    failed: "تعذر الحفظ",
  },
  en: {
    title: "Your clients",
    hint: "This is your own client book. Ciao never markets to them and never contacts them — this data is yours alone.",
    search: "Search by name or number",
    empty: "No clients recorded yet.",
    add: "Add a client",
    name: "Name",
    phone: "Number",
    notes: "Notes",
    save: "Save",
    jobs: (n: number) => (n === 1 ? "1 job" : `${n} jobs`),
    spent: "Spent with you",
    lastJob: "Last job",
    call: "Call",
    whatsapp: "WhatsApp",
    saved: "Saved",
    failed: "Could not save",
  },
} satisfies Record<Locale, unknown>;

export function ClientsTab({ me }: { me: PartnerMe }) {
  const locale = useLocale();
  const c = copy[locale];
  const [items, setItems] = useState<PartnerClient[]>([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<{ id?: string; nameAr: string; phone: string; notesAr: string } | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const scope = `partnerId=${me.partnerId}`;
  const showMoney = me.capabilities.includes("money");

  const load = useCallback(async () => {
    try {
      const res = await api<{ items: PartnerClient[] }>(
        `/v1/partner/clients?${scope}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
      );
      setItems(res.items);
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
    }
  }, [scope, search, c.failed]);

  useEffect(() => {
    // Debounced so a search box on a 3G connection isn't a request per keystroke.
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  async function save() {
    if (!draft?.nameAr.trim()) return;
    setBusy(true);
    try {
      await api(`/v1/partner/clients?${scope}`, {
        method: "POST",
        body: JSON.stringify({
          ...(draft.id ? { id: draft.id } : {}),
          nameAr: draft.nameAr,
          phone: draft.phone || null,
          notesAr: draft.notesAr || null,
        }),
      });
      setMessage(c.saved);
      setDraft(null);
      await load();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : c.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section
        title={c.title}
        hint={c.hint}
        action={
          <button
            className="btn-primary !py-1.5 !px-3 !text-xs"
            onClick={() => setDraft({ nameAr: "", phone: "", notesAr: "" })}
          >
            + {c.add}
          </button>
        }
      >
        <input
          className="input !py-2 !text-sm mb-3"
          placeholder={c.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {items.length === 0 ? (
          <p className="text-sm text-faint">{c.empty}</p>
        ) : (
          <ul className="space-y-2">
            {items.map((cl) => (
              <li key={cl.id} className="rounded-2xl bg-sand p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-sea" lang="ar" dir="rtl">
                      {cl.nameAr}
                    </p>
                    <p className="text-[11px] text-muted">
                      {c.jobs(cl.jobsCount)}
                      {cl.lastJobAt
                        ? ` · ${c.lastJob} ${fmtDate(locale, cl.lastJobAt, {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}`
                        : ""}
                    </p>
                    {cl.notesAr ? (
                      <p className="text-[11px] text-faint" lang="ar" dir="rtl">
                        {cl.notesAr}
                      </p>
                    ) : null}
                  </div>
                  {showMoney && cl.totalSpend > 0 ? (
                    <div className="text-end shrink-0">
                      <p className="text-[11px] text-faint">{c.spent}</p>
                      <p className="text-sm font-bold text-sea tabular-nums">
                        {fmtLyd(cl.totalSpend, locale)}
                      </p>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {cl.phone ? (
                    <>
                      <a className="chip !text-xs font-bold" href={`tel:${cl.phone}`} dir="ltr">
                        📞 {c.call}
                      </a>
                      <a
                        className="chip !text-xs font-bold"
                        href={`https://wa.me/${cl.phone.replace("+", "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        💬 {c.whatsapp}
                      </a>
                    </>
                  ) : null}
                  <button
                    className="text-xs underline text-sea font-bold ms-auto"
                    onClick={() =>
                      setDraft({
                        id: cl.id,
                        nameAr: cl.nameAr,
                        phone: cl.phone ?? "",
                        notesAr: cl.notesAr ?? "",
                      })
                    }
                  >
                    {locale === "en" ? "Edit" : "تعديل"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {draft ? (
        <Section title={c.add}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-xs font-bold text-muted">{c.name}</span>
              <input
                className="input !py-2 !text-sm mt-1"
                value={draft.nameAr}
                onChange={(e) => setDraft({ ...draft, nameAr: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="text-xs font-bold text-muted">{c.phone}</span>
              <input
                className="input !py-2 !text-sm mt-1"
                dir="ltr"
                inputMode="tel"
                placeholder="0912345678"
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              />
            </label>
            <label className="sm:col-span-2 text-sm">
              <span className="text-xs font-bold text-muted">{c.notes}</span>
              <textarea
                className="input !py-2 !text-sm mt-1"
                rows={2}
                value={draft.notesAr}
                onChange={(e) => setDraft({ ...draft, notesAr: e.target.value })}
              />
            </label>
          </div>
          <div className="flex gap-2 mt-4">
            <button className="btn-primary !py-2 !px-5 !text-sm" disabled={busy} onClick={() => void save()}>
              {c.save}
            </button>
            <button className="chip !text-sm font-bold" onClick={() => setDraft(null)}>
              {term(UI, locale, "cancel")}
            </button>
          </div>
        </Section>
      ) : null}

      {message ? <p className="card p-3 mt-3 text-sm font-bold text-sea">{message}</p> : null}
    </>
  );
}
