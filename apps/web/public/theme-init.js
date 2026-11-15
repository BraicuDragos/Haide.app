/* Runs synchronously in <head> before first paint (a file, not inline: CSP is script-src 'self').
   Sets <html data-theme> and <html data-motion> so there is no flash and no animation start on the wrong setting.
   Theme: dark unless the user chose otherwise. No stored choice = dark, whatever the OS says (ADR 0016).
   Stored 'system' (the explicit Auto choice in Settings) follows the OS; 'light' and 'dark' are literal.
   Motion: the stored in-app switch overrides the OS setting (WCAG 2.2.2), else prefers-reduced-motion.
   Keep in sync with src/lib/prefs.ts (same keys, same rules). */
(function () {
  var d = document.documentElement;
  function get(k) {
    try {
      return window.localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function mq(q) {
    try {
      return window.matchMedia(q).matches;
    } catch (e) {
      return false;
    }
  }
  var theme = get('haide.theme');
  if (theme === 'system') theme = mq('(prefers-color-scheme: light)') ? 'light' : 'dark';
  else if (theme !== 'light') theme = 'dark';
  d.setAttribute('data-theme', theme);
  var motion = get('haide.motion');
  if (motion !== 'reduced' && motion !== 'full')
    motion = mq('(prefers-reduced-motion: reduce)') ? 'reduced' : 'full';
  d.setAttribute('data-motion', motion);
})();
