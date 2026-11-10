// In-frame layout probe. `probeLayout` is serialized and run inside the app
// frame via frame.evaluate, so it must be self-contained.

/**
 * Scroll every vertical scroller through its range; at each position collect
 * violations for the elements currently in view.
 * opts: { insetTop, insetBottom, minTap, minChip, minFont }
 * Set chips (accessible name "<Exercise>, set <i> of <n>, …") need minChip.
 */
export async function probeLayout(opts) {
  const { insetTop, insetBottom, minTap, minFont } = opts;
  const minChip = opts.minChip || minTap;
  const CHIP_RE = /, set \d+ of \d+, /;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const out = [];
  const seen = new Set();
  const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const INTERACTIVE =
    'button, a[href], input:not([type="hidden"]), textarea, select, [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="checkbox"], [tabindex]:not([tabindex="-1"])';

  const r1 = (n) => Math.round(n * 10) / 10;
  const describe = (el) => {
    const name =
      el.getAttribute("aria-label") ||
      (el.labels && el.labels[0] && el.labels[0].textContent) ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      el.textContent ||
      "";
    const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    return `<${el.tagName.toLowerCase()}${cls}> "${name.replace(/\s+/g, " ").trim().slice(0, 50)}"`;
  };
  const add = (check, el, detail) => {
    const key = check + "|" + describe(el);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ check, el: describe(el), detail });
  };
  const hiddenByStyle = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return true;
    }
    return false;
  };
  const visuallyHidden = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 1.5 || r.height <= 1.5) return true;
    const cs = getComputedStyle(el);
    return cs.clipPath === "inset(50%)" || /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(cs.clip);
  };
  // Visible part of el after every clipping ancestor.
  const clipped = (el) => {
    const r = el.getBoundingClientRect();
    let top = r.top, bottom = r.bottom, left = r.left, right = r.right;
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        const c = n.getBoundingClientRect();
        if (cs.overflowY !== "visible") { top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom); }
        if (cs.overflowX !== "visible") { left = Math.max(left, c.left); right = Math.min(right, c.right); }
      }
      if (cs.position === "fixed") break;
    }
    top = Math.max(top, 0); bottom = Math.min(bottom, H); left = Math.max(left, 0); right = Math.min(right, W);
    return { top, bottom, left, right, w: right - left, h: bottom - top };
  };
  const hitsSelf = (el, c) => {
    const x = (c.left + c.right) / 2, y = (c.top + c.bottom) / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit) return false;
    if (el === hit || el.contains(hit)) return true;
    // A label wrapping a visually-hidden input is its tap target.
    const lab = el.closest && el.closest("label");
    return !!(lab && (lab === hit || lab.contains(hit)));
  };
  const tapTarget = (el) => {
    // Visually hidden inputs inside a label: the label is what you tap.
    const lab = el.closest("label") || (el.labels && el.labels[0]);
    if (visuallyHidden(el) && lab) return lab;
    return el;
  };

  function collect() {
    for (const el of document.querySelectorAll(INTERACTIVE)) {
      if (el.disabled && el.tagName !== "BUTTON") continue;
      if (hiddenByStyle(el)) continue;
      const target = tapTarget(el);
      if (target === el && visuallyHidden(el)) continue;
      const c = clipped(target);
      if (c.w <= 1 || c.h <= 1) continue; // not in view at this scroll position
      if (!hitsSelf(target, c)) continue; // covered by something else
      const r = target.getBoundingClientRect();
      if (r.left < -0.5 || r.right > W + 0.5) add("clipped-x", el, `left ${r1(r.left)} right ${r1(r.right)} (width ${W})`);
      if (r.width < minTap - 0.5 || r.height < minTap - 0.5) add("tap-size", el, `${r1(r.width)}×${r1(r.height)}`);
      else if (CHIP_RE.test(el.getAttribute("aria-label") || el.textContent || "") && (r.width < minChip - 0.5 || r.height < minChip - 0.5))
        add("chip-size", el, `${r1(r.width)}×${r1(r.height)} < ${minChip}`);
      if (c.top < insetTop - 0.5) add("status-band", el, `visible top ${r1(c.top)} < ${insetTop}`);
      if (c.bottom > H - insetBottom + 0.5) add("home-indicator", el, `visible bottom ${r1(c.bottom)} > ${H - insetBottom}`);
    }
    // Text size: every element with its own text, and form fields.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const owners = new Set();
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (t.nodeValue && t.nodeValue.trim() && t.parentElement) owners.add(t.parentElement);
    }
    for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select")) owners.add(el);
    for (const el of owners) {
      if (/^(SCRIPT|STYLE|NOSCRIPT|TITLE|OPTION)$/.test(el.tagName)) continue;
      if (hiddenByStyle(el) || visuallyHidden(el)) continue;
      const c = clipped(el);
      if (c.w <= 1 || c.h <= 1) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < minFont - 0.05) add("font-size", el, `${r1(fs)}px`);
    }
  }

  const scrollers = [document.scrollingElement || document.documentElement];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1 && !hiddenByStyle(el)) scrollers.push(el);
  }
  const saved = scrollers.map((s) => s.scrollTop);
  collect();
  for (const s of scrollers) {
    const max = s.scrollHeight - s.clientHeight;
    if (max <= 1) continue;
    const step = Math.max(80, Math.floor(s.clientHeight * 0.6));
    for (let y = step; ; y += step) {
      s.scrollTop = Math.min(y, max);
      await raf();
      collect();
      if (y >= max) break;
    }
  }
  scrollers.forEach((s, i) => (s.scrollTop = saved[i]));
  await raf();

  const de = document.documentElement;
  const sw = Math.max(de.scrollWidth, document.body.scrollWidth);
  if (sw > de.clientWidth + 1) out.push({ check: "h-scroll", el: "document", detail: `scrollWidth ${sw} > clientWidth ${de.clientWidth}` });
  for (const s of scrollers.slice(1)) {
    if (s.scrollWidth > s.clientWidth + 1 && getComputedStyle(s).overflowX !== "hidden")
      out.push({ check: "h-scroll", el: describe(s), detail: `scrollWidth ${s.scrollWidth} > clientWidth ${s.clientWidth}` });
  }
  return { W, H, scrollers: scrollers.length, violations: out };
}
