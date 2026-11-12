// Lightweight dependency-free SVG charts (work offline, no external library).
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text !== undefined) e.textContent = text; return e; };
export const COLORS = { ok: '#138a4b', info: '#1b64f2', bad: '#c62828', warn: '#b7791f', violet: '#5b3df5' };

/** Grouped/stacked-free bar chart. data: [{label, values:[n,n]}], series: [{name,color}] */
export function barChart(data, series, { height = 220 } = {}) {
  const W = 640, H = height, pad = { l: 38, r: 8, t: 10, b: 28 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Bar chart' });
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  const nice = Math.pow(10, Math.floor(Math.log10(max))); const top = Math.ceil(max / nice) * nice;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (H - pad.t - pad.b) * (1 - i / 4);
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y, y2: y, stroke: 'currentColor', 'stroke-opacity': '.12' }));
    svg.append(el('text', { x: pad.l - 6, y: y + 4, 'text-anchor': 'end' }, Math.round((top * i) / 4).toLocaleString()));
  }
  const gw = (W - pad.l - pad.r) / Math.max(1, data.length);
  const bw = Math.max(3, Math.min(26, (gw * 0.8) / series.length));
  data.forEach((d, i) => {
    const gx = pad.l + gw * i + (gw - bw * series.length) / 2;
    d.values.forEach((v, j) => {
      const bh = ((H - pad.t - pad.b) * v) / top;
      const r = el('rect', { x: gx + bw * j, y: H - pad.b - bh, width: bw - 1, height: Math.max(0, bh), fill: series[j].color, rx: 2 });
      r.append(el('title', {}, `${d.label} - ${series[j].name}: ${v.toLocaleString()}`));
      svg.append(r);
    });
    if (data.length <= 16 || i % Math.ceil(data.length / 12) === 0) svg.append(el('text', { x: pad.l + gw * i + gw / 2, y: H - 8, 'text-anchor': 'middle' }, d.label.slice(5)));
  });
  return svg;
}

export function donut(parts, { size = 160 } = {}) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const svg = el('svg', { viewBox: '0 0 42 42', width: size, height: size, role: 'img', 'aria-label': 'Donut chart' });
  svg.append(el('circle', { cx: 21, cy: 21, r: 15.915, fill: 'none', stroke: 'currentColor', 'stroke-opacity': '.1', 'stroke-width': 6 }));
  let offset = 25;
  if (total > 0) for (const p of parts) {
    const pct = (p.value / total) * 100;
    const c = el('circle', { cx: 21, cy: 21, r: 15.915, fill: 'none', stroke: p.color, 'stroke-width': 6, 'stroke-dasharray': `${pct} ${100 - pct}`, 'stroke-dashoffset': offset });
    c.append(el('title', {}, `${p.label}: ${p.value.toLocaleString()}`)); svg.append(c); offset -= pct;
  }
  const t = el('text', { x: 21, y: 22.5, 'text-anchor': 'middle', 'font-size': 6, 'font-weight': 700, fill: 'currentColor' }, total.toLocaleString()); svg.append(t);
  return svg;
}

export function legend(items) {
  const d = document.createElement('div'); d.className = 'legend';
  for (const it of items) { const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = it.color; s.append(i, it.name); d.append(s); }
  return d;
}
