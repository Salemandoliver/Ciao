"use client";
/**
 * The WhatsApp handoff at the bottom of the hosts page.
 *
 * Client-side only because it emits `supply.contact_started` — the one event
 * in this funnel that means something actually happened. An impression says a
 * band was rendered; a tap here says a Libyan venue owner decided to talk to
 * us, which is the number the whole page exists to move.
 *
 * When no number is configured it renders the explanation instead of the
 * button. A dead contact link is worse than no contact link: the first tells a
 * host we do not answer, and they only find out after composing a message.
 */
import { trackClient } from "@/lib/tracker";

export function HostContact({
  whatsapp,
  title,
  body,
  button,
  unavailable,
}: {
  whatsapp: string;
  title: string;
  body: string;
  button: string;
  unavailable: string;
}) {
  return (
    <section className="card p-6 mt-8 text-center">
      <h2 className="font-bold text-xl text-sea">{title}</h2>
      <p className="text-sm text-muted mt-1">{body}</p>
      {whatsapp ? (
        <a
          href={`https://wa.me/${whatsapp}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackClient("supply.contact_started", { channel: "whatsapp" })}
          className="btn-primary inline-block mt-4"
        >
          {button}
        </a>
      ) : (
        <p className="text-sm text-faint mt-4">{unavailable}</p>
      )}
    </section>
  );
}
