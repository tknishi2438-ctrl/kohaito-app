// 保有一覧: 並べ替え・絞り込みができる銘柄テーブル。

import { api } from '../lib/api.js?v=202608302253';
import { delegate, esc, toast } from '../lib/dom.js?v=202608302253';
import { stockForm } from '../lib/forms.js?v=202608302253';
import { classification, pct, shares, signClass, yen } from '../lib/format.js?v=202608302253';

const COLUMNS = [
  { key: 'code', label: 'コード', sort: (a, b) => a.code.localeCompare(b.code) },
  { key: 'name', label: '銘柄', sort: (a, b) => a.name.localeCompare(b.name, 'ja') },
  { key: 'sector', label: 'セクター', sort: (a, b) => (a.sector || '').localeCompare(b.sector || '', 'ja') },
  { key: 'shares', label: '株数', num: true },
  { key: 'avg_price', label: '平均取得', num: true },
  { key: 'market_price', label: '現在値', num: true },
  { key: 'cost', label: '投資額', num: true },
  { key: 'unrealized_pl', label: '含み損益', num: true },
  { key: 'dividend_per_share', label: '1株配当', num: true },
  { key: 'annual_dividend', label: '年間配当', num: true },
  { key: 'yield_on_cost', label: '取得利回り', num: true },
  { key: 'current_yield', label: '現在利回り', num: true },
];

const state = {
  sortKey: 'annual_dividend',
  sortDir: -1,
  search: '',
  filter: 'held',   // held | all | k | d
};

function value(view, key) {
  if (key in view.metrics) return view.metrics[key];
  return view[key];
}

function cellHtml(view, key) {
  const m = view.metrics;
  switch (key) {
    case 'code': return `<td class="num muted">${esc(view.code)}</td>`;
    case 'name': return `<td><div class="cell-name">
        <span class="badge ${view.classification.toLowerCase()}"
              title="${esc(classification(view.classification).label)}">${esc(view.classification)}</span>
        <strong>${esc(view.name)}</strong>
        ${view.position_count > 1 ? `<span class="badge warn">${view.position_count}ロット</span>` : ''}
      </div></td>`;
    case 'sector': return `<td class="muted">${esc(view.sector || '—')}</td>`;
    case 'shares': return `<td class="r">${shares(m.shares)}</td>`;
    case 'avg_price': return `<td class="r">${m.avg_price ? yen(m.avg_price) : '—'}</td>`;
    case 'market_price': return `<td class="r">${view.market_price ? yen(view.market_price) : '<span class="muted">—</span>'}</td>`;
    case 'cost': return `<td class="r">${yen(m.cost)}</td>`;
    case 'unrealized_pl': return view.market_price
      ? `<td class="r ${signClass(m.unrealized_pl)}">${yen(m.unrealized_pl, { sign: true })}
         <span class="muted" style="font-size:11px">${pct(m.unrealized_pl_pct, { digits: 1, sign: true })}</span></td>`
      : '<td class="r muted">—</td>';
    case 'dividend_per_share': return `<td class="r">${view.dividend_per_share ? yen(view.dividend_per_share) : '—'}</td>`;
    case 'annual_dividend': return `<td class="r gold">${yen(m.annual_dividend)}</td>`;
    case 'yield_on_cost': return `<td class="r teal">${m.yield_on_cost ? pct(m.yield_on_cost) : '—'}</td>`;
    case 'current_yield': return `<td class="r">${m.current_yield ? pct(m.current_yield) : '<span class="muted">—</span>'}</td>`;
    default: return '<td></td>';
  }
}

function apply(views) {
  const term = state.search.trim().toLowerCase();
  let rows = views.filter((v) => {
    if (state.filter === 'held' && v.metrics.shares <= 0) return false;
    if (state.filter === 'k' && v.classification !== 'K') return false;
    if (state.filter === 'd' && v.classification !== 'D') return false;
    if (!term) return true;
    return [v.code, v.name, v.sector, v.timing].some((f) => String(f || '').toLowerCase().includes(term));
  });
  const column = COLUMNS.find((c) => c.key === state.sortKey);
  rows = rows.sort((a, b) => {
    if (column?.sort) return column.sort(a, b) * state.sortDir;
    const av = value(a, state.sortKey) ?? -Infinity;
    const bv = value(b, state.sortKey) ?? -Infinity;
    return (av - bv) * state.sortDir;
  });
  return rows;
}

function footRow(rows) {
  const total = rows.reduce((acc, v) => ({
    cost: acc.cost + v.metrics.cost,
    dividend: acc.dividend + v.metrics.annual_dividend,
    unrealized: acc.unrealized + (v.market_price ? v.metrics.unrealized_pl : 0),
  }), { cost: 0, dividend: 0, unrealized: 0 });
  const weighted = total.cost > 0 ? (total.dividend / total.cost) * 100 : 0;
  return `<tr style="background:var(--surface-2);font-weight:700">
    <td colspan="3">合計 ${rows.length} 銘柄</td>
    <td></td><td></td><td></td>
    <td class="r">${yen(total.cost)}</td>
    <td class="r ${signClass(total.unrealized)}">${yen(total.unrealized, { sign: true })}</td>
    <td></td>
    <td class="r gold">${yen(total.dividend)}</td>
    <td class="r teal">${pct(weighted)}</td>
    <td></td><td></td>
  </tr>`;
}

export async function render(root, { navigate }) {
  root.innerHTML = '<div class="loading">読み込み中…</div>';
  let views;
  try {
    ({ stocks: views } = await api.listStocks());
  } catch (err) {
    root.innerHTML = `<div class="empty-state"><h3>読み込みに失敗しました</h3><p>${esc(err.message)}</p></div>`;
    return;
  }

  const draw = () => {
    const rows = apply(views);
    const table = root.querySelector('[data-table]');
    table.innerHTML = rows.length ? `
      <table class="data">
        <thead><tr>
          ${COLUMNS.map((c) => `<th class="sortable ${c.num ? 'r' : ''}" data-action="sort" data-key="${c.key}">
            ${esc(c.label)}${state.sortKey === c.key ? `<span class="arrow">${state.sortDir > 0 ? '▲' : '▼'}</span>` : ''}
          </th>`).join('')}
          <th class="r">操作</th>
        </tr></thead>
        <tbody>
          ${rows.map((v) => `<tr class="clickable ${v.metrics.shares <= 0 ? 'zero' : ''}"
              data-action="open" data-id="${v.id}">
            ${COLUMNS.map((c) => cellHtml(v, c.key)).join('')}
            <td class="r"><div class="row-actions">
              <button class="btn btn-sm btn-ghost" data-action="edit" data-id="${v.id}">編集</button>
            </div></td>
          </tr>`).join('')}
        </tbody>
        <tfoot>${footRow(rows)}</tfoot>
      </table>` : '<div class="empty-state"><h3>該当する銘柄がありません</h3><p>絞り込み条件を変えてみてください。</p></div>';
  };

  root.innerHTML = `
    <div class="toolbar">
      <input class="input search" data-action="noop" id="searchBox" placeholder="コード・銘柄名・セクターで検索"
             value="${esc(state.search)}">
      <div class="seg">
        ${[['held', '保有中'], ['all', 'すべて'],
    ['k', '景気敏感'], ['d', 'ディフェンシブ']].map(([v, l]) =>
    `<button data-action="filter" data-value="${v}" class="${state.filter === v ? 'active' : ''}">${l}</button>`).join('')}
      </div>
      <span class="spacer"></span>
      <button class="btn btn-primary" data-action="add">+ 銘柄を追加</button>
    </div>
    <div class="table-wrap" data-table></div>`;

  draw();

  root.querySelector('#searchBox').addEventListener('input', (e) => {
    state.search = e.target.value;
    draw();
  });

  const reload = async () => {
    ({ stocks: views } = await api.listStocks());
    draw();
  };

  delegate(root, 'click', {
    noop: () => {},
    open: (target) => navigate(`stock/${target.dataset.id}`),
    edit: async (target) => {
      const stock = views.find((v) => String(v.id) === target.dataset.id);
      stockForm(stock, reload);
    },
    sort: (target) => {
      const key = target.dataset.key;
      if (state.sortKey === key) state.sortDir *= -1;
      else { state.sortKey = key; state.sortDir = ['code', 'name', 'sector'].includes(key) ? 1 : -1; }
      draw();
    },
    filter: (target) => {
      state.filter = target.dataset.value;
      render(root, { navigate });
    },
    add: () => stockForm(null, reload),
  });
}
