// 画面遷移(ハッシュルーティング)と初期化。

import { api, onStatusChange } from './lib/api.js?v=202608312331';
import { init as initData } from './lib/api.js?v=202608312331';
import { esc, qs, qsa, toast } from './lib/dom.js?v=202608312331';
import * as theme from './lib/theme.js?v=202608312331';
import * as dashboard from './views/dashboard.js?v=202608312331';
import * as holdings from './views/holdings.js?v=202608312331';
import * as ledger from './views/ledger.js?v=202608312331';
import * as settings from './views/settings.js?v=202608312331';
import * as stockDetail from './views/stockDetail.js?v=202608312331';

const ROUTES = [
  { pattern: /^dashboard$/, tab: 'dashboard', view: dashboard },
  { pattern: /^holdings$/, tab: 'holdings', view: holdings },
  { pattern: /^ledger$/, tab: 'ledger', view: ledger },
  { pattern: /^settings$/, tab: 'settings', view: settings },
  { pattern: /^stock\/(\d+)$/, tab: 'holdings', view: stockDetail },
];

const main = qs('#main');

function navigate(path) {
  if (location.hash.slice(1) === path) route();
  else location.hash = path;
}

async function route() {
  const path = location.hash.slice(1) || 'dashboard';
  const match = ROUTES.map((r) => ({ ...r, m: r.pattern.exec(path) })).find((r) => r.m);
  const target = match ?? ROUTES[0];
  qsa('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === target.tab));
  window.scrollTo({ top: 0 });
  try {
    await target.view.render(main, { navigate, params: target.m ? target.m.slice(1) : [] });
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="empty-state"><h3>画面の表示に失敗しました</h3><p>${err.message}</p></div>`;
  }
}

const STORAGE_LABEL = {
  github: { text: 'GitHub と同期', cls: 'ok' },
  local: { text: 'この端末にのみ保存', cls: 'warn' },
  offline: { text: 'オフライン(未同期)', cls: 'bad' },
};

async function refreshBadge() {
  try {
    const { counts } = await api.health();
    const status = api.status();
    const label = STORAGE_LABEL[status.mode] || STORAGE_LABEL.local;
    qs('#brandSub').innerHTML =
      `${counts.stocks} 銘柄 · ${counts.positions} ロット · ${counts.transactions} 取引`
      + ` <span class="storage-chip ${label.cls}" title="${esc(status.repo || '保存先未設定')}">`
      + `${label.text}${status.pending ? ' · 未保存あり' : ''}</span>`;
  } catch (err) {
    qs('#brandSub').textContent = `データを読み込めません: ${err.message}`;
  }
}

function paintThemeToggle() {
  const button = qs('#themeToggle');
  const isDark = theme.current() === 'dark';
  // ボタンには「切り替えた先」を出す(押すと何になるかが分かるように)
  qs('.theme-icon', button).textContent = isDark ? '☀' : '☾';
  qs('.theme-label', button).textContent = isDark ? '明るい表示' : '暗い表示';
  button.setAttribute('aria-label', isDark ? '明るい表示に切り替える' : '暗い表示に切り替える');
}

qs('#themeToggle').addEventListener('click', () => {
  theme.toggle();
  paintThemeToggle();
  route();          // グラフは配色を CSS 変数から読むため、描き直す
});

qsa('.tab').forEach((tab) => {
  tab.addEventListener('click', () => navigate(tab.dataset.view));
});

window.addEventListener('hashchange', () => { route(); refreshBadge(); });

// 保存に失敗したときなど、状態が変わったら見出しの表示を更新する
onStatusChange((status) => {
  refreshBadge();
  if (status.warning) toast(status.warning, 'error', 9000);
});

theme.restore();
paintThemeToggle();

// データを読み込んでから最初の描画を行う
initData()
  .then((result) => {
    if (result.firstRun) {
      toast('接続先にデータがまだありません。最初の保存で作成されます。', 'info', 8000);
    }
    route();
    refreshBadge();
  })
  .catch((err) => {
    main.innerHTML = `<div class="empty-state"><h3>データを読み込めませんでした</h3>`
      + `<p>${esc(err.message)}</p>`
      + '<p>「データ」タブから保存先の設定を確認してください。</p></div>';
    qsa('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === 'settings'));
  });
