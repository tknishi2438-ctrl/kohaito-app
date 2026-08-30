// 画面から見た「データの窓口」。
//
// もとはサーバの REST API を叩いていた層。呼び出し方は変えずに、
// 中身をブラウザ内の計算 + GitHub への保存に置き換えている。
// 書き込みのたびに保存し、失敗したら画面に伝える。

import { Store } from './store.js?v=202608302253';
import * as portfolioLib from './portfolio.js?v=202608302253';
import * as portability from './portability.js?v=202608302253';
import { Persistence, RemoteChanged } from './persist.js?v=202608302253';

const store = new Store();
const persistence = new Persistence();

let loaded = false;
const listeners = new Set();

/** 保存状況が変わったときに画面へ知らせる。 */
export function onStatusChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(extra = {}) {
  const status = { ...persistence.status(), ...extra };
  listeners.forEach((fn) => fn(status));
  return status;
}

/** 起動時に一度だけ呼ぶ。保存先からデータを読み込む。 */
export async function init() {
  const result = await persistence.load();
  store.replace(result.doc);
  loaded = true;
  notify({ warning: result.warning, firstRun: result.firstRun });
  return result;
}

function ensureLoaded() {
  if (!loaded) throw new Error('データがまだ読み込まれていません');
}

/** 変更を保存する。GitHub が使えないときは手元に残す。 */
async function persist(message) {
  const result = await persistence.save(store.toJSON(), message);
  notify({ warning: result.warning });
  return result;
}

export const api = {
  // ------------------------------------------------------------ 状態
  status: () => persistence.status(),

  health: async () => {
    ensureLoaded();
    return {
      ok: true,
      counts: {
        stocks: store.doc.stocks.length,
        positions: store.doc.positions.length,
        transactions: store.doc.transactions.length,
      },
      storage: persistence.status(),
    };
  },

  reload: async () => {
    const doc = await persistence.reload();
    store.replace(doc);
    notify();
    return { ok: true };
  },

  // -------------------------------------------------------- 集計・一覧
  dashboard: async () => { ensureLoaded(); return portfolioLib.dashboard(store); },
  listStocks: async () => { ensureLoaded(); return { stocks: portfolioLib.listStockViews(store) }; },
  getStock: async (id) => { ensureLoaded(); return portfolioLib.getStockView(store, id); },

  // ------------------------------------------------------------ 銘柄
  createStock: async (data) => {
    const stock = store.createStock(data);
    await persist(`銘柄を追加: ${stock.code} ${stock.name}`);
    return stock;
  },
  updateStock: async (id, data) => {
    const stock = store.updateStock(id, data);
    await persist(`銘柄を更新: ${stock.code} ${stock.name}`);
    return stock;
  },
  deleteStock: async (id) => {
    const stock = store.getStock(id);
    store.deleteStock(id);
    await persist(`銘柄を削除: ${stock.code} ${stock.name}`);
    return { deleted: Number(id) };
  },

  // -------------------------------------------------------- ポジション
  createPosition: async (data) => {
    const position = store.createPosition(data);
    await persist('ロットを追加');
    return position;
  },
  updatePosition: async (id, data) => {
    const position = store.updatePosition(id, data);
    await persist('ロットを更新');
    return position;
  },
  deletePosition: async (id) => {
    store.deletePosition(id);
    await persist('ロットを削除');
    return { deleted: Number(id) };
  },

  // ------------------------------------------------------------ 取引
  listTransactions: async (params = {}) => {
    ensureLoaded();
    if (params.position_id) {
      const rows = store.listTransactions(params.position_id);
      return { transactions: rows };
    }
    return { transactions: portfolioLib.listAllTransactions(store) };
  },
  createTransaction: async (data) => {
    const tx = store.createTransaction(data);
    await persist(`取引を追加: ${tx.type} ${tx.trade_date || '日付なし'}`);
    return tx;
  },
  updateTransaction: async (id, data) => {
    const tx = store.updateTransaction(id, data);
    await persist('取引を更新');
    return tx;
  },
  deleteTransaction: async (id) => {
    store.deleteTransaction(id);
    await persist('取引を削除');
    return { deleted: Number(id) };
  },

  // ------------------------------------------------------------ 設定
  getSettings: async () => { ensureLoaded(); return store.getSettings(); },
  updateSettings: async (data) => {
    const settings = store.updateSettings(data);
    await persist('分散ルールを更新');
    return settings;
  },

  // ------------------------------------------------------------ 入出力
  exportJson: () => JSON.stringify(store.toJSON(), null, 2),
  exportCsv: () => portability.exportCsv(store),

  importJson: async (payload, replace) => {
    const result = portability.importJson(store, payload, replace);
    await persist(replace ? 'データを置き換え' : 'データを読み込み');
    return result;
  },
  importCsv: async (text) => {
    const result = portability.importCsv(store, text);
    await persist('CSV を読み込み');
    return result;
  },

  // ------------------------------------------------ IRBANK(この版では非対応)
  /**
   * ブラウザからは irbank.net を直接読めない(CORS で拒否される)ため、
   * 株価と配当の更新は GitHub Actions の定期実行に任せている。
   */
  syncStock: async () => {
    throw new Error(
      'ブラウザから IRBANK を直接読み込むことはできません。'
      + '株価と配当は毎晩 GitHub Actions が自動更新します。',
    );
  },
  syncAll: async () => {
    throw new Error(
      'ブラウザから IRBANK を直接読み込むことはできません。'
      + '株価と配当は毎晩 GitHub Actions が自動更新します。',
    );
  },
};

export { store, persistence, RemoteChanged };
