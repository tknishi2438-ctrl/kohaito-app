// ダッシュボード: 資産サマリー・分散ルール・構成比・要対応の一覧。

import { api } from '../lib/api.js?v=202608302154';
import * as charts from '../lib/charts.js?v=202608302154';
import { delegate, esc, modal, toast } from '../lib/dom.js?v=202608302154';
import { classification, classificationColor, pct, signClass, yen } from '../lib/format.js?v=202608302154';

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
  if (attention.undated_transactions.length) {
    items.push(`取引月が未設定の取引が <b>${attention.undated_transactions.length}</b> 件あります`);
  }
  if (attention.no_market_price.length) {
    items.push(`株価が未取得の銘柄が <b>${attention.no_market_price.length}</b> 件あります`);
  }
  if (!items.length) return '';
  return `
    <div class="notice">
      <div>${items.join('<br>')}</div>
    </div>`;
}

/**
 * 分散ルールのカード。「余力」は、あとどれだけ買い増しても上限内に収まるかを示す。
 * 買い増すと分子(その銘柄・セクター)と分母(全体)の両方が増えるため、
 * 単純な「上限額 − 現在額」ではない点に注意。
 */
function ruleVerdict(rule, unitLabel) {
  return rule.passing
    ? `<span class="badge buy">適合</span> 最大は ${unitLabel}`
    : `<span class="badge sell">超過 ${rule.over.length} 件</span> 上限を超えています`;
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
    </div>`;
}

/**
 * 景気敏感株とディフェンシブ株の内訳。守りの比率が一目で分かるよう、
 * 構成比だけでなく銘柄数と利回りも並べる。
 */
function classificationBreakdown(rows) {
  if (!rows.length) return '';
  return `<table class="data" style="margin-top:14px">
    <thead><tr>
      <th>分類</th><th class="r">銘柄数</th><th class="r">投資額</th>
      <th class="r">構成比</th><th class="r">利回り</th>
    </tr></thead>
    <tbody>${rows.map((r) => `
      <tr>
        <td><span class="badge ${String(r.label).toLowerCase()}">${esc(r.label)}</span>
            <span style="margin-left:8px">${esc(classification(r.label).label)}</span></td>
        <td class="r">${r.count}</td>
        <td class="r">${yen(r.cost)}</td>
        <td class="r">${pct(r.share_pct, { digits: 1 })}</td>
        <td class="r teal">${pct(r.yield_pct)}</td>
      </tr>`).join('')}
    </tbody></table>`;
}

function rankTable(rows, valueKey, valueFormat) {
  if (!rows.length) return '<p class="muted" style="margin:0">データがありません</p>';
  return `<table class="data"><tbody>
    ${rows.map((r) => `
      <tr class="clickable" data-action="open-stock" data-id="${r.id}">
        <td style="width:44px" class="muted num">${esc(r.code)}</td>
        <td><span class="badge ${r.classification.toLowerCase()}"
                  title="${esc(classification(r.classification).label)}">${esc(r.classification)}</span>
            <span style="margin-left:8px">${esc(r.name)}</span></td>
        <td class="r">${valueFormat(r[valueKey])}</td>
      </tr>`).join('')}
  </tbody></table>`;
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
            「データ」タブから JSON を読み込むか、「保有一覧」から銘柄を追加してください。
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
      ${summaryCard('加重平均利回り', pct(s.weighted_yield), { cls: 'teal', sub: '取得価格ベース' })}
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

    ${rulesCard(data.rules)}

    <div class="card">
      <div class="card-head">
        <h3 class="card-title">景気敏感 / ディフェンシブ</h3>
        <p class="card-note">投資額ベース</p>
      </div>
      ${charts.donut(
    data.by_classification.map((r) => ({
      label: classification(r.label).short,
      value: r.cost,
      color: classificationColor(r.label),   // K = 赤 / D = 青 をバッジと揃える
    })),
    { size: 160, thickness: 24, unit: (v) => `${charts.compact(v)}円` },
  )}
      ${classificationBreakdown(data.by_classification)}
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card" style="margin-top:0">
        <div class="card-head">
          <h3 class="card-title">配当額 上位</h3>
          <p class="card-note">年間の受取見込み</p>
        </div>
        ${rankTable(data.top_dividend, 'annual_dividend', (v) => `<span class="gold">${yen(v)}</span>`)}
      </div>

      <div class="card" style="margin-top:0">
        <div class="card-head">
          <h3 class="card-title">取得利回り 上位</h3>
          <p class="card-note">買った値段に対する配当利回り</p>
        </div>
        ${rankTable(data.top_yield, 'yield_on_cost', (v) => `<span class="teal">${pct(v)}</span>`)}
      </div>
    </div>`;

  delegate(root, 'click', {
    'open-stock': (target) => navigate(`stock/${target.dataset.id}`),
    'edit-sector-limit': () => limitForm({
      title: 'セクター集中度の上限',
      name: 'max_sector_pct',
      label: '1 セクターあたりの上限 (%)',
      hint: '年間配当に占める割合で判定します。既定は 20% です。',
      current: data.rules.sector.limit_pct,
      min: 1,
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
