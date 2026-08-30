// データの保存先を束ねる層。
//
// 接続設定があれば GitHub、無ければブラウザ内(localStorage)に保存する。
// GitHub を使う場合も、通信できないときのために手元に控えを残す。

import { GitHubStore, RemoteChanged } from './github.js?v=202608302154';
import { emptyDocument, normalize } from './store.js?v=202608302154';

const CONFIG_KEY = 'khk.github';
const CACHE_KEY = 'khk.document';

function readLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function getConfig() {
  const config = readLocal(CONFIG_KEY);
  if (!config || !config.owner || !config.repo || !config.token) return null;
  return { path: 'portfolio.json', branch: 'main', ...config };
}

export function setConfig(config) {
  if (config === null) {
    try { localStorage.removeItem(CONFIG_KEY); } catch { /* 消せなくても続行 */ }
    return null;
  }
  writeLocal(CONFIG_KEY, config);
  return getConfig();
}

export function isConnected() {
  return getConfig() !== null;
}

/** 保存先を隠して、読み書きの窓口だけを見せる。 */
export class Persistence {
  constructor() {
    this.remote = null;
    this.mode = 'local';        // 'github' | 'local'
    this.lastSyncedAt = null;
    this.pendingLocalChanges = false;
  }

  connect(config) {
    this.remote = new GitHubStore(config);
    this.mode = 'github';
    return this.remote;
  }

  disconnect() {
    this.remote = null;
    this.mode = 'local';
  }

  /**
   * 保存先からデータを読む。
   * GitHub に繋がらない場合は手元の控えで起動し、その旨を返す。
   */
  async load() {
    const config = getConfig();
    if (config) {
      this.connect(config);
      try {
        const remote = await this.remote.load();
        if (remote === null) {
          // まだファイルが無い。手元の内容を初回コミットの種にする
          const local = readLocal(CACHE_KEY);
          const doc = normalize(local || emptyDocument());
          return { doc, mode: 'github', warning: null, firstRun: true };
        }
        const doc = normalize(remote);
        writeLocal(CACHE_KEY, doc);
        this.lastSyncedAt = new Date().toISOString();
        this.pendingLocalChanges = false;
        return { doc, mode: 'github', warning: null, firstRun: false };
      } catch (err) {
        const cached = readLocal(CACHE_KEY);
        this.mode = 'offline';
        return {
          doc: normalize(cached || emptyDocument()),
          mode: 'offline',
          warning: `GitHub から読み込めませんでした: ${err.message}`
            + (cached ? ' この端末に残っていた内容を表示しています。' : ''),
          firstRun: false,
        };
      }
    }

    this.disconnect();
    return {
      doc: normalize(readLocal(CACHE_KEY) || emptyDocument()),
      mode: 'local',
      warning: null,
      firstRun: false,
    };
  }

  /**
   * データを保存する。
   * GitHub 接続時は手元にも控えを残し、通信に失敗しても入力が消えないようにする。
   */
  async save(doc, message = 'ポートフォリオを更新') {
    writeLocal(CACHE_KEY, doc);

    if (this.mode !== 'github' || !this.remote) {
      this.pendingLocalChanges = this.mode === 'offline';
      return { saved: this.mode, warning: null };
    }

    try {
      await this.remote.save(doc, message);
      this.lastSyncedAt = new Date().toISOString();
      this.pendingLocalChanges = false;
      return { saved: 'github', warning: null };
    } catch (err) {
      this.pendingLocalChanges = true;
      if (err instanceof RemoteChanged) throw err;
      return {
        saved: 'local',
        warning: `GitHub に保存できませんでした: ${err.message}`
          + ' 変更はこの端末に保持しています。',
      };
    }
  }

  /** GitHub の最新を読み直す(衝突したときの復帰用)。 */
  async reload() {
    if (!this.remote) throw new Error('GitHub に接続していません');
    const remote = await this.remote.load();
    const doc = normalize(remote || emptyDocument());
    writeLocal(CACHE_KEY, doc);
    this.lastSyncedAt = new Date().toISOString();
    this.pendingLocalChanges = false;
    return doc;
  }

  status() {
    const config = getConfig();
    return {
      mode: this.mode,
      connected: this.mode === 'github',
      repo: config ? `${config.owner}/${config.repo}` : null,
      path: config ? config.path : null,
      last_synced_at: this.lastSyncedAt,
      pending: this.pendingLocalChanges,
    };
  }
}

export { RemoteChanged };
