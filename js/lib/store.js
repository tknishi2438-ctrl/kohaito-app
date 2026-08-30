// メモリ上の JSON ドキュメントに対する読み書き。
//
// もとは SQLite + app/repository.py が担っていた層。保存先(GitHub / ブラウザ)は
// persist.js が受け持ち、この層はデータの整合性だけに責任を持つ。

import { computePosition, LedgerError, TX_TYPES, SPLIT } from './models.js?v=202608302154';
import { normalizeMonth } from './format.js?v=202608302154';
import { DEFAULT_MAX_SECTOR_PCT, DEFAULT_MAX_STOCK_DIVIDEND_PCT } from './rules.js?v=202608302154';

export const FORMAT = 'khk-portfolio';
export const VERSION = 2;

export class NotFound extends Error {
  constructor(message) { super(message); this.name = 'NotFound'; this.status = 404; }
}
export class Conflict extends Error {
  constructor(message) { super(message); this.name = 'Conflict'; this.status = 409; }
}
export class Invalid extends Error {
  constructor(message) { super(message); this.name = 'Invalid'; this.status = 400; }
}

export function emptyDocument() {
  return {
    format: FORMAT,
    version: VERSION,
    updated_at: new Date().toISOString(),
    settings: {
      max_sector_pct: DEFAULT_MAX_SECTOR_PCT,
      max_stock_dividend_pct: DEFAULT_MAX_STOCK_DIVIDEND_PCT,
    },
    stocks: [],
    positions: [],
    transactions: [],
    dividend_history: [],
    profit_history: [],
  };
}

/** 読み込んだ JSON を、欠けている項目を補いながら受け入れる。 */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object') return emptyDocument();
  if (raw.format && raw.format !== FORMAT) {
    throw new Invalid('このファイルはこのアプリのデータ形式ではありません');
  }
  const base = emptyDocument();
  return {
    ...base,
    ...raw,
    settings: { ...base.settings, ...(raw.settings || {}) },
    stocks: raw.stocks || [],
    positions: raw.positions || [],
    transactions: raw.transactions || [],
    dividend_history: raw.dividend_history || [],
    profit_history: raw.profit_history || [],
  };
}

function nextId(rows) {
  return rows.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1;
}

function nowIso() {
  return new Date().toISOString().slice(0, 19);
}

export class Store {
  constructor(doc = emptyDocument()) {
    this.doc = normalize(doc);
  }

  replace(doc) {
    this.doc = normalize(doc);
    return this.doc;
  }

  toJSON() {
    return { ...this.doc, updated_at: new Date().toISOString() };
  }

  // ------------------------------------------------------------ 設定

  getSettings() {
    return { ...this.doc.settings };
  }

  updateSettings(patch) {
    if ('max_sector_pct' in patch) {
      const v = Number(patch.max_sector_pct);
      if (!(v >= 1 && v <= 100)) throw new Invalid('セクター上限は 1〜100% の範囲で指定してください');
      this.doc.settings.max_sector_pct = v;
    }
    if ('max_stock_dividend_pct' in patch) {
      const v = Number(patch.max_stock_dividend_pct);
      if (!(v >= 0.1 && v <= 100)) {
        throw new Invalid('配当集中度の上限は 0.1〜100% の範囲で指定してください');
      }
      this.doc.settings.max_stock_dividend_pct = v;
    }
    return this.getSettings();
  }

  // ------------------------------------------------------------ 銘柄

  listStocks() {
    return [...this.doc.stocks].sort((a, b) => String(a.code).localeCompare(String(b.code)));
  }

  getStock(id) {
    const stock = this.doc.stocks.find((s) => s.id === Number(id));
    if (!stock) throw new NotFound(`銘柄 id=${id} が見つかりません`);
    return stock;
  }

  findStockByCode(code) {
    return this.doc.stocks.find((s) => String(s.code) === String(code)) || null;
  }

  createStock(data) {
    const code = String(data.code || '').trim();
    const name = String(data.name || '').trim();
    if (!code) throw new Invalid('証券コードは必須です');
    if (!name) throw new Invalid('銘柄名は必須です');
    if (this.findStockByCode(code)) throw new Conflict(`証券コード ${code} は既に登録されています`);

    const stock = {
      id: nextId(this.doc.stocks),
      code,
      name,
      sector: String(data.sector || ''),
      classification: String(data.classification || 'K').toUpperCase(),
      timing: String(data.timing || ''),
      dividend_per_share: Number(data.dividend_per_share || 0),
      fiscal_month: data.fiscal_month ? Number(data.fiscal_month) : null,
      pays_interim: data.pays_interim === undefined ? 1 : Number(data.pays_interim),
      market_price: data.market_price ?? null,
      market_price_date: data.market_price_date ?? null,
      forecast_dividend: data.forecast_dividend ?? null,
      per: data.per ?? null,
      pbr: data.pbr ?? null,
      memo: String(data.memo || ''),
      irbank_synced_at: data.irbank_synced_at ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    this.doc.stocks.push(stock);
    return stock;
  }

  updateStock(id, patch) {
    const stock = this.getStock(id);
    if ('code' in patch) {
      const code = String(patch.code).trim();
      const other = this.findStockByCode(code);
      if (other && other.id !== stock.id) {
        throw new Conflict(`証券コード ${code} は他の銘柄が使用しています`);
      }
    }
    const allowed = [
      'code', 'name', 'sector', 'classification', 'timing', 'dividend_per_share',
      'fiscal_month', 'pays_interim', 'market_price', 'market_price_date',
      'forecast_dividend', 'per', 'pbr', 'memo', 'irbank_synced_at',
    ];
    for (const key of allowed) {
      if (key in patch) stock[key] = patch[key];
    }
    if ('classification' in patch) {
      stock.classification = String(patch.classification || 'K').toUpperCase();
    }
    stock.updated_at = nowIso();
    return stock;
  }

  deleteStock(id) {
    const stock = this.getStock(id);
    const positionIds = this.doc.positions.filter((p) => p.stock_id === stock.id).map((p) => p.id);
    this.doc.transactions = this.doc.transactions.filter((t) => !positionIds.includes(t.position_id));
    this.doc.positions = this.doc.positions.filter((p) => p.stock_id !== stock.id);
    this.doc.dividend_history = this.doc.dividend_history.filter((r) => r.stock_id !== stock.id);
    this.doc.profit_history = this.doc.profit_history.filter((r) => r.stock_id !== stock.id);
    this.doc.stocks = this.doc.stocks.filter((s) => s.id !== stock.id);
  }

  // -------------------------------------------------------- ポジション

  listPositions(stockId = null) {
    const rows = stockId === null
      ? this.doc.positions
      : this.doc.positions.filter((p) => p.stock_id === Number(stockId));
    return [...rows].sort((a, b) => a.id - b.id);
  }

  getPosition(id) {
    const position = this.doc.positions.find((p) => p.id === Number(id));
    if (!position) throw new NotFound(`ポジション id=${id} が見つかりません`);
    return position;
  }

  createPosition(data) {
    const stock = this.getStock(data.stock_id);
    const position = {
      id: nextId(this.doc.positions),
      stock_id: stock.id,
      label: String(data.label || ''),
      account: String(data.account || ''),
      note: String(data.note || ''),
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    this.doc.positions.push(position);
    return position;
  }

  updatePosition(id, patch) {
    const position = this.getPosition(id);
    for (const key of ['label', 'account', 'note']) {
      if (key in patch) position[key] = String(patch[key] || '');
    }
    position.updated_at = nowIso();
    return position;
  }

  deletePosition(id) {
    const position = this.getPosition(id);
    this.doc.transactions = this.doc.transactions.filter((t) => t.position_id !== position.id);
    this.doc.positions = this.doc.positions.filter((p) => p.id !== position.id);
  }

  // ------------------------------------------------------------ 取引

  listTransactions(positionId = null) {
    const rows = positionId === null
      ? this.doc.transactions
      : this.doc.transactions.filter((t) => t.position_id === Number(positionId));
    return [...rows];
  }

  getTransaction(id) {
    const tx = this.doc.transactions.find((t) => t.id === Number(id));
    if (!tx) throw new NotFound(`取引 id=${id} が見つかりません`);
    return tx;
  }

  /** 保存する取引の中身を検証して整える。 */
  static validateTransaction(data) {
    const type = String(data.type || '').toUpperCase();
    if (!TX_TYPES.includes(type)) {
      throw new Invalid('取引種別は BUY / SELL / SPLIT のいずれかです');
    }
    const payload = {
      type,
      // 取引日は年月(YYYY-MM)で保持する
      trade_date: normalizeMonth(data.trade_date),
      note: String(data.note || ''),
      shares: 0, price: 0, fee: 0, split_from: null, split_to: null,
    };
    if (type === SPLIT) {
      const from = Number(data.split_from || 0);
      const to = Number(data.split_to || 0);
      if (!(from > 0) || !(to > 0)) {
        throw new Invalid('分割比率には 1 以上の数値を 2 つ入力してください');
      }
      payload.split_from = from;
      payload.split_to = to;
    } else {
      const shares = Number(data.shares || 0);
      const price = Number(data.price || 0);
      if (!(shares > 0)) throw new Invalid('株数は 1 以上で入力してください');
      if (price < 0) throw new Invalid('株価に負の数は入力できません');
      payload.shares = shares;
      payload.price = price;
      payload.fee = Number(data.fee || 0);
    }
    return payload;
  }

  /** 保存後の台帳が計算可能か(売り過ぎていないか)を検証する。 */
  assertLedgerValid(positionId) {
    computePosition(this.listTransactions(positionId));
  }

  createTransaction(data) {
    const position = this.getPosition(data.position_id);
    const payload = Store.validateTransaction(data);
    const tx = {
      id: nextId(this.doc.transactions),
      position_id: position.id,
      ...payload,
      created_at: nowIso(),
    };
    this.doc.transactions.push(tx);
    try {
      this.assertLedgerValid(position.id);
    } catch (err) {
      this.doc.transactions = this.doc.transactions.filter((t) => t.id !== tx.id);
      throw err;
    }
    return tx;
  }

  updateTransaction(id, patch) {
    const tx = this.getTransaction(id);
    const before = { ...tx };
    const payload = Store.validateTransaction({ ...tx, ...patch });
    Object.assign(tx, payload);
    try {
      this.assertLedgerValid(tx.position_id);
    } catch (err) {
      Object.assign(tx, before);
      throw err;
    }
    return tx;
  }

  deleteTransaction(id) {
    const tx = this.getTransaction(id);
    const index = this.doc.transactions.indexOf(tx);
    this.doc.transactions.splice(index, 1);
    try {
      this.assertLedgerValid(tx.position_id);
    } catch (err) {
      this.doc.transactions.splice(index, 0, tx);
      throw err;
    }
  }

  // -------------------------------------------------- IRBANK 由来の履歴

  getDividendHistory(stockId) {
    return this.doc.dividend_history
      .filter((r) => r.stock_id === Number(stockId))
      .sort((a, b) => a.fiscal_year - b.fiscal_year);
  }

  getProfitHistory(stockId) {
    return this.doc.profit_history
      .filter((r) => r.stock_id === Number(stockId))
      .sort((a, b) => a.fiscal_year - b.fiscal_year);
  }
}

export { LedgerError };
