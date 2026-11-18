// Layout check: text that is cut off or spills out of its box, now or when it gets longer (translations into German, Finnish, French… run
// 20-40% longer than English). Measured from the rendered page, read-only, except for the stretch test, which lengthens the text, measures and
// puts back the exact original text in one synchronous step (the page never gets to react in between).

const SCROLLS = /^(auto|scroll|overlay)$/;
const CLIPS = /^(hidden|clip)$/;

/** Text node -> its rendered box, or null when it has none (hidden, collapsed, not rendered). */
function textRect(node) {
  try {
    const r = node.ownerDocument.createRange();
    r.selectNodeContents(node);
    const b = r.getBoundingClientRect();
    return b && b.width > 1 && b.height > 1 ? b : null;
  } catch (e) { return null; }
}

/** The inner (padding) box of an element in viewport coordinates. */
function innerBox(e) {
  const b = e.getBoundingClientRect();
  const left = b.left + (e.clientLeft || 0), top = b.top + (e.clientTop || 0);
  return { left, top, right: left + e.clientWidth, bottom: top + e.clientHeight, width: e.clientWidth, height: e.clientHeight };
}

const parentOf = (n) => n.parentElement || n.parentNode?.host || null;
const isBlockish = (cs) => !/^(inline|contents)$/.test(cs.display);

/**
 * Is this text cut off or spilling out of its box?
 * @param {Text} node
 * @returns {{kind: 'clip'|'clip-bottom'|'spill', px: number, ellipsis?: boolean}|null}
 */
export function layoutProblem(node) {
  const el = parentOf(node);
  if (!el || !el.ownerDocument) return null;
  const win = el.ownerDocument.defaultView;
  if (!win || !win.getComputedStyle) return null;
  const tr = textRect(node);
  if (!tr) return null;
  let own = true; // the first block-level box around the text
  for (let e = el, k = 0; e && e.nodeType === 1 && k < 8; e = parentOf(e), k++) {
    if (e.tagName === 'BODY' || e.tagName === 'HTML') break;
    const cs = win.getComputedStyle(e);
    if (!isBlockish(cs)) continue;
    if (e.clientWidth <= 2 || e.clientHeight <= 2) return null; // visually hidden (screen-reader only) text
    const box = innerBox(e);
    const ox = cs.overflowX || cs.overflow, oy = cs.overflowY || cs.overflow;
    const outRight = tr.right - box.right, outBottom = tr.bottom - box.bottom;
    // a scroll area: overflowing is what it is for
    if ((SCROLLS.test(ox) && outRight > 1) || (SCROLLS.test(oy) && outBottom > 1)) return null;
    // entirely outside the visible part (a hidden carousel slide, an off-canvas menu): not "cut", just not shown
    if ((CLIPS.test(ox) && tr.left >= box.right - 1) || (CLIPS.test(oy) && tr.top >= box.bottom - 1)) return null;
    if (CLIPS.test(ox) && outRight > 1) return { kind: 'clip', px: Math.round(outRight), ellipsis: cs.textOverflow === 'ellipsis' };
    if (CLIPS.test(oy) && outBottom > 1) return { kind: 'clip-bottom', px: Math.round(outBottom) };
    if (own) {
      own = false;
      // its content really is larger than the box (an auto-height box grows with its text, so this only happens to constrained boxes)
      if (outRight > 2 && tr.left < box.right && e.scrollWidth > e.clientWidth + 2) return { kind: 'spill', px: Math.round(outRight) };
      if (outBottom > 2 && tr.top < box.bottom && e.scrollHeight > e.clientHeight + 2) return { kind: 'spill', px: Math.round(outBottom) };
    }
  }
  return null;
}

export function describeProblem(p, stretched) {
  const what = p.kind === 'clip' ? (p.ellipsis ? `Cut off with “…” (${p.px}px hidden)` : `Cut off on the right (${p.px}px hidden)`)
    : p.kind === 'clip-bottom' ? `Cut off at the bottom (${p.px}px hidden)` : `Runs out of its box by ${p.px}px`;
  return stretched ? `Breaks when the text is ${stretched}% longer: ${what.charAt(0).toLowerCase() + what.slice(1)}` : what;
}

/** Lengthens every word by `pct` percent (at least one letter), keeping word breaks where they were so wrapping behaves like real text. */
export function stretchText(text, pct) {
  return text.replace(/\p{L}+/gu, (w) => {
    const extra = Math.max(1, Math.ceil((w.length * pct) / 100));
    let add = '';
    while (add.length < extra) add += w.toLowerCase();
    return w + add.slice(0, extra);
  });
}

/**
 * Stretch test. For each text node: measure, lengthen by pct, measure again, restore. Returns the nodes that only break when longer.
 * @param {Text[]} nodes
 * @param {number} pct e.g. 35
 * @returns {{node: Text, problem: object}[]}
 */
export function stretchTest(nodes, pct) {
  const live = nodes.filter((n) => n.isConnected && n.nodeValue && /\p{L}/u.test(n.nodeValue));
  const before = new Set(live.filter((n) => layoutProblem(n)));
  const orig = live.map((n) => n.nodeValue);
  const out = [];
  try {
    live.forEach((n, i) => { n.nodeValue = stretchText(orig[i], pct); });
    for (const n of live) {
      if (before.has(n)) continue;
      const p = layoutProblem(n);
      if (p) out.push({ node: n, problem: p });
    }
  } finally {
    live.forEach((n, i) => { if (n.nodeValue !== orig[i]) n.nodeValue = orig[i]; }); // always back to the exact original
  }
  return out;
}
