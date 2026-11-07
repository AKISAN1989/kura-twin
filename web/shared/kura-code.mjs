// 蔵コード（同じ蔵の端末どうしで記録を共有する合言葉）と、共有する記録のまとめ方。画面とサーバー（Netlify Functions）で共通。
// ・蔵コードは、画面が作る推測されにくい12文字（紛らわしい 0・O・1・I・L を除いた31種 → 約59ビット）。表示は 4文字ずつ区切る
// ・デモ用の蔵コードだけは決まった文字（審査員が試すため。1時間ごとに元のデモデータに戻る）
// ・共有する記録：取り込んだ経過簿・判断メモ・杜氏への質問・蔵人からの質問。消すことはせず、足す・上書きするだけ

export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 12;
export const DEMO_CODE = "DEMO-KURA-2026";

/** 入力をそろえる：全角→半角、大文字、区切りの「-」や空白を除く */
export function normalizeCode(text) {
  return String(text ?? "").normalize("NFKC").toUpperCase().replace(/[\s\-ー－_]/g, "");
}

/** 蔵コードとして使えるか（デモ用か、決まった文字の12文字） */
export function isValidCode(text) {
  const c = normalizeCode(text);
  if (c === normalizeCode(DEMO_CODE)) return true;
  return c.length === CODE_LENGTH && [...c].every(ch => CODE_ALPHABET.includes(ch));
}

export const isDemoCode = text => normalizeCode(text) === normalizeCode(DEMO_CODE);

/** 表示の形（XXXX-XXXX-XXXX） */
export function formatCode(text) {
  const c = normalizeCode(text);
  if (isDemoCode(c)) return DEMO_CODE;
  return c.match(/.{1,4}/g)?.join("-") ?? c;
}

/** 新しい蔵コード（ブラウザの暗号用の乱数で作る） */
export function newCode(random = n => crypto.getRandomValues(new Uint8Array(n))) {
  const bytes = random(CODE_LENGTH * 2);
  let out = "";
  for (const b of bytes) {
    if (b >= 248) continue; // 31 の倍数（248）以上は捨てて、偏りなく選ぶ
    out += CODE_ALPHABET[b % 31];
    if (out.length === CODE_LENGTH) break;
  }
  return out.length === CODE_LENGTH ? formatCode(out) : newCode(random);
}

export const emptyDoc = () => ({ rev: 0, records: {}, memos: [], questions: {}, asks: [] });

/**
 * 共有の記録に、変更を重ねる（足す・上書きだけ。消さない）。
 * change = { records: { タンク: [日ごとの記録] }, memos: [判断メモ], questions: { 変化のid: {question, at} }, asks: [蔵人からの質問] }
 */
export function mergeDoc(doc, change) {
  const d = { ...emptyDoc(), ...doc };
  for (const [tank, recs] of Object.entries(change.records ?? {})) {
    const byDate = new Map((d.records[tank] ?? []).map(r => [r.date, r]));
    for (const r of recs ?? []) if (r?.date) byDate.set(r.date, { ...byDate.get(r.date), ...r });
    d.records = { ...d.records, [tank]: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  }
  const upsert = (list, items) => {
    const byId = new Map(list.map(x => [x.id, x]));
    for (const x of items ?? []) if (x?.id) byId.set(x.id, { ...byId.get(x.id), ...x });
    return [...byId.values()];
  };
  d.memos = upsert(d.memos, change.memos);
  d.asks = upsert(d.asks, (change.asks ?? []).map(({ seen, ...a }) => a)); // 「知らせた」は端末ごと（共有しない）
  d.questions = { ...d.questions, ...(change.questions ?? {}) };
  return d;
}
