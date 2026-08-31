// 銘柄・ポジション・取引の入力フォーム(モーダル)をまとめたモジュール。

import { api } from './api.js?v=202608312316';
import { confirmDialog, esc, modal, qs, toast } from './dom.js?v=202608312316';
import { normalizeMonth, thisMonth, TX_LABEL } from './format.js?v=202608312316';

const CLASSIFICATIONS = [
  ['K', 'K — 景気敏感株'],
  ['D', 'D — ディフェンシブ株'],
];

function field(label, inner, hint) {
  return `<div class="field"><label>${esc(label)}</label>${inner}
    ${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
}

function input(name, value, attrs = '') {
  return `<input class="input" name="${name}" value="${esc(value ?? '')}" ${attrs}>`;
}

function numberInput(name, value, attrs = '') {
  return `<input class="input num" type="number" name="${name}" value="${value ?? ''}"
                 step="any" inputmode="decimal" ${attrs}>`;
}

// -------------------------------------------------------------- 銘柄フォーム

export function stockForm(stock, onDone) {
  const isNew = !stock;
  const months = ['', ...Array.from({ length: 12 }, (_, i) => i + 1)];

  modal({
    title: isNew ? '銘柄を追加' : `${stock.code} ${stock.name} を編集`,
    submitLabel: isNew ? '追加する' : '保存する',
    body: `
      <div class="field-row">
        ${field('証券コード', input('code', stock?.code, 'required maxlength="5" placeholder="8058"'),
    isNew ? '株価と配当は、登録後の自動更新で埋まります。' : '')}
        ${field('分類', `<select class="select" name="classification">
          ${CLASSIFICATIONS.map(([v, l]) => `<option value="${v}"${stock?.classification === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>`, '景気の波を受けやすい業種か、景気に左右されにくい業種か。')}
      </div>
      ${field('銘柄名', input('name', stock?.name, 'required placeholder="三菱商事"'))}
      <div class="field-row">
        ${field('セクター', input('sector', stock?.sector, 'placeholder="卸売" list="sectorList"'))}
        ${field('おすすめ購入時期', input('timing', stock?.timing, 'placeholder="2025/04"'))}
      </div>
      <div class="field-row">
        ${field('1株あたり年間配当 (円)', numberInput('dividend_per_share', stock?.dividend_per_share, 'min="0"'),
    '利回りと年間配当の計算に使います。')}
        ${field('決算月', `<select class="select" name="fiscal_month">
          ${months.map((m) => `<option value="${m}"${String(stock?.fiscal_month ?? '') === String(m) ? ' selected' : ''}>${m ? `${m}月` : '未設定'}</option>`).join('')}
        </select>`, '配当カレンダーの月別振り分けに使います。')}
      </div>
      ${field('メモ', `<textarea class="input" name="memo" rows="2">${esc(stock?.memo ?? '')}</textarea>`)}
      <datalist id="sectorList"></datalist>`,

    onMount: () => populateSectors(),

    onSubmit: async (data) => {
      const payload = {
        code: data.code.trim(),
        name: data.name.trim(),
        sector: data.sector.trim(),
        classification: data.classification,
        timing: data.timing.trim(),
        dividend_per_share: Number(data.dividend_per_share || 0),
        fiscal_month: data.fiscal_month ? Number(data.fiscal_month) : null,
        memo: data.memo,
      };
      const saved = isNew ? await api.createStock(payload) : await api.updateStock(stock.id, payload);
      if (isNew) {
        // 銘柄だけでは保有にならないため、既定のポジションを 1 つ作っておく
        await api.createPosition({ stock_id: saved.id, label: '' });
      }
      toast(isNew ? `${saved.name} を追加しました` : '保存しました', 'success');
      onDone?.(saved);
    },
  });
}

async function populateSectors() {
  try {
    const { stocks } = await api.listStocks();
    const sectors = [...new Set(stocks.map((s) => s.sector).filter(Boolean))].sort();
    const list = qs('#sectorList');
    if (list) list.innerHTML = sectors.map((s) => `<option value="${esc(s)}">`).join('');
  } catch { /* 補完候補は無くても入力できるので黙って諦める */ }
}

// ---------------------------------------------------------- ポジションフォーム

export function positionForm(position, stockId, onDone) {
  const isNew = !position;
  modal({
    title: isNew ? 'ロットを追加' : 'ロットを編集',
    submitLabel: isNew ? '追加する' : '保存する',
    body: `
      ${field('ロット名', input('label', position?.label, 'placeholder="ロット2 / NISA枠 など"'),
    '同じ銘柄を別枠で持っているときの見分け用です。空でも構いません。')}
      ${field('口座区分', input('account', position?.account, 'placeholder="特定口座 / NISA成長投資枠"'))}
      ${field('メモ', input('note', position?.note))}`,
    onSubmit: async (data) => {
      const payload = { label: data.label.trim(), account: data.account.trim(), note: data.note.trim() };
      if (isNew) await api.createPosition({ ...payload, stock_id: stockId });
      else await api.updatePosition(position.id, payload);
      toast(isNew ? 'ロットを追加しました' : '保存しました', 'success');
      onDone?.();
    },
  });
}

// -------------------------------------------------------------- 取引フォーム

export function transactionForm(tx, positionId, onDone) {
  const isNew = !tx;
  const type = tx?.type ?? 'BUY';

  const tradeFields = `
    <div class="field-row three">
      ${field('株数', numberInput('shares', tx?.shares || '', 'min="0" required'))}
      ${field('約定単価 (円)', numberInput('price', tx?.price || '', 'min="0" required'))}
      ${field('手数料 (円)', numberInput('fee', tx?.fee || 0, 'min="0"'))}
    </div>`;

  const splitFields = `
    <div class="field-row">
      ${field('分割前 (株)', numberInput('split_from', tx?.split_from || 1, 'min="0.0001" required'))}
      ${field('分割後 (株)', numberInput('split_to', tx?.split_to || 2, 'min="0.0001" required'))}
    </div>
    <p class="hint" style="margin-top:-6px">
      1株が2株になる分割なら「1 → 2」。10株を1株にする併合なら「10 → 1」。<br>
      株数だけが比率倍され、取得原価は変わりません(平均取得単価が自動で調整されます)。
    </p>`;

  modal({
    title: isNew ? '取引を追加' : '取引を編集',
    submitLabel: isNew ? '追加する' : '保存する',
    body: `
      ${field('取引種別', `<div class="seg" data-type-seg>
        ${['BUY', 'SELL', 'SPLIT'].map((t) => `<button type="button" data-type="${t}"
          class="${t === type ? 'active' : ''}">${TX_LABEL[t]}</button>`).join('')}
      </div><input type="hidden" name="type" value="${type}">`)}
      ${field('取引月', input('trade_date',
    normalizeMonth(tx?.trade_date) ?? (isNew ? thisMonth() : ''), 'type="month"'),
    '年と月まで記録します。不明な場合は空にできます。'
    + '空の取引は台帳の先頭(最も古い)として扱われます。')}
      <div data-trade-fields ${type === 'SPLIT' ? 'hidden' : ''}>${tradeFields}</div>
      <div data-split-fields ${type === 'SPLIT' ? '' : 'hidden'}>${splitFields}</div>
      ${field('メモ', input('note', tx?.note))}`,

    onMount: ({ form }) => {
      const hidden = form.elements.type;
      const tradeBox = qs('[data-trade-fields]', form);
      const splitBox = qs('[data-split-fields]', form);

      // 隠れている入力欄が required のままだと、ブラウザが送信を止めてしまう。
      // 表示中の側だけを必須にする。
      const applyType = (nextType) => {
        const isSplit = nextType === 'SPLIT';
        hidden.value = nextType;
        tradeBox.hidden = isSplit;
        splitBox.hidden = !isSplit;
        ['shares', 'price'].forEach((n) => { if (form.elements[n]) form.elements[n].required = !isSplit; });
        ['split_from', 'split_to'].forEach((n) => { if (form.elements[n]) form.elements[n].required = isSplit; });
      };
      applyType(type);

      qs('[data-type-seg]', form).addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-type]');
        if (!btn) return;
        qs('[data-type-seg]', form).querySelectorAll('button')
          .forEach((b) => b.classList.toggle('active', b === btn));
        applyType(btn.dataset.type);
      });
    },

    onSubmit: async (data) => {
      const payload = {
        type: data.type,
        trade_date: data.trade_date || null,
        note: data.note?.trim() ?? '',
      };
      if (data.type === 'SPLIT') {
        payload.split_from = Number(data.split_from);
        payload.split_to = Number(data.split_to);
      } else {
        payload.shares = Number(data.shares);
        payload.price = Number(data.price);
        payload.fee = Number(data.fee || 0);
      }
      if (isNew) await api.createTransaction({ ...payload, position_id: positionId });
      else await api.updateTransaction(tx.id, payload);
      toast(isNew ? '取引を追加しました' : '保存しました', 'success');
      onDone?.();
    },
  });
}

// ------------------------------------------------------------------ 削除確認

export async function confirmDelete(kind, name, run) {
  const ok = await confirmDialog({
    title: `${kind}を削除`,
    message: `<b style="color:var(--text-1)">${esc(name)}</b> を削除します。<br>`
      + 'この操作は元に戻せません。関連する下位データ(ロット・取引)もまとめて削除されます。',
  });
  if (!ok) return false;
  await run();
  toast(`${kind}を削除しました`, 'success');
  return true;
}
