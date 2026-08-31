// データ管理: 保存先(GitHub)の設定、書き出し、読み込み。

import { api } from '../lib/api.js?v=202608312316';
import { confirmDialog, delegate, esc, modal, qs, toast } from '../lib/dom.js?v=202608312316';
import { dateTime } from '../lib/format.js?v=202608312316';
import { download } from '../lib/portability.js?v=202608312316';
import { GitHubStore } from '../lib/github.js?v=202608312316';
import { getConfig, setConfig } from '../lib/persist.js?v=202608312316';

/** ファイル選択ダイアログを開いてテキストとして読む。 */
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result) });
      reader.onerror = () => resolve(null);
      reader.readAsText(file, 'utf-8');
    });
    input.click();
  });
}

function stamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * 配信されている URL から接続先を推測して初期値にする。
 * スマホでの設定時に、トークンを貼るだけで済むようにするため。
 *   https://<ユーザー名>.github.io/<何か>-app/  →  <ユーザー名> / <何か>-data
 */
function guessConfig() {
  const host = location.hostname.match(/^([\w-]+)\.github\.io$/);
  const segment = location.pathname.split('/').filter(Boolean)[0] || '';
  return {
    owner: host ? host[1] : '',
    repo: segment.endsWith('-app') ? `${segment.slice(0, -4)}-data` : '',
    path: 'portfolio.json',
    branch: 'main',
  };
}

function connectionForm(current, onDone) {
  const guess = guessConfig();
  const value = (name) => esc(current?.[name] ?? guess[name] ?? '');

  modal({
    title: '保存先(GitHub)の設定',
    submitLabel: '接続する',
    wide: true,
    body: `
      <p class="hint" style="margin:0 0 16px">
        データを GitHub の<b style="color:var(--text-2)">非公開</b>リポジトリに保存します。
        端末ごとに一度だけ設定が必要です。<br>
        <b style="color:var(--text-2)">下の欄はこの画面の URL から推測して埋めてあります。
        アクセストークンだけ貼り付けてください。</b>
      </p>
      <div class="field-row">
        ${['owner', 'repo'].map((name) => `
          <div class="field">
            <label>${name === 'owner' ? 'GitHub のユーザー名' : 'データ用リポジトリ名'}</label>
            <input class="input" name="${name}" required
                   autocapitalize="off" autocorrect="off" spellcheck="false"
                   value="${value(name)}"
                   placeholder="${name === 'owner' ? 'your-account' : 'kohaito-data'}">
          </div>`).join('')}
      </div>
      <div class="field-row">
        <div class="field">
          <label>ファイル名</label>
          <input class="input" name="path" value="${value('path')}" required
                 autocapitalize="off" autocorrect="off" spellcheck="false">
        </div>
        <div class="field">
          <label>ブランチ</label>
          <input class="input" name="branch" value="${value('branch')}" required
                 autocapitalize="off" autocorrect="off" spellcheck="false">
        </div>
      </div>
      <div class="field">
        <label>アクセストークン</label>
        <input class="input" type="password" name="token" required autocomplete="off"
               autocapitalize="off" autocorrect="off" spellcheck="false"
               value="${esc(current?.token ?? '')}" placeholder="github_pat_... を貼り付け">
        <p class="hint">
          GitHub の <span class="mono">Settings → Developer settings → Personal access tokens
          → Fine-grained tokens</span> で作成します。<br>
          対象リポジトリを<b style="color:var(--text-2)">このデータ用リポジトリだけ</b>に絞り、
          権限は <span class="mono">Contents: Read and write</span> だけを与えてください。<br>
          トークンはこの端末のブラウザにのみ保存され、外部へは GitHub 以外に送信しません。
        </p>
      </div>`,
    onSubmit: async (data) => {
      const config = {
        owner: data.owner.trim(),
        repo: data.repo.trim(),
        path: data.path.trim() || 'portfolio.json',
        branch: data.branch.trim() || 'main',
        token: data.token.trim(),
      };
      // 保存する前に、本当に繋がるかを確かめる
      const info = await new GitHubStore(config).verify();
      if (!info.private) {
        const ok = await confirmDialog({
          title: 'このリポジトリは公開されています',
          message: `<b style="color:var(--red)">${esc(info.full_name)}</b> は公開リポジトリです。<br>`
            + '保存すると、保有銘柄・投資額・損益が<b style="color:var(--red)">誰からでも見える状態</b>になります。<br><br>'
            + 'GitHub の設定で非公開(Private)に変更してから接続することを強くおすすめします。',
          confirmLabel: '承知のうえで接続する',
        });
        if (!ok) throw new Error('接続を中止しました');
      }
      setConfig(config);
      toast(`${info.full_name} に接続しました。再読み込みします。`, 'success');
      setTimeout(() => location.reload(), 900);
      onDone?.();
    },
  });
}

export async function render(root, { navigate }) {
  root.innerHTML = '<div class="loading">読み込み中…</div>';
  const [health, settings] = await Promise.all([
    api.health().catch(() => null),
    api.getSettings().catch(() => ({})),
  ]);

  const counts = health?.counts ?? {};
  const status = api.status();
  const config = getConfig();
  const connected = status.mode === 'github';

  root.innerHTML = `
    <div class="card" style="margin-top:0">
      <div class="card-head">
        <h3 class="card-title">保存先</h3>
        <p class="card-note">
          銘柄 ${counts.stocks ?? '—'} / ロット ${counts.positions ?? '—'} / 取引 ${counts.transactions ?? '—'}
        </p>
      </div>

      ${connected ? `
        <dl class="kv" style="grid-template-columns:auto 1fr;max-width:520px">
          <dt>リポジトリ</dt><dd>${esc(status.repo)}</dd>
          <dt>ファイル</dt><dd>${esc(status.path)}</dd>
          <dt>最終同期</dt><dd>${esc(dateTime(status.last_synced_at))}</dd>
        </dl>
        <p class="hint">保存するたびに GitHub へコミットされます。変更履歴はすべて残ります。</p>
        <div class="toolbar" style="margin:14px 0 0">
          <button class="btn" data-action="reload">GitHub から読み直す</button>
          <button class="btn btn-ghost" data-action="edit-connection">設定を変更</button>
          <button class="btn btn-danger" data-action="disconnect">この端末の接続を解除</button>
        </div>
      ` : `
        <div class="notice" style="margin:0 0 14px">
          <div>
            <b>まだ GitHub に接続していません。</b><br>
            いまの保存先はこの端末のブラウザだけです。他の端末からは見られません。
            ${status.mode === 'offline' ? '<br>GitHub に接続できず、手元の控えを表示しています。' : ''}
          </div>
        </div>
        <button class="btn btn-primary" data-action="edit-connection">GitHub に接続する</button>
      `}
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card" style="margin-top:0">
        <div class="card-head"><h3 class="card-title">書き出し</h3></div>
        <p class="hint" style="margin:0 0 12px">
          <b style="color:var(--text-2)">JSON</b> は配当履歴まで含む完全な形式で、そのまま読み戻せます。<br>
          <b style="color:var(--text-2)">CSV</b> は 1 取引 = 1 行。スプレッドシートで編集して読み戻せます。
        </p>
        <div class="toolbar" style="margin:0">
          <button class="btn" data-action="export-json">JSON を書き出す</button>
          <button class="btn" data-action="export-csv">CSV を書き出す</button>
        </div>
      </div>

      <div class="card" style="margin-top:0">
        <div class="card-head"><h3 class="card-title">読み込み</h3></div>
        <p class="hint" style="margin:0 0 12px">
          既に登録済みの証券コードは重複登録されません。<br>
          置き換える場合は、事前に JSON を書き出しておくことをおすすめします。
        </p>
        <div class="toolbar" style="margin:0">
          <button class="btn" data-action="import-json">JSON を読み込む</button>
          <button class="btn" data-action="import-csv">CSV を読み込む</button>
          <button class="btn btn-danger" data-action="import-replace">JSON で全置換</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <h3 class="card-title">株価・配当の自動更新</h3>
        <p class="card-note">IRBANK</p>
      </div>
      <p class="hint" style="margin:0">
        IRBANK は<b style="color:var(--text-2)">ブラウザからの直接読み込みと、
        データセンターからのアクセスの両方を拒否します</b>。
        そのため株価・配当の更新は、自宅の回線につながった Mac から実行する必要があります。<br><br>
        Mac のターミナルで次を実行すると、取得から GitHub への反映までを行います。<br>
        <span class="mono">cd ~/Claude/高配当株管理 && ./sync/refresh.sh</span><br><br>
        実行後、この画面を再読み込みすると新しい株価が反映されます。
      </p>
    </div>

    <div class="card">
      <div class="card-head"><h3 class="card-title">分散ルール</h3></div>
      <dl class="kv" style="grid-template-columns:auto 1fr;max-width:420px">
        <dt>セクター集中度の上限</dt><dd>${settings.max_sector_pct ?? '—'} %</dd>
        <dt>配当の銘柄集中度の上限</dt><dd>${settings.max_stock_dividend_pct ?? '—'} %</dd>
      </dl>
      <p class="hint">変更はダッシュボードの「分散ルール」カードから行えます。</p>
    </div>`;

  const reload = () => render(root, { navigate });

  delegate(root, 'click', {
    'edit-connection': () => connectionForm(config, reload),

    disconnect: async () => {
      const ok = await confirmDialog({
        title: '接続を解除',
        message: 'この端末に保存しているトークンと接続設定を削除します。<br>'
          + 'GitHub 上のデータは消えません。再度接続すれば元どおり使えます。',
        confirmLabel: '解除する',
      });
      if (!ok) return;
      setConfig(null);
      toast('接続を解除しました。再読み込みします。', 'success');
      setTimeout(() => location.reload(), 700);
    },

    reload: async () => {
      try {
        await api.reload();
        toast('GitHub から読み直しました', 'success');
        reload();
      } catch (err) {
        toast(`読み直しに失敗しました: ${err.message}`, 'error');
      }
    },

    'export-json': () => download(`portfolio-${stamp()}.json`, api.exportJson()),
    'export-csv': () => download(`portfolio-${stamp()}.csv`, `﻿${api.exportCsv()}`, 'text/csv'),

    'import-json': async () => {
      const file = await pickFile('.json,application/json');
      if (!file) return;
      try {
        const result = await api.importJson(JSON.parse(file.text), false);
        toast(`読み込み完了: 銘柄 ${result.stocks} / ロット ${result.positions} / 取引 ${result.transactions}`, 'success');
        reload();
      } catch (err) {
        toast(`読み込みに失敗しました: ${err.message}`, 'error', 8000);
      }
    },

    'import-replace': async () => {
      const ok = await confirmDialog({
        title: 'JSON で全置換',
        message: '現在のデータを<b style="color:var(--red)">すべて削除</b>してから、'
          + '選んだ JSON の内容で置き換えます。<br>'
          + (connected
            ? 'GitHub にはコミットとして残るので、履歴からは復元できます。'
            : 'この端末のデータは戻せません。先に JSON を書き出しておいてください。'),
        confirmLabel: 'ファイルを選ぶ',
      });
      if (!ok) return;
      const file = await pickFile('.json,application/json');
      if (!file) return;
      try {
        const result = await api.importJson(JSON.parse(file.text), true);
        toast(`置き換えました: 銘柄 ${result.stocks} / 取引 ${result.transactions}`, 'success');
        reload();
      } catch (err) {
        toast(`読み込みに失敗しました: ${err.message}`, 'error', 8000);
      }
    },

    'import-csv': async () => {
      const file = await pickFile('.csv,text/csv');
      if (!file) return;
      try {
        const result = await api.importCsv(file.text);
        toast(`読み込み完了: 銘柄 ${result.stocks} / ロット ${result.positions} / 取引 ${result.transactions}`
          + (result.skipped ? ` (${result.skipped} 行はスキップ)` : ''), 'success');
        (result.errors || []).slice(0, 5).forEach((e) => toast(e, 'error', 8000));
        reload();
      } catch (err) {
        toast(`読み込みに失敗しました: ${err.message}`, 'error', 8000);
      }
    },
  });
}
