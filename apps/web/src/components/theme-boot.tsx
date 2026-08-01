/**
 * Applies the saved theme before first paint.
 *
 * Without this the page renders light, hydrates, then flips to dark — a white
 * flash in a dark room, which is exactly the moment someone chose dark mode
 * for. The script is tiny, inline, and runs before the body renders; it reads
 * localStorage only, so it costs no network on a slow connection.
 *
 * The server-side preference is still the durable one; this is the local echo
 * that makes the first frame correct.
 */
export function ThemeBoot() {
  const script = `(function(){try{
    var t = localStorage.getItem('ciao_theme') || 'system';
    var dark = t === 'dark' || (t === 'system' &&
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  }catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
