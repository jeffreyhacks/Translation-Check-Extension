// Status values ("Valid", "Completed", "In progress") come from the app's data, not from the page template, and are shown in small badges or
// table cells. Two of the three models often can't place one short word, and the target language's word list may list it as a loanword
// (German dictionaries have "valid"), so such a value used to end up as "can't tell" and was then assumed translated. In a status slot
// (a badge, a pill, a table cell, a definition value, role="status") a plain English status word on a page in another language is untranslated.
// Content-side and small on purpose: no word lists here.

const STATUS = new Set([
  ...('valid invalid completed complete incomplete pending active inactive failed failure success successful succeeded running draft ' +
  'published unpublished archived enabled disabled error warning approved rejected declined processing queued cancelled canceled expired synced ' +
  'syncing synchronized unsynced connected disconnected verified unverified healthy unhealthy idle stopped started finished submitted overdue paid unpaid ' +
  'scheduled paused ready available unavailable open closed done new resolved unresolved deleted blocked locked unlocked passed skipped yes no true false').split(' '),
  'in progress', 'not started', 'on hold', 'in review', 'under review', 'not synced', 'up to date', 'not connected', 'partially completed',
]);

// Values that are spelled the same as the normal word in the target language, so they are not evidence of anything there.
const SAME = { all: ['online', 'offline'], fr: ['active', 'inactive'], es: ['error', 'no'], ca: ['error', 'no'], it: ['no'], pt: ['no'], nl: ['open'] };

/** Is `text` (already cleaned) a plain English status value that the target language `lang` doesn't spell the same way? */
export function isStatusValue(text, lang) {
  const base = String(lang || '').toLowerCase().split(/[-_]/)[0];
  if (!base || base === 'en') return false;
  const k = text.toLowerCase().replace(/[^\p{L}\p{M} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!k || !STATUS.has(k)) return false;
  return !SAME.all.includes(k) && !(SAME[base] || []).includes(k);
}

const BADGE_CLASS = /(?:^|[\s_-])(?:badge|pill|chip|tag|status|lozenge)(?:$|[\s_-])/i;
/** A small inline label: a badge/pill/chip class, role="status", or the usual utility-class badge (rounded + text-xs, short text). */
export function isBadge(el) {
  if (!el || el.nodeType !== 1) return false;
  const role = (el.getAttribute('role') || '').toLowerCase();
  if (role === 'status') return true;
  const cls = typeof el.className === 'string' ? el.className : el.getAttribute('class') || '';
  if (!cls) return false;
  if (BADGE_CLASS.test(cls)) return true;
  const short = (el.textContent || '').trim().length <= 30;
  return short && /\brounded(?:-full|-md|-sm|-lg)?\b/.test(cls) && /\btext-(?:xs|\[1[01]px\])\b/.test(cls);
}

const CELL = /^(TD|DD)$/;
/** A slot where status values live: a badge, or a table cell / definition value (up to three levels up). */
export function isStatusSlot(el) {
  for (let e = el, k = 0; e && e.nodeType === 1 && k < 3; e = e.parentElement || e.parentNode?.host, k++) {
    if (isBadge(e) || CELL.test(e.tagName)) return true;
    const role = (e.getAttribute('role') || '').toLowerCase();
    if (role === 'cell' || role === 'gridcell') return true;
  }
  return false;
}
