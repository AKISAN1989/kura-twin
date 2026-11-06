// 画面全体の状態と、3Dへの命令をまとめる。各タブ（panels/）はここを通して動かす。
import * as bridge from "./bridge.js";
import { store } from "./store.js";
import { allTanksOn, seasonCalendar } from "./tank-state.js";
import { detectOnDate } from "./detect.js";

const TEMP_RANGE = { tempMin: 6, tempMax: 14 }; // 液面の色：6℃＝青 〜 14℃＝赤
const listeners = new Set();

export const app = {
  season: null, // "2026" など
  calendar: [],
  dayIndex: 0,
  selected: null,
  highlighted: new Set(),
  tab: "toji",
  memoView: false, // 判断メモを開いているあいだ（過去の記録を見ている）
  lastPast: null,

  /** 過去の記録を見ているか：昨季のデータ、または判断メモを開いているとき */
  get isPast() { return !this.isCurrent || this.memoView; },

  get seasonData() { return store.seasons[this.season]; },
  get date() { return this.calendar[this.dayIndex]; },
  get isCurrent() { return this.season === store.currentSeason; },

  tank(id) { return this.seasonData.tanks.find(t => t.tank === id); },
  tankLabel(id) { return store.kura.tanks.find(t => t.id === id)?.label ?? `${id}号`; },

  /** その日の変化（決まったルール） */
  eventsOn(date = this.date) { return detectOnDate(this.seasonData, date, store.rules); },

  /** その日までの全ての変化 */
  eventsUpTo(date = this.date) {
    const dates = [...new Set(this.seasonData.tanks.flatMap(t => t.records.map(r => r.date)))]
      .filter(d => d <= date).sort();
    return dates.flatMap(d => this.eventsOn(d));
  },

  onChange(fn) { listeners.add(fn); },
  emit(kind) { listeners.forEach(fn => fn(kind)); },

  setSeason(season, date = null) {
    this.season = season;
    this.calendar = seasonCalendar(this.seasonData);
    const i = date ? this.calendar.indexOf(date) : -1;
    this.dayIndex = i >= 0 ? i : this.calendar.length - 1;
    this.applyDay();
    this.emit("season");
  },

  setDayIndex(i) {
    this.dayIndex = Math.max(0, Math.min(this.calendar.length - 1, i));
    this.applyDay();
    this.emit("day");
  },

  /** 3Dに、その日の液面・品温と、変化のあったタンクを送る */
  applyDay() {
    // 今と過去が切り替わるときは、数秒かけて光と液面を当時へ戻す（時を巻き戻す演出）
    const past = this.isPast;
    const blend = this.lastPast !== null && past !== this.lastPast ? 3 : 0;
    this.lastPast = past;
    bridge.setDay({
      dayIndex: this.dayIndex,
      date: this.date,
      past,
      blend,
      ...TEMP_RANGE,
      // Unity の JsonUtility は null を読めないので、品温が無いときは -999 を送る
      tanks: allTanksOn(this.seasonData, this.date, store.kura.tank_capacity_l)
        .map(t => ({ ...t, temp: t.temp ?? -999, joubou: t.joubou ?? "" })),
    });
    const now = new Set(this.eventsOn().map(e => e.tank));
    for (const id of this.highlighted) if (!now.has(id)) bridge.highlightTank(id, false);
    for (const id of now) if (!this.highlighted.has(id)) bridge.highlightTank(id, true);
    this.highlighted = now;
  },

  selectTank(id) {
    this.selected = id;
    bridge.selectTank(id);
    this.emit("tank");
  },

  /** 判断メモを開く：その季・その日に移り、杜氏の目線でタンクを覗く */
  openMemo(memo) {
    this.memoView = true;
    if (memo.season !== this.season || memo.date !== this.date) this.setSeason(memo.season, memo.date);
    else this.applyDay();
    this.selectTank(memo.tank);
    bridge.setCamera("toji", memo.tank);
    this.emit("memo");
  },

  /** 判断メモを閉じる：過去の表示をやめ、今の光に戻す */
  closeMemo() {
    if (!this.memoView) return;
    this.memoView = false;
    this.applyDay();
    this.emit("memo");
  },

  /** Unity が準備できたら、今の状態を送り直す */
  resend() {
    const hl = this.highlighted;
    this.highlighted = new Set();
    hl.forEach(id => bridge.highlightTank(id, false));
    this.lastPast = null; // 送り直しでは演出をしない
    this.applyDay();
    bridge.selectTank(this.selected);
  },
};
