// 外部ライブラリを使わない SVG グラフ。配色は CSS 変数から読むため、
// 明暗テーマの切り替えにそのまま追従する。

import { esc } from './dom.js?v=202608302308';

const PALETTE_SIZE = 12;
const FALLBACK = '#8a6a17';

/** 現在のテーマの系列色を CSS 変数(--chart-1 …)から取り出す。 */
function palette() {
  const styles = getComputedStyle(document.documentElement);
  const colors = [];
  for (let i = 1; i <= PALETTE_SIZE; i += 1) {
    const value = styles.getPropertyValue(`--chart-${i}`).trim();
    if (value) colors.push(value);
  }
  return colors.length ? colors : [FALLBACK];
}

export function color(index) {
  const colors = palette();
  return colors[index % colors.length];
}

function niceMax(value) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

function compact(value) {
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${(value / 1e8).toFixed(1)}億`;
  if (abs >= 1e4) return `${Math.round(value / 1e4).toLocaleString('ja-JP')}万`;
  return Math.round(value).toLocaleString('ja-JP');
}

/**
 * 構成比の横棒グラフ。上限ラインを引き、超過分を色分けする。
 * items: [{label, value, status, note}] value は %
 */
export function limitBars(items, { limit = 20, scaleMax = null } = {}) {
  if (!items.length) return '<p class="muted" style="margin:0">データがありません</p>';
  const max = scaleMax ?? Math.max(limit * 1.25, ...items.map((i) => i.value) ) * 1.05;
  const pos = (v) => `${Math.min((v / max) * 100, 100).toFixed(2)}%`;
  const statusColor = {
    over: 'var(--red)',
    warn: 'var(--gold)',
    ok: 'var(--teal)',
    neutral: 'var(--text-3)',   // 判定対象ではない、参考表示の棒
  };

  return `<div class="limit-bars" style="--limit-pos:${pos(limit)}">
    ${items.map((item) => `
      <div class="limit-row">
        <span class="limit-label" title="${esc(item.label)}">${esc(item.label)}</span>
        <span class="limit-track">
          <span class="limit-fill" style="width:${pos(item.value)};background:${statusColor[item.status] || statusColor.ok}"></span>
          <span class="limit-mark" aria-hidden="true"></span>
        </span>
        <span class="limit-value num" style="color:${item.status === 'over' ? 'var(--red)' : 'inherit'}">
          ${item.value.toFixed(1)}%
        </span>
        <span class="limit-note num muted">${esc(item.note ?? '')}</span>
      </div>`).join('')}
    <div class="limit-legend">
      <span class="limit-legend-mark"></span>上限 ${limit}%
    </div>
  </div>`;
}

/**
 * 折れ線 + 棒の複合グラフ(配当履歴・営業利益の推移用)。
 * series: [{label, values:[{x, y}], type:'line'|'bar', color}]
 */
export function timeSeries(labels, series, { width = 560, height = 260, unit = compact } = {}) {
  if (!labels.length) return '<p class="muted" style="margin:0">データがありません</p>';
  const padTop = 14, padBottom = 28, padLeft = 62, padRight = 10;
  const plotH = height - padTop - padBottom;
  const plotW = width - padLeft - padRight;
  const all = series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined));
  const max = niceMax(Math.max(...all, 0));
  const min = Math.min(...all, 0);
  const span = max - Math.min(min, 0) || 1;
  const stepX = plotW / Math.max(labels.length - 1, 1);
  const yFor = (v) => padTop + plotH * (1 - (v - Math.min(min, 0)) / span);
  const xFor = (i) => padLeft + stepX * i;

  const grid = [0, 0.5, 1].map((r) => {
    const y = padTop + plotH * (1 - r);
    return `<line class="grid-line" x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}"/>
            <text x="${padLeft - 8}" y="${y + 4}" text-anchor="end">${unit(Math.min(min, 0) + span * r)}</text>`;
  }).join('');

  const drawn = series.map((s) => {
    if (s.type === 'bar') {
      const barW = Math.min(stepX * 0.55, 18);
      return s.values.map((v, i) => {
        if (v === null || v === undefined) return '';
        const y = yFor(Math.max(v, 0));
        const base = yFor(0);
        return `<rect class="bar" x="${(xFor(i) - barW / 2).toFixed(2)}" y="${Math.min(y, base).toFixed(2)}"
                      width="${barW.toFixed(2)}" height="${Math.abs(base - y).toFixed(2)}"
                      fill="${s.color}" opacity=".72" rx="1"><title>${esc(s.label)} ${esc(labels[i])}: ${unit(v)}</title></rect>`;
      }).join('');
    }
    const points = s.values
      .map((v, i) => (v === null || v === undefined ? null : `${xFor(i).toFixed(2)},${yFor(v).toFixed(2)}`))
      .filter(Boolean).join(' ');
    const dots = s.values.map((v, i) => (v === null || v === undefined ? '' :
      `<circle cx="${xFor(i).toFixed(2)}" cy="${yFor(v).toFixed(2)}" r="2.4" fill="${s.color}">
         <title>${esc(s.label)} ${esc(labels[i])}: ${unit(v)}</title></circle>`)).join('');
    return `<polyline points="${points}" fill="none" stroke="${s.color}" stroke-width="1.8"/>${dots}`;
  }).join('');

  const every = Math.ceil(labels.length / 12);
  const xLabels = labels.map((label, i) => (i % every === 0
    ? `<text x="${xFor(i).toFixed(2)}" y="${height - 9}" text-anchor="middle">${esc(label)}</text>` : '')).join('');

  const legend = series.map((s) => `
    <div class="legend-item"><span class="legend-swatch" style="background:${s.color}"></span>
    <span>${esc(s.label)}</span></div>`).join('');

  return `
    <svg class="chart" viewBox="0 0 ${width} ${height}" style="width:100%;height:auto" role="img">
      ${grid}
      <line class="axis-line" x1="${padLeft}" y1="${yFor(0)}" x2="${width - padRight}" y2="${yFor(0)}"/>
      ${drawn}
      ${xLabels}
    </svg>
    <div class="legend">${legend}</div>`;
}

export { compact };
