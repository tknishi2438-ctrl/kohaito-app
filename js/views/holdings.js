// 銘柄一覧: 保有中の銘柄と購入候補を、並べ替え・絞り込みしながら見る。

import { api } from '../lib/api.js?v=202609122007';
import { delegate, esc, toast } from '../lib/dom.js?v=202609122007';
import { stockForm } from '../lib/forms.js?v=202609122007';
import { classification, pct, shares, signClass, yen } from '../lib/format.js?v=202609122007';

const COLUMNS = [
  { key: 'code', label: 'コード', sort: (a, b) => a.code.localeCompare(b.code) },
  { key: 'name', label: '銘柄', sort: (a, b) => a.name.localeCompare(b.name, 'ja') },
  { key: 'sector', label: 'セクター', sort: (a, b) => (a.sector || '').localeCompare(b.sector || '', 'ja'), detail: true },
  // 現在値と、その隣に見比べるナンピンの目安を先頭に置く
  { key: 'market_price', label: '現在値', num: true },
  { key: 'next_buy_price', label: 'ナンピン', num: true },
  // ここから先は「くわしく」を入れたときだけ出す
  { key: 'shares', label: '株数', num: true, detail: true },
  { key: 'avg_price', label: '平均取得', num: true, detail: true },
  { key: 'cost', label: '投資額', num: true, detail: true },
  { key: 'unrealized_pl', label: '含み損益', num: true, detail: true },
  { key: 'annual_dividend', label: '年間配当', num: true, detail: true },
  { key: 'yield_on_cost', label: '取得利回り', num: true, detail: true },
];

const DETAIL_KEY = 'khk.holdings.detail';

function readDetail() {
  try {
    return localStorage.getItem(DETAIL_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDetail(on) {
  try {
    localStorage.setItem(DETAIL_KEY, on ? '1' : '0');
  } catch {
    // 保存できなくても、この画面を開いている間は切り替わる
  }
}

function visibleColumns() {
  return COLUMNS.filter((c) => !c.detail || state.detail);
}

const state = {
  // 既定は証券コードの若い順。見出しをクリックすれば並べ替えられる
  sortKey: 'code',
  sortDir: 1,
  search: '',
  filter: 'held',   // held | candidate | all | k | d | buy
  detail: false,    // 株数より後ろの列を出すか
};

function value(view, key) {
  if (key === 'next_buy_price') return view.averaging?.next?.target_price ?? null;
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
        ${view.status === 'candidate' ? '<span class="badge">購入候補</span>' : ''}
        ${view.status === 'sold' ? '<span class="badge">売却済み</span>' : ''}
        ${view.position_count > 1 ? `<span class="badge warn">${view.position_count}ロット</span>` : ''}
        ${view.averaging?.actionable
    ? `<span class="badge buy" title="1回目の取得価格から${view.averaging.next.drop_pct}%下">
         ${view.averaging.next.round}回目 買い時</span>`
    : ''}
      </div></td>`;
    case 'sector': return `<td class="muted">${esc(view.sector || '—')}</td>`;
    case 'shares': return `<td class="r">${shares(m.shares)}</td>`;
    case 'avg_price': return `<td class="r">${m.avg_price ? yen(m.avg_price) : '—'}</td>`;
    case 'market_price': return `<td class="r">${view.market_price ? yen(view.market_price) : '<span class="muted">—</span>'}</td>`;
    case 'cost': return `<td class="r">${yen(m.cost)}</td>`;
    case 'unrealized_pl': return view.market_price
      ? `<td class="r ${signClass(m.unrealized_pl)}">${yen(m.unrealized_pl, { sign: true })}</td>`
      : '<td class="r muted">—</td>';
    case 'annual_dividend': return `<td class="r gold">${yen(m.annual_dividend)}</td>`;
    case 'yield_on_cost': return `<td class="r teal">${m.yield_on_cost ? pct(m.yield_on_cost) : '—'}</td>`;
    // 次にナンピンする目安の株価。届いていれば色を付ける
    case 'next_buy_price': {
      const plan = view.averaging;
      if (!plan) return '<td class="r muted">—</td>';
      if (plan.stopped) return '<td class="r muted">打止め</td>';
      if (plan.completed) return '<td class="r muted">完了</td>';
      const next = plan.next;
      const title = `${next.round}回目 · 1回目 ${yen(plan.base_price)} の ${next.drop_pct}% 下`
        + `${view.position_count > 1 ? ` · ${plan.position_label}` : ''}`;
      return `<td class="r" title="${esc(title)}">
        <span class="${plan.actionable ? 'pos' : ''}">${yen(next.target_price)}</span>
        <span class="muted" style="font-size:11px"> ${next.round}回目</span>
      </td>`;
    }
    default: return '<td></td>';
  }
}

/**
 * 絞り込みボタン。件数を添えて、どれを選ぶと何件になるかを見せる。
 * 売却して保有ゼロになった銘柄が無いうちは「保有中」と「すべて」は同数になる。
 */
function filterButtons(views) {
  const counts = {
    held: views.filter((v) => v.status === 'held').length,
    candidate: views.filter((v) => v.status === 'candidate').length,
    all: views.length,
    k: views.filter((v) => v.classification === 'K').length,
    d: views.filter((v) => v.classification === 'D').length,
    buy: views.filter((v) => v.averaging?.actionable).length,
  };
  return [['held', '保有中'], ['candidate', '購入候補'], ['all', 'すべて'],
    ['k', '景気敏感'], ['d', 'ディフェンシブ'], ['buy', '買い時']]
    .map(([key, label]) => `
      <button data-action="filter" data-value="${key}"
              class="${state.filter === key ? 'active' : ''}">
        ${label} <span class="seg-count">${counts[key]}</span>
      </button>`)
    .join('');
}

function apply(views) {
  const term = state.search.trim().toLowerCase();
  let rows = views.filter((v) => {
    if (state.filter === 'held' && v.status !== 'held') return false;
    if (state.filter === 'candidate' && v.status !== 'candidate') return false;
    if (state.filter === 'k' && v.classification !== 'K') return false;
    if (state.filter === 'd' && v.classification !== 'D') return false;
    if (state.filter === 'buy' && !v.averaging?.actionable) return false;
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

/**
 * 合計行。出ている列から組み立てるので、列を足しても消してもずれない。
 * 合計を出す最初の列までは、見出しの「合計 N 銘柄」でまとめて埋める。
 */
function footRow(rows, columns) {
  const total = rows.reduce((acc, v) => ({
    cost: acc.cost + v.metrics.cost,
    dividend: acc.dividend + v.metrics.annual_dividend,
    unrealized: acc.unrealized + (v.market_price ? v.metrics.unrealized_pl : 0),
  }), { cost: 0, dividend: 0, unrealized: 0 });
  const weighted = total.cost > 0 ? (total.dividend / total.cost) * 100 : 0;

  const cell = {
    cost: () => `<td class="r">${yen(total.cost)}</td>`,
    unrealized_pl: () => `<td class="r ${signClass(total.unrealized)}">${yen(total.unrealized, { sign: true })}</td>`,
    annual_dividend: () => `<td class="r gold">${yen(total.dividend)}</td>`,
    yield_on_cost: () => `<td class="r teal">${pct(weighted)}</td>`,
  };
  const firstValued = columns.findIndex((c) => cell[c.key]);
  const lead = firstValued === -1 ? columns.length : firstValued;
  const cells = columns.slice(lead).map((c) => (cell[c.key] ? cell[c.key]() : '<td></td>')).join('');
  return `<tr style="background:var(--surface-2);font-weight:700">
    <td colspan="${lead}">合計 ${rows.length} 銘柄</td>${cells}<td></td>
  </tr>`;
}

export async function render(root, { navigate }) {
  state.detail = readDetail();
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
    const columns = visibleColumns();
    // 銘柄を足したり売ったりすると件数が変わるので、ボタンも描き直す
    root.querySelector('[data-seg]').innerHTML = filterButtons(views);
    const table = root.querySelector('[data-table]');
    table.innerHTML = rows.length ? `
      <table class="data">
        <thead><tr>
          ${columns.map((c) => `<th class="sortable ${c.num ? 'r' : ''}" data-action="sort" data-key="${c.key}">
            ${esc(c.label)}${state.sortKey === c.key ? `<span class="arrow">${state.sortDir > 0 ? '▲' : '▼'}</span>` : ''}
          </th>`).join('')}
          <th class="r">操作</th>
        </tr></thead>
        <tbody>
          ${rows.map((v) => `<tr class="clickable ${v.metrics.shares <= 0 ? 'zero' : ''}"
              data-action="open" data-id="${v.id}">
            ${columns.map((c) => cellHtml(v, c.key)).join('')}
            <td class="r"><div class="row-actions">
              <button class="btn btn-sm btn-ghost" data-action="edit" data-id="${v.id}">編集</button>
            </div></td>
          </tr>`).join('')}
        </tbody>
        <tfoot>${footRow(rows, columns)}</tfoot>
      </table>` : '<div class="empty-state"><h3>該当する銘柄がありません</h3><p>絞り込み条件を変えてみてください。</p></div>';
  };

  root.innerHTML = `
    <div class="toolbar">
      <input class="input search" data-action="noop" id="searchBox" placeholder="コード・銘柄名・セクターで検索"
             value="${esc(state.search)}">
      <div class="seg" data-seg></div>
      <span class="spacer"></span>
      <label class="switch${state.detail ? ' on' : ''}"
             title="セクター・株数・平均取得・投資額・含み損益・年間配当・取得利回りを出し入れします">
        <input type="checkbox" data-action="toggle-detail" ${state.detail ? 'checked' : ''}>
        <span class="switch-track"><span class="switch-knob"></span></span>
        <span class="switch-label">くわしく</span>
      </label>
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
    // 委譲側で既定の動作を止めているため、チェック状態ではなく今の値を反転させる
    'toggle-detail': (target) => {
      state.detail = !state.detail;
      writeDetail(state.detail);
      target.checked = state.detail;
      target.closest('.switch').classList.toggle('on', state.detail);
      // 並べ替えに使っていた列が消えるなら、コード順に戻す
      if (!visibleColumns().some((c) => c.key === state.sortKey)) {
        state.sortKey = 'code';
        state.sortDir = 1;
      }
      draw();
    },
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
      draw();
    },
    add: () => stockForm(null, reload),
  });
}
