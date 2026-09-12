// 銘柄・ポジション・取引の入力フォーム(モーダル)をまとめたモジュール。

import { api } from './api.js?v=202609122232';
import { confirmDialog, esc, modal, qs, toast } from './dom.js?v=202609122232';
import { normalizeMonth, shares as fmtShares, thisMonth, TX_LABEL, yen, yenPrecise } from './format.js?v=202609122232';
import { previewSplit } from './models.js?v=202609122232';
import { classifyBySector } from './rules.js?v=202609122232';

const CLASSIFICATIONS = [
  ['AUTO', 'おまかせ — セクターから決める'],
  ['K', 'K — 景気敏感株'],
  ['D', 'D — ディフェンシブ株'],
];

// 東証の上場銘柄一覧(sync/build_listing.py が作る)。
// 214KB ほどあるので、銘柄の入力を始めたときに一度だけ読む。
let listingPromise = null;

function loadListing() {
  if (!listingPromise) {
    listingPromise = fetch('./data/listing.json')
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}));   // 読めなくても手入力はできる
  }
  return listingPromise;
}

/** おまかせを選んだときに、何と判定されるかをその場で見せる。 */
function autoClassHint(sector) {
  const { classification, matched, confident } = classifyBySector(sector);
  const label = classification === 'D' ? 'D — ディフェンシブ株' : 'K — 景気敏感株';
  if (!String(sector || '').trim()) {
    return 'セクターを入れると判定できます。空のままだと <b>K</b> になります。';
  }
  return confident
    ? `いまのセクターなら <b>${esc(label)}</b> になります(「${esc(matched)}」で判断)。`
    : `「${esc(sector)}」は判断がつかないため <b>${esc(label)}</b> にします。`
      + '違う場合は K / D を直接選んでください。';
}

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
    isNew ? 'コードを入れると銘柄名とセクターが入ります。株価と配当は次の株価更新で埋まります。<br>'
      + '買付を記録するまでは<b>購入候補</b>として扱われます。'
      + '<span data-code-hint class="code-hint"></span>' : '')}
        ${field('分類', `<select class="select" name="classification">
          ${CLASSIFICATIONS.map(([v, l]) => {
    // おまかせで登録した銘柄は、編集を開いてもおまかせのままにする
    const current = stock?.classification_auto ? 'AUTO' : (stock?.classification ?? 'AUTO');
    return `<option value="${v}"${current === v ? ' selected' : ''}>${l}</option>`;
  }).join('')}
        </select>`, '<span data-class-hint></span>')}
      </div>
      ${field('銘柄名', input('name', stock?.name, 'placeholder="三菱商事"'),
    isNew ? '空のままでも登録できます。' : '')}
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

    onMount: ({ form }) => {
      populateSectors();
      // 「おまかせ」のときだけ、どちらになるかをセクターに合わせて出す
      const hint = qs('[data-class-hint]', form);
      const drawHint = () => {
        hint.innerHTML = form.elements.classification.value === 'AUTO'
          ? autoClassHint(form.elements.sector.value)
          : '景気の波を受けやすい業種か、景気に左右されにくい業種か。';
      };
      drawHint();
      form.elements.classification.addEventListener('change', drawHint);
      form.elements.sector.addEventListener('input', drawHint);

      // 証券コードから銘柄名とセクターを引く。
      // 自分で書き換えた欄は上書きしない(前に自動で入れた値だけ差し替える)
      const codeHint = qs('[data-code-hint]', form);
      const filled = { name: '', sector: '' };
      const autofill = async () => {
        const code = form.elements.code.value.trim().toUpperCase();
        const found = code ? (await loadListing())[code] : null;
        const [name, sector] = found ?? ['', ''];
        for (const [key, value] of Object.entries({ name, sector })) {
          const field_ = form.elements[key];
          // 空欄か、前にここが入れた値のときだけ差し替える。
          // 見つからないコードに変えたら、前の銘柄の値は消す
          if (field_.value.trim() !== '' && field_.value !== filled[key]) continue;
          field_.value = value;
          filled[key] = value;
        }
        if (codeHint) {
          codeHint.textContent = found ? `上場銘柄一覧から入力しました: ${name}` : '';
        }
        drawHint();
      };
      form.elements.code.addEventListener('input', autofill);
      if (isNew) loadListing();   // 入力を待たずに取りに行っておく
    },

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
      // ナンピンの打止めはロットの「ナンピン」行で切り替えるので、ここでは触らない
      const payload = { label: data.label.trim(), account: data.account.trim(), note: data.note.trim() };
      if (isNew) await api.createPosition({ ...payload, stock_id: stockId });
      else await api.updatePosition(position.id, payload);
      toast(isNew ? 'ロットを追加しました' : '保存しました', 'success');
      onDone?.();
    },
  });
}

// -------------------------------------------------------------- 取引フォーム

/** 見込みの下に添える一言。ロットが増えない理由まで言い切る。 */
function splitFooterNote(plan) {
  if (plan.creates_lot) {
    return `増えた ${fmtShares(plan.moved_shares)} 株が新しいロットに入ります。`
      + `取得原価は ${yen(plan.remaining_cost)} と ${yen(plan.moved_cost)} に分かれます。`;
  }
  if (plan.after_shares < plan.before_shares) {
    return '株数が減る併合なので、ロットは増えません(このロットの中で調整します)。';
  }
  // 株数が変わらない = その時点で保有がゼロ。多くは取引月が買付より前
  return '<b style="color:var(--red)">この内容では何も変わりません。</b>'
    + '取引月がこのロットの買付より前になっていないか、比率が 1 対 1 になっていないか'
    + '確かめてください。';
}

/**
 * 分割を実行したらどうなるかの一覧。
 * 保存するのと同じ計算を使うので、ここに出た数字がそのまま結果になる。
 */
function splitPreviewHtml(context, { trade_date, split_from, split_to }) {
  const { transactions = [], positionLabel = 'ロット1', nextLotLabel = '' } = context;
  let plan;
  try {
    plan = previewSplit(transactions, { trade_date, split_from, split_to });
  } catch {
    return '<p class="hint" style="margin:0">分割前・分割後の株数を入力してください。</p>';
  }
  if (plan.before_shares <= 0) {
    return '<p class="hint" style="margin:0">この時点の保有がゼロのため、変化はありません。'
      + '取引月が買付より前になっていないか確かめてください。</p>';
  }

  const row = (name, before, after, avgBefore, avgAfter, isNewLot = false) => `
    <tr>
      <td>${esc(name)}${isNewLot ? '<span class="badge buy" style="margin-left:6px">新規</span>' : ''}</td>
      <td class="r num">${before === null ? '—' : fmtShares(before)}</td>
      <td class="r num">→ ${fmtShares(after)} 株</td>
      <td class="r num muted">${avgBefore === null ? '—' : yenPrecise(avgBefore)}</td>
      <td class="r num">→ ${yenPrecise(avgAfter)}</td>
    </tr>`;

  const rows = plan.creates_lot
    ? row(positionLabel, plan.before_shares, plan.before_shares, plan.avg_price_before, plan.avg_price_after)
      + row(nextLotLabel || '新しいロット', null, plan.moved_shares, null, plan.avg_price_after, true)
    : row(positionLabel, plan.before_shares, plan.after_shares, plan.avg_price_before, plan.avg_price_after);

  return `
    <table class="split-preview-table">
      <thead><tr>
        <th>ロット</th><th class="r">株数</th><th class="r"></th>
        <th class="r">平均取得</th><th class="r"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="hint" style="margin:10px 0 0">
      合計 <b style="color:var(--text-1)">${fmtShares(plan.before_shares)} 株 → ${fmtShares(plan.after_shares)} 株</b>
      ・投資額 <b style="color:var(--text-1)">${yen(plan.total_cost)}</b> は変わりません。<br>
      ${splitFooterNote(plan)}
    </p>`;
}

export function transactionForm(tx, positionId, onDone, context = null) {
  const isNew = !tx;
  const type = tx?.type ?? context?.defaultType ?? 'BUY';
  // 新規の分割のときだけ、実行後の姿を出す(編集ではロットの分かれ方は変わらない)
  const canPreview = isNew && Boolean(context?.transactions);

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
      ${isNew ? 'このロットは分割前の株数のまま残り、<b>増えた分は新しいロットになります</b>。'
    : '既に記録した分割を編集しても、ロットの分かれ方は変わりません。'}
    </p>
    ${canPreview ? `
      <div class="split-preview">
        <p class="split-preview-title">実行するとこうなります</p>
        <div data-split-preview></div>
      </div>` : ''}`;

  modal({
    title: (() => {
      if (!isNew) return '取引を編集';
      // 分割ボタンから開いたときは、何をする画面かを見出しでも示す
      return context?.defaultType === 'SPLIT'
        ? `株式分割 — ${context.positionLabel || 'ロット1'}`
        : '取引を追加';
    })(),
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
      const submitBtn = qs('button[type=submit]', form);
      const applyType = (nextType) => {
        const isSplit = nextType === 'SPLIT';
        hidden.value = nextType;
        tradeBox.hidden = isSplit;
        splitBox.hidden = !isSplit;
        ['shares', 'price'].forEach((n) => { if (form.elements[n]) form.elements[n].required = !isSplit; });
        ['split_from', 'split_to'].forEach((n) => { if (form.elements[n]) form.elements[n].required = isSplit; });
        // 何が起きるボタンなのかを明示する
        if (submitBtn && isNew) submitBtn.textContent = isSplit ? '分割を実行する' : '追加する';
      };
      // 入力を変えるたびに、実行後の姿を描き直す
      const previewBox = canPreview ? qs('[data-split-preview]', form) : null;
      const drawPreview = () => {
        if (!previewBox) return;
        previewBox.innerHTML = splitPreviewHtml(context, {
          trade_date: form.elements.trade_date.value || null,
          split_from: Number(form.elements.split_from.value),
          split_to: Number(form.elements.split_to.value),
        });
      };

      applyType(type);
      drawPreview();

      qs('[data-type-seg]', form).addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-type]');
        if (!btn) return;
        qs('[data-type-seg]', form).querySelectorAll('button')
          .forEach((b) => b.classList.toggle('active', b === btn));
        applyType(btn.dataset.type);
        drawPreview();
      });
      form.addEventListener('input', (event) => {
        if (['split_from', 'split_to', 'trade_date'].includes(event.target.name)) drawPreview();
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
      // 新しく記録する分割は、増えた分を別ロットに切り出す
      if (isNew && data.type === 'SPLIT') {
        const result = await api.splitPosition(positionId, payload);
        toast(result.position
          ? `分割を記録し、${result.position.label} を作成しました`
          : '分割を記録しました', 'success');
        onDone?.();
        return;
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
