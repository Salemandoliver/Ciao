"use client";
/**
 * Theme, applied before first paint and kept applied afterwards.
 *
 * Two separate problems, one component.
 *
 * The first is the white flash: without an inline script the page renders
 * light, hydrates, then flips to dark — in a dark room, at a chalet gate,
 * which is exactly the moment someone chose dark mode for. So a tiny inline
 * script reads localStorage and sets the class before the body renders. It
 * costs no network, which matters on a slow connection.
 *
 * The second is subtler and shipped broken: switching language reset the theme
 * to light. `/x` and `/en/x` are different `[locale]` params, so navigating
 * between them re-renders the root layout, and React re-applied `<html
 * className={fonts}>` — silently wiping the `dark` class the boot script had
 * added imperatively. React owns every prop it renders, so the fix is to stop
 * rendering that one: the font variables now live on `<body>`, and `<html>`
 * carries no className React knows about. The effect below is the second line
 * of defence, re-asserting the class on every navigation in case anything else
 * ever clears it.
 *
 * It also listens for the OS switching to dark at sunset, which the original
 * read-once-at-boot version ignored.
 */
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const KEY = "ciao_theme";

/** The one place that decides whether the page is dark. */
function apply() {
  try {
    const pref = localStorage.getItem(KEY) ?? "system";
    const dark =
      pref === "dark" ||
      (pref === "system" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    // Only touch the DOM when it is actually wrong — a blind toggle on every
    // render is a repaint, and on a slow phone that is a visible flicker.
    if (dark !== document.documentElement.classList.contains("dark")) {
      document.documentElement.classList.toggle("dark", dark);
    }
  } catch {
    /* private mode: light is a safe default */
  }
}

export function ThemeBoot() {
  const script = `(function(){try{
    var t = localStorage.getItem('${KEY}') || 'system';
    var dark = t === 'dark' || (t === 'system' &&
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  }catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

/** Re-asserts the theme after navigation, and follows the OS at sunset. */
export function ThemeSync() {
  const pathname = usePathname();
  useEffect(apply, [pathname]);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return null;
}
