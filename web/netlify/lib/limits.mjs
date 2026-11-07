// 呼び出し回数の簡単な守り：知らない人に大量に呼ばれて Claude API の費用がかさまないように。
// ・同じ利用者（IPアドレス）からの短時間の呼び出し回数
// ・同じ利用者の1日の回数、全員合わせた1日の回数
// 数え方は Netlify Blobs を使った「おおよそ」（同時に来た呼び出しは取りこぼすことがある）。
// 確実な上限は、Netlify の rateLimit（young-question と read-sheet）と、Claude Console の利用額の上限で守る。
// 審査員が普通に試す分には届かない値にしてある。
import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";

// 値の考え方（2026-11-07 見直し）：
// ・審査員が普通に試す分：1人で読み取り数回・質問十数回＝多くても数十回
// ・デモ動画の撮影：同じ回線から読み取りと質問を何度も撮り直す＝1日数百回
// ・使われすぎの最後の歯止めは Claude Console の月の利用額の上限（$100）。ここはそれより先に、
//   1つの回線や一晩のいたずらで月の上限を使い切らないための守り
export const LIMITS = {
  perMinute: 40, // 同じ利用者が1分間に呼べる回数（全処理の合計。経過簿の読み直しは一度に十数回呼ぶ）
  perDayIp: 800, // 同じ利用者の1日の回数（撮影で同じ回線から何度も呼ぶため 300 から上げた）
  perDayAll: 4000, // 全員合わせた1日の回数（撮影と審査の期間に止まらないよう 1,500 から上げた）
};
// 数の置き場所の版。上げると、その日の数がすべて 0 から数え直しになる（上限に達した日に戻すとき）
const COUNT_VERSION = "v2";

export class LimitError extends Error {
  constructor(message) {
    super(message);
    this.status = 429;
  }
}

const today = () => new Date().toISOString().slice(0, 10); // UTC の日付
const hashIp = ip => createHash("sha256").update(`kura-twin:${ip}`).digest("hex").slice(0, 24); // IP はそのまま残さない

/** 上限を超えていれば LimitError を投げる。数えられないとき（Blobs の不調）は止めずに通す */
export async function checkLimits(ip) {
  let store;
  try {
    store = getStore({ name: "kura-limits", consistency: "strong" });
  } catch (e) {
    console.warn("[limits] Blobs を使えないため数えません:", e.message);
    return;
  }
  const day = today();
  const now = Date.now();
  const ipKey = `${COUNT_VERSION}/ip/${day}/${hashIp(ip || "unknown")}`;
  const allKey = `${COUNT_VERSION}/all/${day}`;
  try {
    const [mine, all] = await Promise.all([
      store.get(ipKey, { type: "json" }),
      store.get(allKey, { type: "json" }),
    ]);
    const m = mine ?? { count: 0, recent: [] };
    const a = all ?? { count: 0 };
    m.recent = m.recent.filter(t => now - t < 60_000);
    if (a.count >= LIMITS.perDayAll) throw new LimitError("今日の利用の上限（全体）に達しました。明日また試してください");
    if (m.count >= LIMITS.perDayIp) throw new LimitError("今日の利用の上限に達しました。明日また試してください");
    if (m.recent.length >= LIMITS.perMinute) throw new LimitError("短い時間に多く使われました。1分ほど待ってから再実行してください");
    m.count += 1;
    m.recent.push(now);
    a.count += 1;
    await Promise.all([store.setJSON(ipKey, m), store.setJSON(allKey, a)]);
  } catch (e) {
    if (e instanceof LimitError) throw e;
    console.warn("[limits] 回数を数えられませんでした:", e.message);
  }
}
