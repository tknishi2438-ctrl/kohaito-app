// 銘柄詳細: ロットごとの取引台帳と、IRBANK 由来の配当・営業利益の推移。

import { api } from '../lib/api.js?v=202609122347';
import * as charts from '../lib/charts.js?v=202609122347';
import { delegate, esc, toast } from '../lib/dom.js?v=202609122347';
import { confirmDelete, positionForm, stockForm, transactionForm } from '../lib/forms.js?v=202609122347';
import { dividendJudgeRows, judgeMetric, STATUS_LABEL } from '../lib/metrics.js?v=202609122347';
import { classification, date, dateTime, fullDate, lotName, num, pct, shares, signClass, TX_LABEL, yen, yenPrecise } from '../lib/format.js?v=202609122347';

const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

const MOVE_TYPES = ['MOVE_OUT', 'MOVE_IN'];

function txRow(tx) {
  const isMove = MOVE_TYPES.includes(tx.type);
  let detail;
  if (tx.type === 'SPLIT') {
    detail = `<td class="r" colspan="3">${num(tx.split_from, 4)} 株 → ${num(tx.split_to, 4)} 株
        <span class="muted">(×${num(tx.split_to / tx.split_from, 4)})</span></td>`;
  } else if (isMove) {
    detail = `<td class="r">${tx.type === 'MOVE_OUT' ? '−' : '+'}${shares(tx.shares)}</td>
       <td class="r muted" colspan="2">取得原価 ${yen(tx.amount)}</td>`;
  } else {
    detail = `<td class="r">${shares(tx.shares)}</td>
       <td class="r">${yen(tx.price)}</td>
       <td class="r">${yen(tx.shares * tx.price + (tx.type === 'BUY' ? tx.fee : -tx.fee))}</td>`;
  }
  // 振替は対で成り立つので、片方だけの書き換えは許さない(削除は対で消える)
  return `<tr>
    <td class="${tx.trade_date ? '' : 'muted'}">${esc(date(tx.trade_date))}</td>
    <td><span class="badge ${tx.type.toLowerCase()}">${TX_LABEL[tx.type]}</span></td>
    ${detail}
    <td class="r muted">${tx.fee ? yen(tx.fee) : ''}</td>
    <td class="muted cell-note">${esc(tx.note || '')}</td>
    <td class="r"><div class="row-actions">
      ${isMove ? '' : `<button class="btn btn-sm btn-ghost" data-action="edit-tx" data-id="${tx.id}">編集</button>`}
      <button class="btn btn-sm btn-danger" data-action="delete-tx" data-id="${tx.id}">削除</button>
    </div></td>
  </tr>`;
}

const STEP_LABEL = {
  done: ['済', 'muted'],
  ready: ['買い時', 'buy'],
  near: ['もうすぐ', 'warn'],
  waiting: ['待ち', 'muted'],
};

/** 分割の見込みを出すために、そのロットの台帳と名前を渡す。 */
function splitContext(stock, positionId) {
  const position = stock.positions.find((p) => p.id === positionId);
  return {
    transactions: (stock.transactions || []).filter((t) => t.position_id === positionId),
    positionLabel: lotName(position, stock.positions.findIndex((p) => p.id === positionId)),
    // 保存時と同じ付け方(ロット数 + 1)
    nextLotLabel: `ロット${stock.positions.length + 1}(分割)`,
  };
}

/**
 * ロットの中に置くナンピンの目安。
 * そのロットで 1 回目に買った値段から、2 回目・3 回目の株価を出す。
 */
function averagingStrip(position) {
  const plan = position.averaging;
  if (!plan) return '';
  const stepChip = (s) => {
    const [label, cls] = STEP_LABEL[s.status];
    return `<span class="lot-step">
      <span class="muted">${s.round}回目</span>
      <b>${yen(s.target_price)}</b>
      ${plan.stopped ? '' : `<span class="badge ${cls}">${label}</span>`}
    </span>`;
  };
  return `
    <div class="lot-averaging${plan.stopped ? ' stopped' : ''}">
      <span class="lot-averaging-label">ナンピン</span>
      <label class="lot-stop${plan.stopped ? ' on' : ''}"
             title="これ以上は買い増さないロットとして、買い時の知らせから外します">
        <input type="checkbox" data-action="toggle-stop" data-id="${position.id}"
               ${plan.stopped ? 'checked' : ''}>打止め
      </label>
      <span class="lot-step"><span class="muted">1回目</span>
        <b>${yen(plan.base_price)}</b>
        ${position.first_buy?.split_ratio > 1
    ? `<span class="muted">(分割前 ${yen(position.first_buy.raw_price)})</span>` : ''}
      </span>
      ${plan.steps.map(stepChip).join('')}
    </div>`;
}

function positionBlock(position, stock) {
  const m = position.metrics;
  const txs = (stock.transactions || []).filter((t) => t.position_id === position.id);
  return `
    <div class="position-block">
      <div class="position-head">
        <h4>${esc(lotName(position, stock.positions.findIndex((p) => p.id === position.id)))}</h4>
        ${position.account ? `<span class="badge warn">${esc(position.account)}</span>` : ''}
        <span class="position-price">現在値<b>${stock.market_price ? yen(stock.market_price) : '—'}</b></span>
        <div class="position-stats">
          <span>保有<b>${shares(m.shares)} 株</b></span>
          <span>平均取得<b>${m.avg_price ? yenPrecise(m.avg_price) : '—'}</b></span>
          <span>投資額<b>${yen(m.cost)}</b></span>
          ${m.realized_pl ? `<span>実現損益<b class="${signClass(m.realized_pl)}">${yen(m.realized_pl, { sign: true })}</b></span>` : ''}
        </div>
        <div class="row-actions" style="margin-left:auto">
          <button class="btn btn-sm" data-action="add-tx" data-position="${position.id}">+ 取引</button>
          <button class="btn btn-sm" data-action="split" data-position="${position.id}">分割</button>
          <button class="btn btn-sm btn-ghost" data-action="edit-position" data-id="${position.id}">ロット編集</button>
          <button class="btn btn-sm btn-danger" data-action="delete-position" data-id="${position.id}">削除</button>
        </div>
      </div>
      ${averagingStrip(position)}
      ${txs.length ? `
        <div class="table-wrap" style="border:none;border-radius:0">
          <table class="data">
            <thead><tr>
              <th style="width:90px">取引月</th><th style="width:70px">種別</th>
              <th class="r">株数</th><th class="r">約定単価</th><th class="r">受渡金額</th>
              <th class="r">手数料</th><th>メモ</th><th class="r">操作</th>
            </tr></thead>
            <tbody>${txs.map(txRow).join('')}</tbody>
          </table>
        </div>` : '<div style="padding:18px 16px;color:var(--text-3);font-size:13px">取引がまだありません。</div>'}
    </div>`;
}

/**
 * 1 株配当の年度ごとの系列。
 * 同じ年度に予想・修正・実績があるときは実績を優先する。
 */
function dividendSeries(stock) {
  const history = (stock.dividend_history || []).filter((r) => r.total !== null);
  const byYear = new Map();
  for (const row of history) {
    const current = byYear.get(row.fiscal_year);
    if (!current || row.kind === '実績' || (current.kind !== '実績' && row.kind === '修正')) {
      byYear.set(row.fiscal_year, row);
    }
  }
  return [...byYear.keys()].sort().map((y) => ({ fiscal_year: y, ...byYear.get(y) }));
}

function dividendChart(stock) {
  const rows = dividendSeries(stock);
  if (!rows.length) return '';
  const byYear = new Map(rows.map((r) => [r.fiscal_year, r]));
  const years = rows.map((r) => r.fiscal_year);
  const labels = years.map((y) => String(y).slice(2));
  const judged = dividendJudgeRows(stock.dividend_history);
  return `
    <div class="card" style="margin-top:0">
      <div class="card-head">
        <h3 class="card-title">1株配当金</h3>
        <p class="card-note">IRBANK · 円/株 · 実績優先(直近は予想)</p>
      </div>
      ${metricVerdict(judged, 'dividend_per_share')}
      ${charts.timeSeries(labels, [
    { label: '年間配当 (円/株)', type: 'bar', color: charts.color(0), values: years.map((y) => byYear.get(y).total) },
    { label: '分割調整後 (円/株)', type: 'line', color: charts.color(1), values: years.map((y) => byYear.get(y).adjusted) },
  ], { unit: (v) => `${num(v, 1)}` })}
    </div>`;
}

/**
 * 業績の各指標。IRBANK の業績指標ページから取り込んだ値を 1 指標 1 枚で出す。
 * 金額は百万円、率は %、EPS と 1 株配当は円。
 */
const METRIC_CHARTS = [
  { key: 'revenue', label: '売上', type: 'bar', unit: 'money', color: 0 },
  { key: 'operating_margin', label: '営業利益率', type: 'line', unit: 'pct', color: 1 },
  { key: 'eps', label: 'EPS (1株あたり利益)', type: 'bar', unit: 'yen', color: 2 },
  { key: 'operating_cf', label: '営業キャッシュフロー', type: 'bar', unit: 'money', color: 3 },
  // 1 株配当金は「1株配当の推移」が受け持つ(分割調整後も併記できるため)。
  // 並び順を保つため、ここに居場所だけ置いておく
  { key: 'dividend_chart' },
  { key: 'payout_ratio', label: '配当性向', type: 'line', unit: 'pct', color: 4 },
  { key: 'equity_ratio', label: '自己資本比率', type: 'line', unit: 'pct', color: 5 },
  { key: 'cash', label: '現金等', type: 'bar', unit: 'money', color: 3 },
];

const METRIC_UNIT = {
  money: { note: '百万円', format: (v) => charts.compact(v) },
  pct: { note: '%', format: (v) => `${num(v, 1)}%` },
  yen: { note: '円', format: (v) => `${num(v, 2)}` },
};

/** 高配当株として好ましい形かの判定。基準と結果を 1 行で見せる。 */
function metricVerdict(history, key) {
  const verdict = judgeMetric(key, history);
  if (!verdict) return '';
  const [label, cls] = STATUS_LABEL[verdict.status];
  return `
    <p class="metric-verdict">
      <span class="badge ${cls} verdict-mark">${label}</span>
      <span class="verdict-text">${esc(verdict.summary)}</span>
      <span class="muted">基準: ${esc(verdict.criterion)}</span>
    </p>`;
}

function metricChart(history, spec) {
  const rows = history.filter((r) => r[spec.key] !== null && r[spec.key] !== undefined);
  if (rows.length < 2) return '';
  const unit = METRIC_UNIT[spec.unit];
  // 会社予想の年度が混ざっていることを断っておく
  const hasForecast = rows.some((r) => r.forecast);
  return `
    <div class="card" style="margin-top:0">
      <div class="card-head">
        <h3 class="card-title">${esc(spec.label)}</h3>
        <p class="card-note">IRBANK · ${unit.note}${hasForecast ? ' · 直近は会社予想' : ''}</p>
      </div>
      ${metricVerdict(history, spec.key)}
      ${charts.timeSeries(
    rows.map((r) => String(r.fiscal_year).slice(2)),
    [{
      label: spec.label,
      type: spec.type,
      color: charts.color(spec.color),
      values: rows.map((r) => r[spec.key]),
    }],
    { unit: unit.format },
  )}
    </div>`;
}

function metricCharts(stock) {
  const history = stock.profit_history || [];
  return METRIC_CHARTS
    .map((spec) => (spec.key === 'dividend_chart'
      ? dividendChart(stock)
      : metricChart(history, spec)))
    .filter(Boolean)
    .join('');
}

/** 合計点。満点に対する割合で色を変える。 */
function scoreChip(stock) {
  const score = stock.score;
  if (!score || !score.max) return '';
  const tone = score.pct >= 80 ? 'good' : score.pct >= 60 ? 'fair' : 'poor';
  const title = `適合5点・注意3点・不適0点 × ${score.items} 項目${score.unknown
    ? ` · うち ${score.unknown} 項目はデータが無く 0 点` : ''}`;
  return `<span class="score-chip ${tone}" title="${esc(title)}">
      <b>${score.total}</b><span class="score-max">/ ${score.max}点</span>
    </span>${score.unknown
    // 点が低い理由が「悪い」のか「まだ分からない」のかを取り違えないように
    ? `<span class="score-pending">${score.unknown} 項目はデータ待ち</span>` : ''}`;
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
    <button class="crumb" data-action="back">← 銘柄一覧にもどる</button>
    <div class="detail-head">
      <div>
        <h2 class="detail-title">
          <span class="badge ${stock.classification.toLowerCase()}"
                style="vertical-align:middle;margin-right:8px"
                title="${esc(classification(stock.classification).label)}">${esc(stock.classification)}</span>
          ${esc(stock.name)}
          ${scoreChip(stock)}
          ${stock.status === 'candidate'
    ? '<span class="badge" style="vertical-align:middle;margin-left:8px">購入候補</span>' : ''}
          ${stock.status === 'sold'
    ? '<span class="badge" style="vertical-align:middle;margin-left:8px">売却済み</span>' : ''}
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
        <a class="btn btn-ghost btn-sm"
           href="${esc(stock.website
    || `https://duckduckgo.com/?q=${encodeURIComponent(`${stock.code} ${stock.name} 公式サイト`)}`)}"
           target="_blank" rel="noopener noreferrer"
           >企業サイト${stock.website ? '' : 'を検索'} ↗</a>
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
        <p class="summary-sub">${stock.market_price_date ? `${esc(fullDate(stock.market_price_date))} 終値` : '未取得'}</p>
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
        ${stock.status === 'candidate'
    // まだ買っていない銘柄に取得単価は無い。今の株価で買った場合の利回りを出す
    ? `<p class="summary-value teal">${m.current_yield ? pct(m.current_yield) : '—'}</p>
       <p class="summary-sub">現在値で買った場合</p>`
    : `<p class="summary-value teal">${m.yield_on_cost ? pct(m.yield_on_cost) : '—'}</p>
       <p class="summary-sub">平均取得単価ベース</p>`}
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
      ${metricCharts(stock)}
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
      confirmDelete('ロット', lotName(position, stock.positions.indexOf(position)), async () => {
        await api.deletePosition(position.id);
        reload();
      });
    },
    'add-tx': (target) => {
      const id = Number(target.dataset.position);
      transactionForm(null, id, reload, splitContext(stock, id));
    },
    // 打止めはその場で切り替える。DOM ではなく今の値を反転させる
    // (委譲側で既定の動作を止めているため、チェック状態は当てにしない)
    'toggle-stop': async (target) => {
      const id = Number(target.dataset.id);
      const position = stock.positions.find((p) => p.id === id);
      await api.updatePosition(id, { averaging_stopped: !position.averaging_stopped });
      toast(position.averaging_stopped ? '打止めを解除しました' : '打止めにしました', 'success');
      reload();
    },
    // 分割は結果が分かりにくいので、専用のボタンから見込みつきで開く
    split: (target) => {
      const id = Number(target.dataset.position);
      transactionForm(null, id, reload, { ...splitContext(stock, id), defaultType: 'SPLIT' });
    },
    'edit-tx': (target) => {
      const tx = stock.transactions.find((t) => String(t.id) === target.dataset.id);
      transactionForm(tx, tx.position_id, reload);
    },
    'delete-tx': (target) => {
      const tx = stock.transactions.find((t) => String(t.id) === target.dataset.id);
      const name = MOVE_TYPES.includes(tx.type)
        ? `${date(tx.trade_date)} の振替(相手側の記録も一緒に消えます)`
        : `${date(tx.trade_date)} の${TX_LABEL[tx.type]}`;
      confirmDelete('取引', name, async () => {
        await api.deleteTransaction(tx.id);
        reload();
      });
    },
  });
}
