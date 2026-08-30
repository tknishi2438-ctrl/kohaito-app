// 取引台帳: 全銘柄の取引を新しい順に一覧する。

import { api } from '../lib/api.js?v=202608302253';
import { delegate, esc } from '../lib/dom.js?v=202608302253';
import { confirmDelete, transactionForm } from '../lib/forms.js?v=202608302253';
import { date, num, shares, TX_LABEL, yen } from '../lib/format.js?v=202608302253';

const state = { search: '', type: 'ALL' };

function amount(tx) {
  if (tx.type === 'SPLIT') {
    return `<span class="muted">${num(tx.split_from, 4)} → ${num(tx.split_to, 4)}
      (×${num(tx.split_to / tx.split_from, 4)})</span>`;
  }
  const gross = tx.shares * tx.price;
  const net = tx.type === 'BUY' ? gross + tx.fee : gross - tx.fee;
  return yen(net);
}

export async function render(root, { navigate }) {
  root.innerHTML = '<div class="loading">読み込み中…</div>';
  let transactions;
  try {
    ({ transactions } = await api.listTransactions());
  } catch (err) {
    root.innerHTML = `<div class="empty-state"><h3>読み込みに失敗しました</h3><p>${esc(err.message)}</p></div>`;
    return;
  }

  const draw = () => {
    const term = state.search.trim().toLowerCase();
    const rows = transactions.filter((tx) => {
      if (state.type !== 'ALL' && tx.type !== state.type) return false;
      if (!term) return true;
      return [tx.code, tx.name, tx.sector, tx.note, tx.trade_date]
        .some((f) => String(f || '').toLowerCase().includes(term));
    });

    const totals = rows.reduce((acc, tx) => {
      if (tx.type === 'BUY') acc.buy += tx.shares * tx.price + tx.fee;
      if (tx.type === 'SELL') acc.sell += tx.shares * tx.price - tx.fee;
      return acc;
    }, { buy: 0, sell: 0 });

    root.querySelector('[data-table]').innerHTML = rows.length ? `
      <table class="data">
        <thead><tr>
          <th style="width:90px">取引月</th><th style="width:70px">種別</th>
          <th style="width:60px">コード</th><th>銘柄</th><th>ロット</th>
          <th class="r">株数</th><th class="r">単価</th><th class="r">受渡金額</th>
          <th>メモ</th><th class="r">操作</th>
        </tr></thead>
        <tbody>${rows.map((tx) => `
          <tr>
            <td class="${tx.trade_date ? '' : 'muted'}">${esc(date(tx.trade_date))}</td>
            <td><span class="badge ${tx.type.toLowerCase()}">${TX_LABEL[tx.type]}</span></td>
            <td class="num muted">${esc(tx.code)}</td>
            <td><a href="#stock/${tx.stock_id}" style="color:inherit;text-decoration:none"
                   data-action="open" data-id="${tx.stock_id}">${esc(tx.name)}</a></td>
            <td class="muted">${esc(tx.position_label || '—')}</td>
            <td class="r">${tx.type === 'SPLIT' ? '—' : shares(tx.shares)}</td>
            <td class="r">${tx.type === 'SPLIT' ? '—' : yen(tx.price)}</td>
            <td class="r">${amount(tx)}</td>
            <td class="muted cell-note">${esc(tx.note || '')}</td>
            <td class="r"><div class="row-actions">
              <button class="btn btn-sm btn-ghost" data-action="edit" data-id="${tx.id}">編集</button>
              <button class="btn btn-sm btn-danger" data-action="delete" data-id="${tx.id}">削除</button>
            </div></td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr style="background:var(--surface-2);font-weight:700">
          <td colspan="7">${rows.length} 件 · 買付合計 ${yen(totals.buy)}${totals.sell ? ` / 売却合計 ${yen(totals.sell)}` : ''}</td>
          <td class="r">${yen(totals.buy - totals.sell)}</td><td></td><td></td>
        </tr></tfoot>
      </table>` : '<div class="empty-state"><h3>該当する取引がありません</h3></div>';
  };

  root.innerHTML = `
    <div class="toolbar">
      <input class="input search" id="ledgerSearch" placeholder="銘柄・メモ・年月で検索" value="${esc(state.search)}">
      <div class="seg">
        ${[['ALL', 'すべて'], ['BUY', '買付'], ['SELL', '売却'], ['SPLIT', '分割']].map(([v, l]) =>
    `<button data-action="type" data-value="${v}" class="${state.type === v ? 'active' : ''}">${l}</button>`).join('')}
      </div>
      <span class="spacer"></span>
      <span class="muted" style="font-size:12px">取引の追加は銘柄詳細から行えます</span>
    </div>
    <div class="table-wrap" data-table></div>`;

  draw();
  root.querySelector('#ledgerSearch').addEventListener('input', (e) => {
    state.search = e.target.value;
    draw();
  });

  const reload = async () => {
    ({ transactions } = await api.listTransactions());
    draw();
  };

  delegate(root, 'click', {
    open: (target) => navigate(`stock/${target.dataset.id}`),
    type: (target) => {
      state.type = target.dataset.value;
      render(root, { navigate });
    },
    edit: (target) => {
      const tx = transactions.find((t) => String(t.id) === target.dataset.id);
      transactionForm(tx, tx.position_id, reload);
    },
    delete: (target) => {
      const tx = transactions.find((t) => String(t.id) === target.dataset.id);
      confirmDelete('取引', `${tx.code} ${tx.name} · ${date(tx.trade_date)} の${TX_LABEL[tx.type]}`,
        async () => { await api.deleteTransaction(tx.id); await reload(); });
    },
  });
}
