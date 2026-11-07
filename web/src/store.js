// データの読み込みと、ブラウザ内の保存（取り込んだ経過簿・判断メモ・作った質問）。ログインは無し。
// 質問の決まりを変えたら questions の版を上げる。古い版の質問は読み込み時に捨て、新しい決まりで作り直す
const KEYS = {
  records: "kura.records.v1", memos: "kura.memos.v1", questions: "kura.questions.v4",
  role: "kura.role.v1", // 選んだ役割（"kurabito" | "toji"）
  today: "kura.today.v1", // 今日の経過簿を撮ったか（{ date, tank, days, at }）
  asks: "kura.asks.v1", // 蔵人が杜氏に直接聞いた質問（記録に見つからなかったもの）
  formats: "kura.formats.v1", // 覚えた経過簿の書式（見出し → 項目の対応）
};
const OLD_KEYS = ["kura.questions.v1", "kura.questions.v2", "kura.questions.v3"]; // v3：スマホで2〜3行に収まる短い質問
// 蔵コード（記録の共有）。共有する記録（経過簿・判断メモ・質問・蔵人からの質問）は、蔵コードごとに分けてこの端末に置き、
// 同じ蔵コードの端末どうしで /api/sync を通して共有する。蔵コードが無ければ、これまでどおりこの端末の中だけ
const CODE_KEY = "kura.code.v1";
const SHARED = ["records", "memos", "questions", "asks"];
const POLL_MS = 4000; // ほかの端末の変更を確かめる間隔（画面が見えているときだけ）

function readLocal(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
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

import { normalizeCode, formatCode, isValidCode, mergeDoc } from "../shared/kura-code.mjs";

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} を読み込めませんでした（${res.status}）`);
  return res.json();
}

export const store = {
  code: null, // 蔵コード（共有していなければ null）
  sync: { status: "local", rev: null, lastAt: null, error: null }, // local | ok | offline
  onRemote: () => {}, // ほかの端末の変更を取り込んだとき（main.js が画面と3Dを更新する）
  /** 共有する記録の置き場所（蔵コードごとに分ける） */
  key(name) { return this.code && SHARED.includes(name) ? `${KEYS[name]}@${normalizeCode(this.code)}` : KEYS[name]; },
  kura: null,
  rules: null,
  seasons: {}, // { "2026": {...}, "2025": {...} }
  currentSeason: null,
  pastMemos: [],
  savedMemos: [], // 今季、杜氏が答えた判断メモ
  questions: {}, // eventId → { question }
  role: null,
  todayLog: null,
  formats: [], // { id, name, labels: [{ norm, text, field }], created_at, used }
  asks: [], // { id, season, question, context: { tank, date, moromi_day, change } | null, asked_at, seen }

  async load() {
    const [kura, rules, cur, past, memos] = await Promise.all([
      loadJson("data/kura.json"),
      loadJson("config/rules.json"),
      loadJson("data/season-current.json"),
      loadJson("data/season-past.json"),
      loadJson("data/memos-past.json"),
    ]);
    this.kura = kura;
    this.rules = rules;
    this.seasons = { [cur.season]: cur, [past.season]: past };
    this.currentSeason = cur.season;
    this.pastMemos = memos.memos;
    const code = readLocal(CODE_KEY, null);
    this.code = code && isValidCode(code) ? formatCode(code) : null;
    this.savedMemos = readLocal(this.key("memos"), []);
    OLD_KEYS.forEach(k => {
      try { localStorage.removeItem(k); } catch { /* 保存できない環境 */ }
    });
    this.questions = readLocal(this.key("questions"), {});
    this.role = readLocal(KEYS.role, null);
    this.todayLog = readLocal(KEYS.today, null);
    this.asks = readLocal(this.key("asks"), []);
    this.formats = readLocal(KEYS.formats, []);
    // 取り込んだ経過簿を今季のデータに重ねる
    const imported = readLocal(this.key("records"), {});
    for (const [tankId, recs] of Object.entries(imported)) mergeRecords(cur, tankId, recs);
    // 共有しているときは、最初に共有の記録を取ってくる（つながらなくても、この端末に置いた分で動く）
    if (this.code) {
      await Promise.race([this.pull(), new Promise(r => setTimeout(r, 5000))]);
      this.startPolling();
    }
  },

  // ---------- 記録の共有（蔵コード） ----------
  async api(body) {
    const res = await fetch("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: this.code, ...body }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `共有の保存先につながりませんでした（${res.status}）`);
    return data;
  },

  /** 共有の記録を取ってきて、この端末に重ねる。変わっていれば onRemote を呼ぶ */
  async pull() {
    if (!this.code) return;
    try {
      await this.flush(); // 送れていない変更があれば先に送る
      const doc = await this.api({ op: "get", since: this.sync.rev });
      this.sync = { status: "ok", rev: doc.rev, lastAt: Date.now(), error: null };
      if (!doc.unchanged) { this.applyDoc(doc); this.onRemote("pull"); }
    } catch (e) {
      this.sync = { ...this.sync, status: "offline", error: e.message };
      this.onRemote("status");
    }
  },

  /** 共有の記録（ほかの端末の分を含む）を、この端末の記録に重ねる */
  applyDoc(doc) {
    const cur = this.seasons[this.currentSeason];
    for (const [tankId, recs] of Object.entries(doc.records ?? {})) mergeRecords(cur, tankId, recs);
    const local = readLocal(this.key("records"), {});
    writeLocal(this.key("records"), mergeDoc({ records: local }, { records: doc.records }).records);
    const byId = new Map(this.savedMemos.map(m => [m.id, m]));
    for (const m of doc.memos ?? []) byId.set(m.id, { ...byId.get(m.id), ...m });
    this.savedMemos = [...byId.values()];
    writeLocal(this.key("memos"), this.savedMemos);
    this.questions = { ...this.questions, ...(doc.questions ?? {}) };
    writeLocal(this.key("questions"), this.questions);
    const seen = new Set(this.asks.filter(a => a.seen).map(a => a.id)); // 「知らせた」は端末ごと
    const asks = new Map(this.asks.map(a => [a.id, a]));
    for (const a of doc.asks ?? []) asks.set(a.id, { ...asks.get(a.id), ...a, seen: seen.has(a.id) });
    this.asks = [...asks.values()];
    writeLocal(this.key("asks"), this.asks);
  },

  /** 変更を共有に送る（つながらなければこの端末にためておき、次に送る） */
  push(change) {
    if (!this.code) return;
    const pending = readLocal(`kura.pending@${normalizeCode(this.code)}`, []);
    pending.push(change);
    writeLocal(`kura.pending@${normalizeCode(this.code)}`, pending);
    this.flush().then(() => this.onRemote("status"));
  },

  async flush() {
    const k = `kura.pending@${normalizeCode(this.code)}`;
    const pending = readLocal(k, []);
    if (!pending.length) return;
    const change = pending.reduce((acc, c) => mergeDoc(acc, c), { records: {}, memos: [], questions: {}, asks: [] });
    try {
      const doc = await this.api({ op: "put", change });
      writeLocal(k, []);
      this.sync = { status: "ok", rev: doc.rev, lastAt: Date.now(), error: null };
    } catch (e) {
      this.sync = { ...this.sync, status: "offline", error: e.message };
    }
  },

  startPolling() {
    clearInterval(this._poll);
    this._poll = setInterval(() => { if (document.visibilityState === "visible") this.pull(); }, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") this.pull(); });
  },

  /** 蔵コードを入れる（null でやめる）。画面は読み直す */
  setCode(code) {
    if (code) writeLocal(CODE_KEY, formatCode(code));
    else try { localStorage.removeItem(CODE_KEY); } catch { /* 保存できない環境 */ }
  },

  allMemos() {
    return [...this.pastMemos, ...this.savedMemos];
  },

  memosFor(season, tankId) {
    return this.allMemos().filter(m => m.season === season && m.tank === tankId);
  },

  saveImported(tankId, records) {
    const cur = this.seasons[this.currentSeason];
    mergeRecords(cur, tankId, records);
    const imported = readLocal(this.key("records"), {});
    const byDate = new Map((imported[tankId] ?? []).map(r => [r.date, r]));
    for (const r of records) byDate.set(r.date, r);
    imported[tankId] = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    this.push({ records: { [tankId]: records } });
    return writeLocal(this.key("records"), imported);
  },

  saveQuestion(eventId, question) {
    this.questions[eventId] = { question, at: new Date().toISOString() };
    writeLocal(this.key("questions"), this.questions);
    this.push({ questions: { [eventId]: this.questions[eventId] } });
  },

  saveMemo(memo) {
    this.savedMemos = this.savedMemos.filter(m => m.id !== memo.id).concat(memo);
    this.push({ memos: [memo] });
    return writeLocal(this.key("memos"), this.savedMemos);
  },

  setRole(role) {
    this.role = role;
    writeLocal(KEYS.role, role);
  },

  /** 今日の経過簿を撮って保存した（「今日」はデモの暦の今日） */
  markToday(date, tank, days) {
    this.todayLog = { date, tank, days, at: new Date().toISOString() };
    writeLocal(KEYS.today, this.todayLog);
  },

  /** 蔵人の質問を、杜氏の「判断を語る」の一覧に加える */
  addAsk(ask) {
    this.asks = this.asks.filter(a => a.id !== ask.id).concat(ask);
    this.push({ asks: [ask] });
    return writeLocal(this.key("asks"), this.asks);
  },

  /** 杜氏が答えた蔵人の質問（判断メモ）を、蔵人に知らせ済みにする */
  markAsksSeen(ids) {
    this.asks = this.asks.map(a => (ids.includes(a.id) ? { ...a, seen: true } : a));
    writeLocal(this.key("asks"), this.asks);
  },

  /** 蔵人の質問への杜氏の答え（判断メモ）。無ければ null */
  answerOf(askId) {
    return this.savedMemos.find(m => m.id === askId) ?? null;
  },

  /** 経過簿の書式を覚える（同じ id なら置き換える） */
  saveFormat(format) {
    this.formats = this.formats.filter(f => f.id !== format.id).concat(format);
    return writeLocal(KEYS.formats, this.formats);
  },

  /** 覚えた書式の、1つの見出しの対応を直す */
  setFormatField(id, norm, field) {
    const f = this.formats.find(x => x.id === id);
    if (!f) return;
    f.labels = f.labels.map(l => (l.norm === norm ? { ...l, field } : l));
    writeLocal(KEYS.formats, this.formats);
  },

  deleteFormat(id) {
    this.formats = this.formats.filter(f => f.id !== id);
    writeLocal(KEYS.formats, this.formats);
  },

  /** この端末の保存を消す（共有している記録は消さない。蔵コードの分もこの端末からは消える） */
  resetLocal() {
    const keys = [...Object.values(KEYS), CODE_KEY];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/@/.test(k ?? "") && k.startsWith("kura.")) keys.push(k); } } catch { /* 保存できない環境 */ }
    keys.forEach(k => {
      try { localStorage.removeItem(k); } catch { /* 保存できない環境 */ }
    });
  },
};

function mergeRecords(season, tankId, records) {
  let tank = season.tanks.find(t => t.tank === tankId);
  if (!tank) return;
  const byDate = new Map(tank.records.map(r => [r.date, r]));
  for (const r of records) byDate.set(r.date, { ...byDate.get(r.date), ...r });
  tank.records = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  // 取り込んだ日が「今日」より後なら、暦をそこまで延ばす
  const last = records.map(r => r.date).sort().pop();
  if (season.today && last > season.today) season.today = last;
}
