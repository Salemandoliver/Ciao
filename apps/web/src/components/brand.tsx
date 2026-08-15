/**
 * Brand voice components — the furniture the marketing surfaces are built from.
 *
 * The rest of this app talks like a booking system: what a place costs, what
 * the deposit holds, when the deadline falls. That register is correct at the
 * point of paying money and wrong at the point of persuading someone to care.
 * These three pieces carry the other register — why a place matters, and why a
 * host should let strangers into theirs — and they live here rather than being
 * retyped into each page so the voice cannot drift section by section.
 *
 * Each takes an `eyebrow` because that is the shape of the device: a small
 * amber line that frames the claim underneath. Left on its own a headline like
 * «المكان الجميل يخلّي الذكرى أجمل» reads as a slogan floating in space; with
 * «لكل مناسبة، مكانها» above it, it reads as an answer to a question the
 * reader has just been asked.
 */
import type { ReactNode } from "react";

/**
 * Small amber label with a rule running off it.
 *
 * The rule is decorative and hidden from assistive tech; the label is not, so
 * it is a real element in the reading order rather than a background image.
 * On narrow screens the rule collapses to nothing rather than wrapping — a
 * hairline on its own line looks like a rendering fault.
 */
export function Eyebrow({ children, tone = "amber" }: { children: ReactNode; tone?: "amber" | "sea" }) {
  const colour = tone === "amber" ? "text-link" : "text-muted";
  return (
    <p className={`flex items-center gap-3 text-xs sm:text-sm font-extrabold ${colour}`}>
      <span>{children}</span>
      <span className="hidden sm:block h-px w-14 bg-current opacity-40" aria-hidden />
    </p>
  );
}

/**
 * The positioning statement: a claim on one side, the reasoning on the other,
 * a rule between them.
 *
 * Two columns rather than a centred paragraph because the point is that the
 * second half *supports* the first — a hierarchy a centred block flattens. On
 * a phone the rule turns horizontal and the two stack, which keeps the
 * relationship legible without pretending there is width that isn't there.
 */
export function BrandStatement({
  eyebrow,
  headline,
  accent,
  body,
}: {
  eyebrow: string;
  headline: string;
  /** Trailing words rendered in amber. Split out so the emphasis is markup,
   *  not a fragile substring search on translated copy. */
  accent?: string;
  body: string;
}) {
  return (
    <section className="card p-6 sm:p-10 mt-8">
      <div className="grid gap-6 sm:grid-cols-[1.15fr_auto_1fr] sm:items-center">
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 className="font-baloo font-extrabold text-2xl sm:text-4xl leading-tight text-sea mt-3">
            {headline}
            {accent ? <> <span className="text-link">{accent}</span></> : null}
          </h2>
        </div>
        <div className="hidden sm:block w-px self-stretch bg-sea/15" aria-hidden />
        <div className="sm:hidden h-px w-full bg-sea/15" aria-hidden />
        <p className="text-muted leading-relaxed sm:text-lg">{body}</p>
      </div>
    </section>
  );
}

/**
 * The supply-side band.
 *
 * Deliberately the only navy-on-navy block on a guest page: it is addressed to
 * a different reader, and the change of ground is what signals that before a
 * word is read. Someone scrolling past chalets is not the audience, and should
 * be able to tell in peripheral vision that this paragraph is not for them.
 *
 * Fixed colours, not tokens. This band is dark in both themes — inverting it
 * in dark mode would make it merge with the page and lose the one job it has.
 * That is the same reasoning as the photo chrome, and the contrast audit skips
 * themed checks on it for the same reason it skips text over photographs.
 */
export function PartnerBand({
  eyebrow,
  headline,
  cta,
  href,
  onClick,
  external,
}: {
  eyebrow: string;
  headline: string;
  cta: string;
  href: string;
  onClick?: () => void;
  external?: boolean;
}) {
  return (
    <section
      className="mt-10 rounded-3xl px-6 py-8 sm:px-10 sm:py-10 bg-[#16283C]"
      data-on-photo
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
        <div>
          {/*
            The tan rather than the brand orange, and measured rather than
            chosen: orange on this fixed #16283C panel is 4.47:1, which misses
            AA by three hundredths at a size that does not qualify for the 3:1
            threshold. #dca55a is 6.82:1 here — the same relative of the accent
            that carries dark-mode links for the same reason.
          */}
          <p className="text-xs sm:text-sm font-extrabold text-[#DCA55A]">{eyebrow}</p>
          <h2 className="font-baloo font-extrabold text-xl sm:text-3xl leading-tight text-[#F3F2EC] mt-2">
            {headline}
          </h2>
        </div>
        <a
          href={href}
          onClick={onClick}
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="shrink-0 inline-flex items-center gap-2 rounded-full bg-[#E8641B] px-7 py-3 font-extrabold text-[#0D1B2A] hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F3F2EC]"
        >
          {cta}
          <span aria-hidden>↗</span>
        </a>
      </div>
    </section>
  );
}
