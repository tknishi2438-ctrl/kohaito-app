// ダッシュボード: 資産サマリー・分散ルール・構成比・要対応の一覧。

import { api } from '../lib/api.js?v=202609130048';
import * as charts from '../lib/charts.js?v=202609130048';
import { delegate, esc, modal, toast } from '../lib/dom.js?v=202609130048';
import { pct, signClass, yen } from '../lib/format.js?v=202609130048';

function summaryCard(label, value, { cls = '', sub = '' } = {}) {
  return `
    <div class="summary-cell">
      <p class="summary-label">${esc(label)}</p>
      <p class="summary-value ${cls}">${value}</p>
      ${sub ? `<p class="summary-sub">${sub}</p>` : ''}
    </div>`;
}

function attentionNotice(attention, summary) {
  const items = [];
  (attention.sector_over_limit || []).forEach((s) => {
    items.push(
      `セクター <b>${esc(s.label)}</b> の配当が偏っています（${s.share_pct.toFixed(1)}%）`,
    );
  });
  const dividendOver = attention.dividend_over_limit || [];
  if (dividendOver.length) {
    const names = dividendOver.slice(0, 3).map((d) => esc(d.name)).join('、');
    items.push(
      `配当の偏りが上限を超えている銘柄が <b>${dividendOver.length}</b> 件あります`
      + `（${names}${dividendOver.length > 3 ? ' ほか' : ''}）`,
    );
  }
  (attention.defensive_short || []).forEach((d) => {
    items.push(
      `ディフェンシブ株の配当が <b>${d.share_pct.toFixed(1)}%</b> で下限 ${d.min_pct}% を下回っています`
      + (d.shortfall_amount ? `（あと ${yen(d.shortfall_amount)} 買い増すと届きます）` : ''),
    );
  });
  if (attention.undated_transactions.length) {
    items.push(`取引月が未設定の取引が <b>${attention.undated_transactions.length}</b> 件あります`);
  }
  if (attention.no_market_price.length) {
    items.push(`株価が未取得の銘柄が <b>${attention.no_market_price.length}</b> 件あります`);
  }
  if ((attention.no_name || []).length) {
    items.push(
      `銘柄名が未取得の銘柄が <b>${attention.no_name.length}</b> 件あります`
      + `（${attention.no_name.slice(0, 3).map((s) => esc(s.code)).join('、')}`
      + `${attention.no_name.length > 3 ? ' ほか' : ''}）`,
    );
  }
  if (!items.length) return '';
  return `
    <div class="notice">
      <p class="notice-title">お知らせ <span class="notice-count">${items.length}</span></p>
      <ul class="notice-list">${items.map((t) => `<li>${t}</li>`).join('')}</ul>
    </div>`;
}

/**
 * 分散ルールのカード。「余力」は、あとどれだけ買い増しても上限内に収まるかを示す。
 * 買い増すと分子(その銘柄・セクター)と分母(全体)の両方が増えるため、
 * 単純な「上限額 − 現在額」ではない点に注意。
 */
function ruleVerdict(rule, unitLabel) {
  return rule.passing
    ? `<span class="badge buy verdict-mark">適合</span> <span class="verdict-text">最大は ${unitLabel}</span>`
    : `<span class="badge sell verdict-mark">超過 ${rule.over.length} 件</span>`
      + ' <span class="verdict-text">上限を超えています</span>';
}

function sectorRuleBlock(rule) {
  if (!rule || !rule.sectors.length) return '';
  const worst = rule.sectors[0];

  // 余力は投資できる額で示す(そのセクターの現在利回りで換算)
  const note = (s) => {
    if (s.headroom_amount === null) {
      return s.headroom >= 0 ? `余力 配当${yen(s.headroom)}` : `配当${yen(Math.abs(s.headroom))} 超過`;
    }
    return s.headroom_amount >= 0
      ? `あと ${yen(s.headroom_amount)}`
      : `${yen(Math.abs(s.headroom_amount))} 分 減らす`;
  };

  return `
    <div class="rule-block">
      <div class="rule-head">
        <h4>セクター集中度</h4>
        <span class="rule-limit">1 セクター ${rule.limit_pct}% 以下 · 年間配当ベース</span>
        <button class="btn btn-sm btn-ghost" data-action="edit-sector-limit">上限を変更</button>
      </div>
      <p class="rule-verdict">
        ${ruleVerdict(rule, `${esc(worst.label)} の ${worst.share_pct.toFixed(1)}%`)}
        <span class="muted" style="margin-left:8px">
          全 ${rule.sectors.length} 業種が均等なら 1 業種 ${(100 / rule.sectors.length).toFixed(1)}%
        </span>
      </p>
      ${charts.limitBars(
    rule.sectors.map((s) => ({
      label: s.label, value: s.share_pct, status: s.status, note: note(s),
    })),
    { limit: rule.limit_pct },
  )}
      <p class="hint">
        年間配当のうち、そのセクターが占める割合です。
        「あと ◯円」は、いまの利回りのまま買い増した場合に上限へ届くまでの投資額の目安です。
      </p>
    </div>`;
}

const DIVIDEND_ROWS = 12;

function dividendRuleBlock(rule) {
  if (!rule || !rule.stocks.length) return '';
  const worst = rule.stocks[0];
  // 上限に触れるのは上位だけなので、上位数件に絞って表示する
  const shown = rule.stocks.slice(0, DIVIDEND_ROWS);

  const note = (r) => {
    if (r.headroom_shares === null) {
      return r.headroom >= 0 ? `余力 ${yen(r.headroom)}` : `${yen(Math.abs(r.headroom))} 超過`;
    }
    const n = Math.abs(r.headroom_shares);
    return r.headroom_shares >= 0
      ? `あと ${n.toFixed(n < 10 ? 1 : 0)} 株`
      : `${Math.ceil(n)} 株 減らす`;
  };

  return `
    <div class="rule-block">
      <div class="rule-head">
        <h4>配当の銘柄集中度</h4>
        <span class="rule-limit">1 銘柄 ${rule.limit_pct}% 以下 · 年間配当ベース</span>
        <button class="btn btn-sm btn-ghost" data-action="edit-dividend-limit">上限を変更</button>
      </div>
      <p class="rule-verdict">
        ${ruleVerdict(rule, `${esc(worst.name)} の ${worst.share_pct.toFixed(2)}%`)}
        <span class="muted" style="margin-left:8px">
          全 ${rule.stocks.length} 銘柄が均等なら 1 銘柄 ${rule.even_share_pct.toFixed(2)}%
        </span>
      </p>
      ${charts.limitBars(
    shown.map((r) => ({ label: r.name, value: r.share_pct, status: r.status, note: note(r) })),
    { limit: rule.limit_pct },
  )}
      ${rule.stocks.length > DIVIDEND_ROWS
    ? `<p class="hint">配当の多い上位 ${DIVIDEND_ROWS} 銘柄を表示しています（全 ${rule.stocks.length} 銘柄）。</p>`
    : ''}
    </div>`;
}

/**
 * ディフェンシブ株の比率。上の 2 つと違い「◯% 以上を保つ」下限のルールで、
 * 守りの厚みを見るため投資額の比率で判定する。
 */
function defensiveRuleBlock(rule) {
  if (!rule || !rule.total_dividend) return '';

  const verdict = rule.passing
    ? `<span class="badge buy verdict-mark">適合</span>`
      + ` <span class="verdict-text">ディフェンシブ株が ${rule.defensive_share_pct.toFixed(1)}%</span>`
    : `<span class="badge sell verdict-mark">不足</span>`
      + ` <span class="verdict-text">ディフェンシブ株が ${rule.defensive_share_pct.toFixed(1)}%`
      + `（下限まで ${(rule.min_pct - rule.defensive_share_pct).toFixed(1)} ポイント）</span>`;

  // 余力欄は幅が狭いので短く。意味は下の説明文で補う
  const amount = rule.passing ? rule.cyclical_room_amount : rule.shortfall_amount;
  const dividendOnly = rule.passing ? rule.cyclical_room : rule.shortfall;
  const note = amount === null
    ? `配当 ${yen(dividendOnly)}`
    : `${rule.passing ? '余地' : 'あと'} ${yen(amount)}`;

  return `
    <div class="rule-block">
      <div class="rule-head">
        <h4>ディフェンシブ株の比率</h4>
        <span class="rule-limit">${rule.min_pct}% 以上を保つ · 年間配当ベース</span>
        <button class="btn btn-sm btn-ghost" data-action="edit-defensive-limit">下限を変更</button>
      </div>
      <p class="rule-verdict">
        ${verdict}
        <span class="muted" style="margin-left:8px">
          ディフェンシブ ${rule.defensive_count} 銘柄 / 景気敏感 ${rule.cyclical_count} 銘柄
        </span>
      </p>
      ${charts.limitBars([
    {
      label: 'ディフェンシブ株',
      value: rule.defensive_share_pct,
      status: rule.passing ? 'ok' : 'over',
      note,
    },
    {
      label: '景気敏感株',
      value: rule.cyclical_share_pct,
      status: 'neutral',
      note: '',
    },
  ], { limit: rule.min_pct, scaleMax: 100, limitLabel: '下限' })}
      <p class="hint">
        年間配当のうち、ディフェンシブ株から得ている割合です。
        点線は下限で、<b style="color:var(--text-2)">この線より右</b>にあれば適合です。
        ${rule.passing
    ? '「余地 ◯円」は、下限を割らずに<b style="color:var(--text-2)">景気敏感株</b>を買い増せる投資額です。'
    : '「あと ◯円」は、下限に届くまでに必要な<b style="color:var(--text-2)">ディフェンシブ株</b>の投資額です。'}
      </p>
    </div>`;
}

function rulesCard(rules) {
  if (!rules) return '';
  return `
    <div class="card">
      <div class="card-head">
        <h3 class="card-title">分散ルール</h3>
        <p class="card-note">「余力」は、あとどれだけ買い増しても上限内に収まるかの目安です</p>
      </div>
      ${sectorRuleBlock(rules.sector)}
      ${dividendRuleBlock(rules.stock_dividend)}
      ${defensiveRuleBlock(rules.defensive)}
    </div>`;
}

/**
 * ナンピン買いの買い時。
 * 1 回目に買った値段から所定の割合だけ下がった銘柄を知らせる。
 */
function averagingCard(plan) {
  if (!plan) return '';
  const row = (r, ready) => `
    <tr class="clickable" data-action="open-stock" data-id="${r.id}">
      <td style="width:44px" class="muted num">${esc(r.code)}</td>
      <td><span class="badge ${r.classification.toLowerCase()}">${esc(r.classification)}</span>
          <span style="margin-left:8px">${esc(r.name)}</span>
          ${r.multi_lot ? `<span class="muted" style="margin-left:6px;font-size:11px">${esc(r.position_label)}</span>` : ''}</td>
      <td class="r"><span class="badge ${ready ? 'buy' : 'warn'}">${r.round} 回目</span></td>
      <td class="r num">${yen(r.market_price)}</td>
      <td class="r num muted">目安 ${yen(r.target_price)}</td>
      <td class="r num ${ready ? 'pos' : ''}">${ready
    ? `${pct(Math.abs(r.gap_pct), { digits: 1 })} 下`
    : `あと ${pct(r.gap_pct, { digits: 1 })}`}</td>
    </tr>`;

  const body = plan.ready.length || plan.near.length
    ? `<table class="data"><tbody>
        ${plan.ready.map((r) => row(r, true)).join('')}
        ${plan.near.map((r) => row(r, false)).join('')}
      </tbody></table>`
    : `<p class="rule-verdict buy-alert calm">
        <span class="verdict-text">いま買い時の銘柄はありません</span>
        <span class="muted">${plan.watching} 銘柄を見ています</span></p>`;

  return `
    <div class="card">
      <div class="card-head">
        <h3 class="card-title">ナンピンの買い時</h3>
        <p class="card-note">
          1 回目の取得価格から ${plan.second_drop_pct}% 下で 2 回目、${plan.third_drop_pct}% 下で 3 回目
        </p>
        <button class="btn btn-sm btn-ghost" data-action="edit-averaging">下落率を変更</button>
      </div>
      ${plan.ready.length ? `<p class="rule-verdict buy-alert">
        <span class="badge buy verdict-mark">買い時</span>
        <span class="verdict-text">${plan.ready.length} 銘柄が目安の株価に届いています</span>
      </p>` : ''}
      ${body}
      <p class="hint">
        基準は<b style="color:var(--text-2)">1 回目に買った値段</b>です(分割があれば調整済み)。
        平均取得単価ではありません。買い増すたびに基準が下がると、
        下げ止まらない銘柄を買い続けることになるためです。<br>
        目安まであと 5% 以内の銘柄も添えています。${plan.completed
    ? ` 3 回とも買い終えた銘柄が ${plan.completed} 件あります。` : ''}
      </p>
    </div>`;
}

function limitForm({ title, name, label, hint, current, min, onDone }) {
  modal({
    title,
    submitLabel: '保存する',
    body: `
      <div class="field">
        <label>${esc(label)}</label>
        <input class="input num" type="number" name="${name}" min="${min}" max="100"
               step="0.1" value="${current}" required>
        <p class="hint">${hint}</p>
      </div>`,
    onSubmit: async (data) => {
      await api.updateSettings({ [name]: Number(data[name]) });
      toast('分散ルールを更新しました', 'success');
      onDone?.();
    },
  });
}

function averagingForm(plan, onDone) {
  modal({
    title: 'ナンピンの下落率',
    submitLabel: '保存する',
    body: `
      <div class="field-row">
        <div class="field">
          <label>2 回目 (%)</label>
          <input class="input num" type="number" name="second_buy_drop_pct" min="1" max="99"
                 step="1" value="${plan.second_drop_pct}" required>
        </div>
        <div class="field">
          <label>3 回目 (%)</label>
          <input class="input num" type="number" name="third_buy_drop_pct" min="1" max="99"
                 step="1" value="${plan.third_drop_pct}" required>
        </div>
      </div>
      <p class="hint">
        1 回目に買った値段から何 % 下がったら買い増すか。既定は 20% と 40% です。<br>
        3 回目は 2 回目より大きい値にしてください。
      </p>`,
    onSubmit: async (data) => {
      await api.updateSettings({
        second_buy_drop_pct: Number(data.second_buy_drop_pct),
        third_buy_drop_pct: Number(data.third_buy_drop_pct),
      });
      toast('下落率を更新しました', 'success');
      onDone?.();
    },
  });
}

export async function render(root, { navigate }) {
  root.innerHTML = '<div class="loading">集計中…</div>';
  let data;
  try {
    data = await api.dashboard();
  } catch (err) {
    root.innerHTML = `<div class="empty-state"><h3>読み込みに失敗しました</h3><p>${esc(err.message)}</p></div>`;
    return;
  }

  // 保存先を未設定のまま空で開くと「データが消えた」ように見えるため、
  // 何をすればよいかを最初に案内する
  if (data.summary.stock_count === 0) {
    const status = api.status();
    root.innerHTML = `
      <div class="card" style="margin-top:0;max-width:640px">
        <div class="card-head"><h3 class="card-title">はじめに: 保存先をつなぐ</h3></div>
        ${status.connected ? `
          <p style="margin:0 0 8px;font-size:13px;color:var(--text-2)">
            ${esc(status.repo)} に接続していますが、まだ銘柄が登録されていません。
          </p>
          <p class="hint" style="margin:0">
            「データ」タブから JSON を読み込むか、「銘柄一覧」から銘柄を追加してください。
          </p>
        ` : `
          <p style="margin:0 0 12px;font-size:13px;color:var(--text-2)">
            この端末はまだ GitHub につながっていないため、データを読み込めていません。<br>
            <b style="color:var(--text-1)">記録した内容が消えたわけではありません。</b>
            GitHub 側に保存されており、接続すれば表示されます。
          </p>
          <ol class="hint" style="margin:0 0 16px;padding-left:1.3em;line-height:2">
            <li>GitHub でアクセストークン(合鍵)を作る</li>
            <li>下のボタンから、ユーザー名・リポジトリ名・トークンを入力する</li>
          </ol>
          <button class="btn btn-primary" data-action="go-settings">保存先を設定する</button>
        `}
      </div>`;
    delegate(root, 'click', { 'go-settings': () => navigate('settings') });
    return;
  }

  const s = data.summary;
  const hasPrices = s.valued_cost > 0;

  root.innerHTML = `
    ${attentionNotice(data.needs_attention, s)}

    <div class="summary">
      ${summaryCard('総投資額', yen(s.total_cost), { sub: `${s.holdings} 銘柄 / ${s.position_count} ロット` })}
      ${summaryCard('年間配当合計', yen(s.annual_dividend), { cls: 'gold', sub: `月あたり ${yen(s.monthly_dividend)}` })}
      ${summaryCard('加重平均利回り', pct(s.weighted_yield), { cls: 'teal', sub: '平均取得単価ベース' })}
      ${hasPrices
    ? summaryCard('評価額', yen(s.market_value), { sub: `株価取得済み ${s.priced_count} 銘柄` })
    : summaryCard('評価額', '—', { sub: '株価が未取得です' })}
      ${hasPrices
    ? summaryCard('含み損益', yen(s.unrealized_pl, { sign: true }), {
      cls: signClass(s.unrealized_pl), sub: pct(s.unrealized_pl_pct, { sign: true }),
    })
    : ''}
      ${s.realized_pl
    ? summaryCard('実現損益', yen(s.realized_pl, { sign: true }), { cls: signClass(s.realized_pl), sub: '売却済み分' })
    : ''}
    </div>

    ${averagingCard(data.averaging)}

    ${rulesCard(data.rules)}`;

  delegate(root, 'click', {
    'open-stock': (target) => navigate(`stock/${target.dataset.id}`),
    'edit-averaging': () => averagingForm(data.averaging, () => render(root, { navigate })),
    'edit-sector-limit': () => limitForm({
      title: 'セクター集中度の上限',
      name: 'max_sector_pct',
      label: '1 セクターあたりの上限 (%)',
      hint: '年間配当に占める割合で判定します。既定は 20% です。',
      current: data.rules.sector.limit_pct,
      min: 1,
      onDone: () => render(root, { navigate }),
    }),
    'edit-defensive-limit': () => limitForm({
      title: 'ディフェンシブ株の下限',
      name: 'min_defensive_pct',
      label: '保つ割合の下限 (%)',
      hint: '年間配当に占める割合で判定します。既定は 50% です。',
      current: data.rules.defensive.min_pct,
      min: 0,
      onDone: () => render(root, { navigate }),
    }),
    'edit-dividend-limit': () => limitForm({
      title: '配当の銘柄集中度の上限',
      name: 'max_stock_dividend_pct',
      label: '1 銘柄あたりの上限 (%)',
      hint: `年間配当合計に占める割合で判定します。既定は 3% です。`
        + `保有 ${data.rules.stock_dividend.stocks.length} 銘柄が均等なら 1 銘柄あたり`
        + ` ${data.rules.stock_dividend.even_share_pct.toFixed(2)}% です。`,
      current: data.rules.stock_dividend.limit_pct,
      min: 0.1,
      onDone: () => render(root, { navigate }),
    }),
  });
}
