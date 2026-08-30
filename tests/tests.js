// 計算ロジックのテスト。Python 版 tests/test_models.py・test_repository.py の移植。

import { describe, it, expect } from './runner.js';
import {
  aggregate, computePosition, dividendMonths, evaluate, LedgerError,
} from '../js/lib/models.js';
import { evaluateSectors, evaluateStockDividends, headroom } from '../js/lib/rules.js';
import { Store } from '../js/lib/store.js';
import { fromBase64, toBase64 } from '../js/lib/github.js';
import { date as formatDate, normalizeMonth } from '../js/lib/format.js';
import { dashboard, getStockView, listStockViews } from '../js/lib/portfolio.js';

const tx = (id, type, date, extra = {}) => ({ id, type, trade_date: date, ...extra });

// ---------------------------------------------------------------- 台帳の計算

describe('取引台帳の畳み込み', () => {
  it('取引がなければ保有ゼロ', () => {
    const m = computePosition([]);
    expect(m.shares).toBe(0);
    expect(m.avg_price).toBe(0);
  });

  it('買付1件', () => {
    const m = computePosition([tx(1, 'BUY', '2024-01-01', { shares: 10, price: 1000 })]);
    expect(m.shares).toBe(10);
    expect(m.cost).toBe(10000);
    expect(m.avg_price).toBe(1000);
  });

  it('手数料は取得原価に含める', () => {
    const m = computePosition([tx(1, 'BUY', '2024-01-01', { shares: 10, price: 1000, fee: 500 })]);
    expect(m.cost).toBe(10500);
    expect(m.avg_price).toBe(1050);
  });

  it('2回の買付で平均取得単価を出す', () => {
    const m = computePosition([
      tx(1, 'BUY', '2024-01-01', { shares: 10, price: 1000 }),
      tx(2, 'BUY', '2024-02-01', { shares: 10, price: 1400 }),
    ]);
    expect(m.shares).toBe(20);
    expect(m.avg_price).toBe(1200);
  });

  it('1対2の分割で株数が倍・平均取得単価が半分', () => {
    const m = computePosition([
      tx(1, 'BUY', '2024-01-01', { shares: 10, price: 1000 }),
      tx(2, 'SPLIT', '2024-06-01', { split_from: 1, split_to: 2 }),
    ]);
    expect(m.shares).toBe(20);
    expect(m.cost).toBe(10000);
    expect(m.avg_price).toBe(500);
  });

  it('併合(10対1)で株数が減る', () => {
    const m = computePosition([
      tx(1, 'BUY', '2024-01-01', { shares: 100, price: 100 }),
      tx(2, 'SPLIT', '2024-06-01', { split_from: 10, split_to: 1 }),
    ]);
    expect(m.shares).toBe(10);
    expect(m.avg_price).toBe(1000);
  });

  it('分割はその時点の保有分にだけ効く', () => {
    const m = computePosition([
      tx(1, 'BUY', '2024-01-01', { shares: 10, price: 1000 }),
      tx(2, 'SPLIT', '2024-06-01', { split_from: 1, split_to: 2 }),
      tx(3, 'BUY', '2024-07-01', { shares: 10, price: 600 }),
    ]);
    expect(m.shares).toBe(30);
    expect(m.cost).toBe(16000);
    expect(m.avg_price).toBeCloseTo(16000 / 30, 3);
  });

  it('売却は平均取得単価で原価を取り崩す', () => {
    const m = computePosition([
      tx(1, 'BUY', '2024-01-01', { shares: 10, price: 1000 }),
      tx(2, 'SELL', '2024-05-01', { shares: 4, price: 1500 }),
    ]);
    expect(m.shares).toBe(6);
    expect(m.cost).toBe(6000);
    expect(m.realized_pl).toBe(4 * 1500 - 4000);
  });

  it('売却手数料は実現損益から差し引く', () => {
    const m = computePosition([
      tx(1, 'BUY', '2024-01-01', { shares: 10, price: 1000 }),
      tx(2, 'SELL', '2024-05-01', { shares: 4, price: 1500, fee: 200 }),
    ]);
    expect(m.realized_pl).toBe(4 * 1500 - 200 - 4000);
  });

  it('全部売ると保有と原価がゼロになる', () => {
    const m = computePosition([
      tx(1, 'BUY', '2024-01-01', { shares: 10, price: 1000 }),
      tx(2, 'SELL', '2024-05-01', { shares: 10, price: 1200 }),
    ]);
    expect(m.shares).toBe(0);
    expect(m.cost).toBe(0);
    expect(m.avg_price).toBe(0);
    expect(m.realized_pl).toBe(2000);
  });

  it('保有以上には売れない', () => {
    expect(() => computePosition([
      tx(1, 'BUY', '2024-01-01', { shares: 10, price: 1000 }),
      tx(2, 'SELL', '2024-05-01', { shares: 11, price: 1200 }),
    ])).toThrow('保有株数');
  });

  it('分割後の売却は分割後の株数で判定する', () => {
    const m = computePosition([
      tx(1, 'BUY', '2024-01-01', { shares: 10, price: 1000 }),
      tx(2, 'SPLIT', '2024-06-01', { split_from: 1, split_to: 2 }),
      tx(3, 'SELL', '2024-07-01', { shares: 15, price: 600 }),
    ]);
    expect(m.shares).toBe(5);
    expect(m.cost).toBe(2500);
    expect(m.realized_pl).toBe(15 * 600 - 7500);
  });

  it('入力順ではなく取引日順に畳み込む', () => {
    const m = computePosition([
      tx(2, 'SPLIT', '2024-06-01', { split_from: 1, split_to: 2 }),
      tx(1, 'BUY', '2024-01-01', { shares: 10, price: 1000 }),
    ]);
    expect(m.shares).toBe(20);
  });

  it('日付未設定の取引は最も古いものとして扱う', () => {
    const m = computePosition([
      tx(2, 'SPLIT', '2024-06-01', { split_from: 1, split_to: 2 }),
      tx(1, 'BUY', null, { shares: 10, price: 1000 }),
    ]);
    expect(m.shares).toBe(20);
  });

  it('不正な分割比率をはじく', () => {
    expect(() => computePosition([tx(1, 'SPLIT', '2024-01-01', { split_from: 0, split_to: 2 })]))
      .toThrow('分割比率');
  });

  it('未知の取引種別をはじく', () => {
    expect(() => computePosition([tx(1, 'GIFT', '2024-01-01', { shares: 1, price: 1 })]))
      .toThrow('未知の取引種別');
  });
});

// -------------------------------------------------------------------- 評価

describe('評価と利回り', () => {
  it('利回り・評価額・含み損益', () => {
    const m = computePosition([tx(1, 'BUY', '2024-01-01', { shares: 10, price: 1000 })]);
    const v = evaluate(m, 40, 1250);
    expect(v.annual_dividend).toBe(400);
    expect(v.yield_on_cost).toBeCloseTo(4.0, 4);
    expect(v.current_yield).toBeCloseTo(3.2, 4);
    expect(v.market_value).toBe(12500);
    expect(v.unrealized_pl).toBe(2500);
    expect(v.unrealized_pl_pct).toBeCloseTo(25.0, 4);
  });

  it('株価が無ければ評価はしない', () => {
    const m = computePosition([tx(1, 'BUY', '2024-01-01', { shares: 10, price: 1000 })]);
    const v = evaluate(m, 40, null);
    expect(v.market_value).toBe(0);
    expect(v.current_yield).toBe(0);
  });
});

describe('権利確定月の推定', () => {
  it('3月決算は3月と9月', () => expect(dividendMonths(3)).toEqual([3, 9]));
  it('12月決算は6月と12月', () => expect(dividendMonths(12)).toEqual([6, 12]));
  it('中間配当なしなら期末のみ', () => expect(dividendMonths(2, false)).toEqual([2]));
  it('決算月が不明なら空', () => {
    expect(dividendMonths(null)).toEqual([]);
    expect(dividendMonths(0)).toEqual([]);
  });
});

describe('サマリーの集計', () => {
  it('加重平均利回りは単純平均ではない', () => {
    const big = evaluate(computePosition([tx(1, 'BUY', '2024-01-01', { shares: 100, price: 1000 })]), 20);
    const small = evaluate(computePosition([tx(2, 'BUY', '2024-01-01', { shares: 1, price: 1000 })]), 100);
    const result = aggregate([big, small]);
    expect(result.total_cost).toBe(101000);
    expect(result.annual_dividend).toBe(2100);
    // 単純平均なら 6% だが、加重平均では約 2.08%
    expect(result.weighted_yield).toBeCloseTo((2100 / 101000) * 100, 3);
  });
});

// ---------------------------------------------------------------- 分散ルール

describe('セクター集中度', () => {
  it('余力を足すとちょうど上限になる', () => {
    const room = headroom(100000, 1000000, 20);
    expect(room).toBeCloseTo(125000, 3);
    expect(((100000 + room) / (1000000 + room)) * 100).toBeCloseTo(20.0, 6);
  });

  it('余力は単純な差額より大きい', () => {
    expect(headroom(100000, 1000000, 20)).toBeGreaterThan(0.2 * 1000000 - 100000);
  });

  it('超過分は負の余力(必要な圧縮額)になる', () => {
    const room = headroom(300000, 1000000, 20);
    expect(room).toBeLessThan(0);
    expect(((300000 + room) / (1000000 + room)) * 100).toBeCloseTo(20.0, 6);
  });

  it('ちょうど上限なら余力ゼロ', () => {
    expect(headroom(200000, 1000000, 20)).toBeCloseTo(0.0, 6);
  });

  it('均等なら適合', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      label: `業種${i}`, cost: 10000, share_pct: 10,
    }));
    const result = evaluateSectors(rows, 20);
    expect(result.passing).toBe(true);
    expect(result.max_share_pct).toBe(10);
  });

  it('偏っていれば超過として拾う', () => {
    const result = evaluateSectors([
      { label: '銀行', cost: 100000, share_pct: 83.3 },
      { label: '食料品', cost: 10000, share_pct: 8.3 },
      { label: '化学', cost: 10000, share_pct: 8.3 },
    ], 20);
    expect(result.passing).toBe(false);
    expect(result.over.map((r) => r.label)).toEqual(['銀行']);
    expect(result.over[0].headroom).toBeLessThan(0);
  });
});

describe('配当の銘柄集中度', () => {
  const views = (dividends, dps = 10, price = 1000) => dividends.map((d, i) => ({
    id: i, code: `100${i}`, name: `銘柄${i}`, sector: 'その他', classification: 'K',
    dividend_per_share: dps, market_price: price,
    metrics: { shares: 10, annual_dividend: d, avg_price: price },
  }));

  it('均等なら適合', () => {
    const result = evaluateStockDividends(views(new Array(50).fill(100)), 3);
    expect(result.passing).toBe(true);
    expect(result.even_share_pct).toBeCloseTo(2.0, 3);
  });

  it('偏った銘柄を拾う', () => {
    const result = evaluateStockDividends(views([500, ...new Array(50).fill(100)]), 3);
    expect(result.passing).toBe(false);
    expect(result.over.length).toBe(1);
    expect(result.over[0].name).toBe('銘柄0');
  });

  it('割合の降順に並ぶ', () => {
    const result = evaluateStockDividends(views([100, 300, 200]), 3);
    const shares = result.stocks.map((r) => r.share_pct);
    expect(shares).toEqual([...shares].sort((a, b) => b - a));
  });

  it('余力を1株配当で株数に換算する', () => {
    const result = evaluateStockDividends(views(new Array(20).fill(100), 10), 6);
    const row = result.stocks[0];
    expect(row.headroom_shares).toBeCloseTo(row.headroom / 10, 2);
  });

  it('超過なら株数も負(減らす量)になる', () => {
    const result = evaluateStockDividends(views([500, ...new Array(50).fill(100)]), 3);
    expect(result.over[0].headroom).toBeLessThan(0);
    expect(result.over[0].headroom_shares).toBeLessThan(0);
  });

  it('無配の銘柄は対象外', () => {
    const rows = views([100, 100]);
    rows.push({
      id: 99, code: '9999', name: '無配', sector: 'その他', classification: 'K',
      dividend_per_share: 0, market_price: 500,
      metrics: { shares: 10, annual_dividend: 0, avg_price: 500 },
    });
    const result = evaluateStockDividends(rows, 3);
    expect(result.stocks.map((r) => r.name)).notToContain('無配');
  });

  it('保有ゼロなら適合', () => {
    const result = evaluateStockDividends([], 3);
    expect(result.passing).toBe(true);
    expect(result.max_share_pct).toBe(0);
  });
});

// --------------------------------------------------------------- ストア操作

function newStore() {
  return new Store();
}

function seed(store, { code = '1234', name = 'テスト株', ...rest } = {}) {
  const stock = store.createStock({ code, name, ...rest });
  const position = store.createPosition({ stock_id: stock.id });
  return { stock, position };
}

describe('銘柄の登録と削除', () => {
  it('登録して取り出せる', () => {
    const store = newStore();
    const stock = store.createStock({ code: '8058', name: '三菱商事', sector: '卸売' });
    expect(store.getStock(stock.id).name).toBe('三菱商事');
    expect(store.findStockByCode('8058').id).toBe(stock.id);
  });

  it('証券コードの重複をはじく', () => {
    const store = newStore();
    store.createStock({ code: '8058', name: '三菱商事' });
    expect(() => store.createStock({ code: '8058', name: '別の名前' })).toThrow('既に登録');
  });

  it('コードと銘柄名は必須', () => {
    const store = newStore();
    expect(() => store.createStock({ code: '', name: 'x' })).toThrow('証券コード');
    expect(() => store.createStock({ code: '1234', name: '' })).toThrow('銘柄名');
  });

  it('銘柄を消すとロットと取引も消える', () => {
    const store = newStore();
    const { stock, position } = seed(store);
    store.createTransaction({ position_id: position.id, type: 'BUY', shares: 1, price: 100 });
    store.deleteStock(stock.id);
    expect(store.listPositions().length).toBe(0);
    expect(store.listTransactions().length).toBe(0);
  });
});

describe('取引の検証', () => {
  it('株数ゼロをはじく', () => {
    const store = newStore();
    const { position } = seed(store);
    expect(() => store.createTransaction({ position_id: position.id, type: 'BUY', shares: 0, price: 100 }))
      .toThrow('株数');
  });

  it('分割は両側の数値が必要', () => {
    const store = newStore();
    const { position } = seed(store);
    expect(() => store.createTransaction({
      position_id: position.id, type: 'SPLIT', split_from: 1, split_to: 0,
    })).toThrow('分割比率');
  });

  it('売り過ぎは保存時にはじき、記録も残さない', () => {
    const store = newStore();
    const { position } = seed(store);
    store.createTransaction({
      position_id: position.id, type: 'BUY', trade_date: '2024-01-01', shares: 5, price: 100,
    });
    expect(() => store.createTransaction({
      position_id: position.id, type: 'SELL', trade_date: '2024-02-01', shares: 9, price: 120,
    })).toThrow('保有株数');
    expect(store.listTransactions(position.id).length).toBe(1);
  });

  it('編集で台帳を壊せない', () => {
    const store = newStore();
    const { position } = seed(store);
    const buy = store.createTransaction({
      position_id: position.id, type: 'BUY', trade_date: '2024-01-01', shares: 10, price: 100,
    });
    store.createTransaction({
      position_id: position.id, type: 'SELL', trade_date: '2024-02-01', shares: 8, price: 120,
    });
    expect(() => store.updateTransaction(buy.id, { shares: 5 })).toThrow('保有株数');
    expect(store.getTransaction(buy.id).shares).toBe(10);
  });

  it('削除で台帳を壊せない', () => {
    const store = newStore();
    const { position } = seed(store);
    const buy = store.createTransaction({
      position_id: position.id, type: 'BUY', trade_date: '2024-01-01', shares: 10, price: 100,
    });
    store.createTransaction({
      position_id: position.id, type: 'SELL', trade_date: '2024-02-01', shares: 8, price: 120,
    });
    expect(() => store.deleteTransaction(buy.id)).toThrow('保有株数');
    expect(store.listTransactions(position.id).length).toBe(2);
  });
});

describe('ポートフォリオの組み立て', () => {
  it('同じコードでもロットは別、合計は合算', () => {
    const store = newStore();
    const stock = store.createStock({
      code: '1343', name: 'NF・J-REIT ETF', dividend_per_share: 40,
    });
    const lot1 = store.createPosition({ stock_id: stock.id, label: 'ロット1' });
    const lot2 = store.createPosition({ stock_id: stock.id, label: 'ロット2' });
    store.createTransaction({ position_id: lot1.id, type: 'BUY', trade_date: '2024-01-01', shares: 20, price: 1853 });
    store.createTransaction({ position_id: lot2.id, type: 'BUY', trade_date: '2024-05-01', shares: 4, price: 2000 });

    const view = getStockView(store, stock.id);
    expect(view.position_count).toBe(2);
    expect(view.metrics.shares).toBe(24);
    expect(view.positions[0].metrics.shares).toBe(20);
    expect(view.positions[1].metrics.shares).toBe(4);
    expect(view.metrics.avg_price).toBeCloseTo((20 * 1853 + 4 * 2000) / 24, 3);
    expect(view.metrics.annual_dividend).toBe(24 * 40);
  });

  it('ダッシュボードの合計と配当カレンダー', () => {
    const store = newStore();
    const { position } = seed(store, {
      code: '8058', name: '三菱商事', sector: '卸売',
      dividend_per_share: 100, fiscal_month: 3,
    });
    store.createTransaction({ position_id: position.id, type: 'BUY', trade_date: '2024-01-01', shares: 10, price: 2000 });

    const data = dashboard(store);
    expect(data.summary.total_cost).toBe(20000);
    expect(data.summary.annual_dividend).toBe(1000);
    expect(data.summary.weighted_yield).toBeCloseTo(5.0, 4);
    expect(data.calendar.months[2]).toBeCloseTo(500, 2);
    expect(data.calendar.months[8]).toBeCloseTo(500, 2);
    expect(data.calendar.unassigned).toBe(0);
  });

  it('決算月がなければ未計上に積む', () => {
    const store = newStore();
    const { position } = seed(store, { dividend_per_share: 100 });
    store.createTransaction({ position_id: position.id, type: 'BUY', trade_date: '2024-01-01', shares: 10, price: 1000 });
    const data = dashboard(store);
    expect(data.calendar.unassigned).toBe(1000);
    expect(data.calendar.months.reduce((a, b) => a + b, 0)).toBe(0);
    expect(data.needs_attention.no_fiscal_month.length).toBe(1);
  });

  it('売り切った銘柄は保有に数えない', () => {
    const store = newStore();
    const { position } = seed(store, { dividend_per_share: 100 });
    store.createTransaction({ position_id: position.id, type: 'BUY', trade_date: '2024-01-01', shares: 10, price: 1000 });
    store.createTransaction({ position_id: position.id, type: 'SELL', trade_date: '2024-06-01', shares: 10, price: 1200 });
    const data = dashboard(store);
    expect(data.summary.holdings).toBe(0);
    expect(data.summary.annual_dividend).toBe(0);
    expect(data.summary.realized_pl).toBe(2000);
  });

  it('売却済みのセクターは分散ルールに出さない', () => {
    const store = newStore();
    const a = seed(store, { code: '1001', name: '売却済み', sector: '銀行' });
    store.createTransaction({ position_id: a.position.id, type: 'BUY', trade_date: '2024-01-01', shares: 100, price: 1000 });
    store.createTransaction({ position_id: a.position.id, type: 'SELL', trade_date: '2024-06-01', shares: 100, price: 1100 });
    const b = seed(store, { code: '1002', name: '保有中', sector: '食料品' });
    store.createTransaction({ position_id: b.position.id, type: 'BUY', trade_date: '2024-01-01', shares: 10, price: 1000 });

    const labels = dashboard(store).rules.sector.sectors.map((r) => r.label);
    expect(labels).notToContain('銀行');
  });

  it('設定した上限が判定に反映される', () => {
    const store = newStore();
    const a = seed(store, { code: '1001', name: '銀行株', sector: '銀行' });
    store.createTransaction({ position_id: a.position.id, type: 'BUY', trade_date: '2024-01-01', shares: 60, price: 1000 });
    const b = seed(store, { code: '1002', name: '食品株', sector: '食料品' });
    store.createTransaction({ position_id: b.position.id, type: 'BUY', trade_date: '2024-01-01', shares: 40, price: 1000 });

    expect(dashboard(store).rules.sector.passing).toBe(false);
    store.updateSettings({ max_sector_pct: 70 });
    expect(dashboard(store).rules.sector.passing).toBe(true);
  });

  it('不正な上限をはじく', () => {
    const store = newStore();
    expect(() => store.updateSettings({ max_sector_pct: 0 })).toThrow('1〜100');
    expect(() => store.updateSettings({ max_stock_dividend_pct: 101 })).toThrow('0.1〜100');
  });

  it('一覧は証券コード順', () => {
    const store = newStore();
    seed(store, { code: '9999', name: 'あとの銘柄' });
    seed(store, { code: '1111', name: 'さきの銘柄' });
    expect(listStockViews(store).map((v) => v.code)).toEqual(['1111', '9999']);
  });
});

// ------------------------------------------------------- GitHub との受け渡し

describe('GitHub へ渡すデータの符号化', () => {
  it('日本語を含む JSON が往復しても壊れない', () => {
    const doc = {
      stocks: [{ code: '1343', name: 'NF・J-REIT ETF', sector: 'J-REIT市場', memo: '① 高配当 ②' }],
      note: '「かぎ括弧」と絵文字 📈 と改行\nタブ\t',
    };
    const text = JSON.stringify(doc, null, 2);
    expect(JSON.parse(fromBase64(toBase64(text)))).toEqual(doc);
  });

  it('大きなデータでも符号化できる', () => {
    // 1 文字ずつ渡すと呼び出し上限に触れるため、分割して処理している
    const big = 'あ'.repeat(200000);
    expect(fromBase64(toBase64(big)).length).toBe(200000);
  });

  it('空文字も扱える', () => {
    expect(fromBase64(toBase64(''))).toBe('');
  });
});

describe('保存するドキュメントの形', () => {
  it('取り込んだ内容をそのまま書き出せる', () => {
    const store = new Store();
    const stock = store.createStock({ code: '8058', name: '三菱商事', sector: '卸売' });
    const position = store.createPosition({ stock_id: stock.id });
    store.createTransaction({
      position_id: position.id, type: 'BUY', trade_date: '2024-04-01', shares: 5, price: 2400,
    });

    const doc = store.toJSON();
    const reloaded = new Store(JSON.parse(JSON.stringify(doc)));
    expect(reloaded.listStocks().length).toBe(1);
    expect(reloaded.listTransactions().length).toBe(1);
    expect(dashboard(reloaded).summary.total_cost).toBe(12000);
  });

  it('id は既存の最大値の次を使う', () => {
    const store = new Store({
      format: 'khk-portfolio',
      stocks: [{ id: 7, code: '1111', name: '既存' }],
      positions: [], transactions: [],
    });
    expect(store.createStock({ code: '2222', name: '新規' }).id).toBe(8);
  });

  it('別形式のファイルは受け付けない', () => {
    expect(() => new Store({ format: 'something-else' })).toThrow('データ形式');
  });
});


// ------------------------------------------------------------ 取引月の扱い

describe('取引月(年月)の正規化', () => {
  it('スプレッドシート形式(2025/04)を受け取れる', () => {
    expect(normalizeMonth('2025/04')).toBe('2025-04');
  });

  it('1桁の月を 0 詰めする', () => {
    expect(normalizeMonth('2025/4')).toBe('2025-04');
  });

  it('日付つき(YYYY-MM-DD)は年月に丸める', () => {
    expect(normalizeMonth('2024-06-15')).toBe('2024-06');
  });

  it('空や不正な値は未設定として扱う', () => {
    expect(normalizeMonth('')).toBeNull();
    expect(normalizeMonth(null)).toBeNull();
    expect(normalizeMonth('よくわからない')).toBeNull();
  });

  it('表示は年/月にする', () => {
    expect(formatDate('2025-04')).toBe('2025/04');
    expect(formatDate('2024-06-15')).toBe('2024/06');
    expect(formatDate(null)).toBe('未設定');
  });
});

describe('取引月の保存', () => {
  const setup = () => {
    const store = new Store();
    const stock = store.createStock({ code: '8058', name: '三菱商事' });
    const position = store.createPosition({ stock_id: stock.id });
    return { store, position };
  };

  it('どの書き方で入れても年月で保存される', () => {
    const { store, position } = setup();
    const tx = store.createTransaction({
      position_id: position.id, type: 'BUY', trade_date: '2025/4', shares: 5, price: 100,
    });
    expect(tx.trade_date).toBe('2025-04');
  });

  it('日付つきで入れても年月に丸められる', () => {
    const { store, position } = setup();
    const tx = store.createTransaction({
      position_id: position.id, type: 'BUY', trade_date: '2024-06-15', shares: 5, price: 100,
    });
    expect(tx.trade_date).toBe('2024-06');
  });

  it('同じ月の取引は登録順に畳み込む', () => {
    const { store, position } = setup();
    store.createTransaction({
      position_id: position.id, type: 'BUY', trade_date: '2025-04', shares: 10, price: 1000,
    });
    store.createTransaction({
      position_id: position.id, type: 'SPLIT', trade_date: '2025-04', split_from: 1, split_to: 2,
    });
    expect(computePosition(store.listTransactions(position.id)).shares).toBe(20);
  });

  it('月の前後で並び順が決まる', () => {
    const { store, position } = setup();
    // あとの月を先に登録しても、古い月から順に処理される
    store.createTransaction({
      position_id: position.id, type: 'SPLIT', trade_date: '2025-06', split_from: 1, split_to: 2,
    });
    store.createTransaction({
      position_id: position.id, type: 'BUY', trade_date: '2025-01', shares: 10, price: 1000,
    });
    expect(computePosition(store.listTransactions(position.id)).shares).toBe(20);
  });
});
