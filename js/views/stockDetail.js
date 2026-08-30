// 銘柄詳細: ロットごとの取引台帳と、IRBANK 由来の配当・営業利益の推移。

import { api } from '../lib/api.js?v=202608302253';
import * as charts from '../lib/charts.js?v=202608302253';
import { delegate, esc, toast } from '../lib/dom.js?v=202608302253';
import { confirmDelete, positionForm, stockForm, transactionForm } from '../lib/forms.js?v=202608302253';
import { classification, date, dateTime, num, pct, shares, signClass, TX_LABEL, yen, yenPrecise } from '../lib/format.js?v=202608302253';

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

function txRow(tx) {
  const detail = tx.type === 'SPLIT'
    ? `<td class="r" colspan="3">${num(tx.split_from, 4)} 株 → ${num(tx.split_to, 4)} 株
        <span class="muted">(×${num(tx.split_to / tx.split_from, 4)})</span></td>`
    : `<td class="r">${shares(tx.shares)}</td>
       <td class="r">${yen(tx.price)}</td>
       <td class="r">${yen(tx.shares * tx.price + (tx.type === 'BUY' ? tx.fee : -tx.fee))}</td>`;
  return `<tr>
    <td class="${tx.trade_date ? '' : 'muted'}">${esc(date(tx.trade_date))}</td>
    <td><span class="badge ${tx.type.toLowerCase()}">${TX_LABEL[tx.type]}</span></td>
    ${detail}
    <td class="r muted">${tx.fee ? yen(tx.fee) : ''}</td>
    <td class="muted cell-note">${esc(tx.note || '')}</td>
    <td class="r"><div class="row-actions">
      <button class="btn btn-sm btn-ghost" data-action="edit-tx" data-id="${tx.id}">編集</button>
      <button class="btn btn-sm btn-danger" data-action="delete-tx" data-id="${tx.id}">削除</button>
    </div></td>
  </tr>`;
}

function positionBlock(position, stock) {
  const m = position.metrics;
  const txs = (stock.transactions || []).filter((t) => t.position_id === position.id);
  return `
    <div class="position-block">
      <div class="position-head">
        <h4>${esc(position.label || '既定のロット')}</h4>
        ${position.account ? `<span class="badge warn">${esc(position.account)}</span>` : ''}
        <div class="position-stats">
          <span>保有<b>${shares(m.shares)} 株</b></span>
          <span>平均取得<b>${m.avg_price ? yenPrecise(m.avg_price) : '—'}</b></span>
          <span>投資額<b>${yen(m.cost)}</b></span>
          ${m.realized_pl ? `<span>実現損益<b class="${signClass(m.realized_pl)}">${yen(m.realized_pl, { sign: true })}</b></span>` : ''}
        </div>
        <div class="row-actions" style="margin-left:auto">
          <button class="btn btn-sm" data-action="add-tx" data-position="${position.id}">+ 取引</button>
          <button class="btn btn-sm btn-ghost" data-action="edit-position" data-id="${position.id}">ロット編集</button>
          <button class="btn btn-sm btn-danger" data-action="delete-position" data-id="${position.id}">削除</button>
        </div>
      </div>
      ${txs.length ? `
        <div class="table-wrap" style="border:none;border-radius:0">
          <table class="data">
            <thead><tr>
              <th style="width:90px">取引月</th><th style="width:70px">種別</th>
              <th class="r">株数</th><th class="r">単価</th><th class="r">受渡金額</th>
              <th class="r">手数料</th><th>メモ</th><th class="r">操作</th>
            </tr></thead>
            <tbody>${txs.map(txRow).join('')}</tbody>
          </table>
        </div>` : '<div style="padding:18px 16px;color:var(--text-3);font-size:13px">取引がまだありません。</div>'}
    </div>`;
}

function dividendChart(stock) {
  const history = (stock.dividend_history || []).filter((r) => r.total !== null);
  if (!history.length) return '';
  // 同じ年度に予想・修正・実績があるときは実績を優先する
  const byYear = new Map();
  for (const row of history) {
    const current = byYear.get(row.fiscal_year);
    if (!current || row.kind === '実績' || (current.kind !== '実績' && row.kind === '修正')) {
      byYear.set(row.fiscal_year, row);
    }
  }
  const years = [...byYear.keys()].sort();
  const labels = years.map((y) => String(y).slice(2));
  return `
    <div class="card" style="margin-top:0">
      <div class="card-head">
        <h3 class="card-title">1株配当の推移</h3>
        <p class="card-note">IRBANK · 実績優先(直近は予想)</p>
      </div>
      ${charts.timeSeries(labels, [
    { label: '年間配当 (円/株)', type: 'bar', color: charts.color(0), values: years.map((y) => byYear.get(y).total) },
    { label: '分割調整後 (円/株)', type: 'line', color: charts.color(1), values: years.map((y) => byYear.get(y).adjusted) },
  ], { unit: (v) => `${num(v, 1)}` })}
    </div>`;
}

function profitChart(stock) {
  const history = stock.profit_history || [];
  if (!history.length) return '';
  const labels = history.map((r) => String(r.fiscal_year).slice(2));
  const series = [
    { label: '営業利益', type: 'bar', color: charts.color(1), values: history.map((r) => r.operating_income) },
  ];
  // 日本基準の銘柄は経常利益も併記する(IFRS 採用銘柄には存在しない)
  if (history.some((r) => r.ordinary_income !== null && r.ordinary_income !== undefined)) {
    series.push({ label: '経常利益', type: 'line', color: charts.color(4), values: history.map((r) => r.ordinary_income) });
  }
  series.push({ label: '当期利益', type: 'line', color: charts.color(2), values: history.map((r) => r.net_income) });

  return `
    <div class="card" style="margin-top:0">
      <div class="card-head">
        <h3 class="card-title">業績の推移</h3>
        <p class="card-note">IRBANK · 通期実績 (百万円)</p>
      </div>
      ${charts.timeSeries(labels, series, { unit: (v) => charts.compact(v) })}
    </div>`;
}

export async function render(root, { navigate, params }) {
  const stockId = params[0];
  root.innerHTML = '<div class="loading">読み込み中…</div>';
  let stock;
  try {
    stock = await api.getStock(stockId);
  } catch (err) {
    root.innerHTML = `<div class="empty-state"><h3>銘柄を表示できません</h3><p>${esc(err.message)}</p></div>`;
    return;
  }

  const m = stock.metrics;
  const reload = () => render(root, { navigate, params });

  root.innerHTML = `
    <button class="crumb" data-action="back">← 保有一覧にもどる</button>
    <div class="detail-head">
      <div>
        <h2 class="detail-title">
          <span class="badge ${stock.classification.toLowerCase()}"
                style="vertical-align:middle;margin-right:8px"
                title="${esc(classification(stock.classification).label)}">${esc(stock.classification)}</span>
          ${esc(stock.name)}
        </h2>
        <p class="detail-meta">
          ${esc(stock.code)} · ${esc(classification(stock.classification).label)}
          · ${esc(stock.sector || 'セクター未設定')}
          ${stock.fiscal_month ? ` · ${stock.fiscal_month}月期` : ' · 決算月未設定'}
          ${stock.dividend_months?.length ? ` · 権利確定 ${stock.dividend_months.map((x) => MONTHS[x - 1]).join('・')}` : ''}
          ${stock.timing ? ` · おすすめ時期 ${esc(stock.timing)}` : ''}
        </p>
      </div>
      <div class="row-actions">
        <a class="btn btn-ghost btn-sm" href="https://irbank.net/${esc(stock.code)}/"
           target="_blank" rel="noopener noreferrer">IRBANK で開く ↗</a>
        <button class="btn btn-sm" data-action="edit-stock">銘柄を編集</button>
        <button class="btn btn-sm btn-danger" data-action="delete-stock">削除</button>
      </div>
    </div>

    <div class="summary">
      <div class="summary-cell">
        <p class="summary-label">保有株数</p>
        <p class="summary-value">${shares(m.shares)}<span style="font-size:13px;color:var(--text-3)"> 株</span></p>
        <p class="summary-sub">${stock.position_count} ロット · 取引 ${(stock.transactions || []).length} 件</p>
      </div>
      <div class="summary-cell">
        <p class="summary-label">平均取得単価</p>
        <p class="summary-value">${m.avg_price ? yenPrecise(m.avg_price) : '—'}</p>
        <p class="summary-sub">投資額 ${yen(m.cost)}</p>
      </div>
      <div class="summary-cell">
        <p class="summary-label">現在値</p>
        <p class="summary-value">${stock.market_price ? yen(stock.market_price) : '—'}</p>
        <p class="summary-sub">${stock.market_price_date ? `${esc(date(stock.market_price_date))} 時点` : '未取得'}</p>
      </div>
      <div class="summary-cell">
        <p class="summary-label">含み損益</p>
        <p class="summary-value ${signClass(m.unrealized_pl)}">
          ${stock.market_price ? yen(m.unrealized_pl, { sign: true }) : '—'}</p>
        <p class="summary-sub">${stock.market_price ? pct(m.unrealized_pl_pct, { sign: true }) : ''}</p>
      </div>
      <div class="summary-cell">
        <p class="summary-label">年間配当</p>
        <p class="summary-value gold">${yen(m.annual_dividend)}</p>
        <p class="summary-sub">1株 ${yen(stock.dividend_per_share)}
          ${stock.forecast_dividend && stock.forecast_dividend !== stock.dividend_per_share
    ? ` · IRBANK予想 ${yen(stock.forecast_dividend)}` : ''}</p>
      </div>
      <div class="summary-cell">
        <p class="summary-label">利回り</p>
        <p class="summary-value teal">${m.yield_on_cost ? pct(m.yield_on_cost) : '—'}</p>
        <p class="summary-sub">現在値ベース ${m.current_yield ? pct(m.current_yield) : '—'}</p>
      </div>
    </div>

    ${(stock.per || stock.pbr || stock.memo) ? `
      <div class="card">
        <dl class="kv" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
          ${stock.per ? `<div><dt>PER (予)</dt><dd>${num(stock.per)} 倍</dd></div>` : ''}
          ${stock.pbr ? `<div><dt>PBR</dt><dd>${num(stock.pbr)} 倍</dd></div>` : ''}
          ${m.realized_pl ? `<div><dt>実現損益</dt><dd class="${signClass(m.realized_pl)}">${yen(m.realized_pl, { sign: true })}</dd></div>` : ''}
          ${stock.irbank_synced_at ? `<div><dt>最終同期</dt><dd>${esc(dateTime(stock.irbank_synced_at))}</dd></div>` : ''}
        </dl>
        ${stock.memo ? `<p style="margin:14px 0 0;color:var(--text-2);font-size:13px;white-space:pre-wrap">${esc(stock.memo)}</p>` : ''}
      </div>` : ''}

    <div class="card">
      <div class="card-head">
        <h3 class="card-title">取引台帳</h3>
        <button class="btn btn-sm btn-ghost" data-action="add-position">+ ロットを追加</button>
      </div>
      ${stock.positions.length
    ? stock.positions.map((p) => positionBlock(p, stock)).join('')
    : '<p class="muted" style="margin:0">ロットがありません。まず「+ ロットを追加」してください。</p>'}
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      ${dividendChart(stock)}
      ${profitChart(stock)}
    </div>`;

  delegate(root, 'click', {
    back: () => navigate('holdings'),
    'edit-stock': () => stockForm(stock, reload),
    'delete-stock': () => confirmDelete('銘柄', `${stock.code} ${stock.name}`, async () => {
      await api.deleteStock(stock.id);
      navigate('holdings');
    }),
    'add-position': () => positionForm(null, stock.id, reload),
    'edit-position': (target) => {
      const position = stock.positions.find((p) => String(p.id) === target.dataset.id);
      positionForm(position, stock.id, reload);
    },
    'delete-position': (target) => {
      const position = stock.positions.find((p) => String(p.id) === target.dataset.id);
      confirmDelete('ロット', position.label || '既定のロット', async () => {
        await api.deletePosition(position.id);
        reload();
      });
    },
    'add-tx': (target) => transactionForm(null, Number(target.dataset.position), reload),
    'edit-tx': (target) => {
      const tx = stock.transactions.find((t) => String(t.id) === target.dataset.id);
      transactionForm(tx, tx.position_id, reload);
    },
    'delete-tx': (target) => {
      const tx = stock.transactions.find((t) => String(t.id) === target.dataset.id);
      confirmDelete('取引', `${date(tx.trade_date)} の${TX_LABEL[tx.type]}`, async () => {
        await api.deleteTransaction(tx.id);
        reload();
      });
    },
  });
}
