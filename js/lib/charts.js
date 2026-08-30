// 外部ライブラリを使わない SVG グラフ。配色は CSS 変数から読むため、
// 明暗テーマの切り替えにそのまま追従する。

import { esc } from './dom.js';

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
 * ドーナツ円グラフ + 凡例。items: [{label, value, color?}]
 * color を指定した項目はその色で描く(分類 K / D のように色の意味が決まっている場合)。
 */
export function donut(items, { size = 190, thickness = 26, unit = compact } = {}) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) return '<p class="muted" style="margin:0">データがありません</p>';

  const radius = size / 2 - 6;
  const inner = radius - thickness;
  const center = size / 2;
  const fillFor = (item, i) => item.color || color(i);
  let angle = -Math.PI / 2;

  const arcs = items.map((item, i) => {
    const sweep = (item.value / total) * Math.PI * 2;
    const end = angle + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const p = (r, a) => `${(center + r * Math.cos(a)).toFixed(2)} ${(center + r * Math.sin(a)).toFixed(2)}`;
    // 全体が 1 件だけのときは円弧が閉じないため、ほぼ全周として描く
    const e = sweep >= Math.PI * 2 - 1e-6 ? end - 1e-4 : end;
    const d = `M ${p(radius, angle)} A ${radius} ${radius} 0 ${large} 1 ${p(radius, e)} `
            + `L ${p(inner, e)} A ${inner} ${inner} 0 ${large} 0 ${p(inner, angle)} Z`;
    angle = end;
    return `<path d="${d}" fill="${fillFor(item, i)}" opacity="0.92"><title>${esc(item.label)}: ${unit(item.value)}</title></path>`;
  }).join('');

  const legend = items.map((item, i) => `
    <div class="legend-item">
      <span class="legend-swatch" style="background:${fillFor(item, i)}"></span>
      <span>${esc(item.label)}</span>
      <span class="legend-value">${unit(item.value)} · ${((item.value / total) * 100).toFixed(1)}%</span>
    </div>`).join('');

  return `
    <div class="donut-wrap">
      <svg class="chart" viewBox="0 0 ${size} ${size}" role="img">
        ${arcs}
        <text x="${center}" y="${center - 2}" text-anchor="middle" class="label-strong">合計</text>
        <text x="${center}" y="${center + 14}" text-anchor="middle" class="label-strong">${unit(total)}</text>
      </svg>
      <div class="legend">${legend}</div>
    </div>`;
}

/**
 * 縦棒グラフ。items: [{label, value, color?}]
 *
 * viewBox は固定の設計サイズで描き、等比で伸縮させる。
 * preserveAspectRatio="none" にすると文字まで横に潰れてしまうため使わない。
 */
export function bars(items, { width = 720, height = 240, unit = compact, highlight = null } = {}) {
  if (!items.length) return '<p class="muted" style="margin:0">データがありません</p>';
  const padTop = 14, padBottom = 30, padLeft = 62, padRight = 8;
  const plotH = height - padTop - padBottom;
  const max = niceMax(Math.max(...items.map((i) => i.value), 0));
  const slot = (width - padLeft - padRight) / items.length;
  const barW = Math.min(slot * 0.6, 30);

  const gridlines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = padTop + plotH * (1 - ratio);
    return `<line class="grid-line" x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" />
            <text x="${padLeft - 8}" y="${y + 4}" text-anchor="end">${unit(max * ratio)}</text>`;
  }).join('');

  const rects = items.map((item, i) => {
    const h = max > 0 ? (item.value / max) * plotH : 0;
    const x = padLeft + slot * i + (slot - barW) / 2;
    const y = padTop + plotH - h;
    const fill = item.color || color(highlight === i ? 2 : 0);
    return `
      <rect class="bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}"
            height="${Math.max(h, item.value > 0 ? 1 : 0).toFixed(2)}" fill="${fill}" rx="1">
        <title>${esc(item.label)}: ${unit(item.value)}</title>
      </rect>
      <text x="${(padLeft + slot * i + slot / 2).toFixed(2)}" y="${height - 10}"
            text-anchor="middle">${esc(item.label)}</text>`;
  }).join('');

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" style="width:100%;height:auto" role="img">
    ${gridlines}
    <line class="axis-line" x1="${padLeft}" y1="${padTop + plotH}" x2="${width - padRight}" y2="${padTop + plotH}" />
    ${rects}
  </svg>`;
}

/** 横棒ランキング。items: [{label, value, sub?}] */
export function hbars(items, { unit = compact } = {}) {
  if (!items.length) return '<p class="muted" style="margin:0">データがありません</p>';
  const max = Math.max(...items.map((i) => i.value), 0) || 1;
  return `<div class="hbars">${items.map((item, i) => `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:7px;font-size:12px">
      <span style="flex:0 0 130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
            title="${esc(item.label)}">${esc(item.label)}</span>
      <span style="flex:1 1 auto;height:9px;background:var(--surface-3);border-radius:2px;overflow:hidden">
        <span style="display:block;height:100%;width:${((item.value / max) * 100).toFixed(1)}%;background:${color(i)}"></span>
      </span>
      <span class="num" style="flex:0 0 84px;text-align:right;color:var(--text-2)">${unit(item.value)}</span>
    </div>`).join('')}</div>`;
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
