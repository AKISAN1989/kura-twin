// データの読み込みと、ブラウザ内の保存（取り込んだ経過簿・判断メモ・作った質問）。ログインは無し。
const KEYS = { records: "kura.records.v1", memos: "kura.memos.v1", questions: "kura.questions.v1" };

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
    this.questions = readLocal(KEYS.questions, {});
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
