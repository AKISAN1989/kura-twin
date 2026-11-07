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

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} を読み込めませんでした（${res.status}）`);
  return res.json();
}

export const store = {
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
    this.savedMemos = readLocal(KEYS.memos, []);
    OLD_KEYS.forEach(k => {
      try { localStorage.removeItem(k); } catch { /* 保存できない環境 */ }
    });
    this.questions = readLocal(KEYS.questions, {});
    this.role = readLocal(KEYS.role, null);
    this.todayLog = readLocal(KEYS.today, null);
    this.asks = readLocal(KEYS.asks, []);
    this.formats = readLocal(KEYS.formats, []);
    // 取り込んだ経過簿を今季のデータに重ねる
    const imported = readLocal(KEYS.records, {});
    for (const [tankId, recs] of Object.entries(imported)) mergeRecords(cur, tankId, recs);
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
    const imported = readLocal(KEYS.records, {});
    const byDate = new Map((imported[tankId] ?? []).map(r => [r.date, r]));
    for (const r of records) byDate.set(r.date, r);
    imported[tankId] = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    return writeLocal(KEYS.records, imported);
  },

  saveQuestion(eventId, question) {
    this.questions[eventId] = { question, at: new Date().toISOString() };
    writeLocal(KEYS.questions, this.questions);
  },

  saveMemo(memo) {
    this.savedMemos = this.savedMemos.filter(m => m.id !== memo.id).concat(memo);
    return writeLocal(KEYS.memos, this.savedMemos);
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
    return writeLocal(KEYS.asks, this.asks);
  },

  /** 杜氏が答えた蔵人の質問（判断メモ）を、蔵人に知らせ済みにする */
  markAsksSeen(ids) {
    this.asks = this.asks.map(a => (ids.includes(a.id) ? { ...a, seen: true } : a));
    writeLocal(KEYS.asks, this.asks);
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

  resetLocal() {
    Object.values(KEYS).forEach(k => {
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
