// 記録の共有（蔵コード方式）。同じ蔵コードの端末どうしで、取り込んだ経過簿・判断メモ・杜氏への質問・蔵人からの質問を共有する。
// ・保存先は Netlify Blobs。置き場所の名前は蔵コードのハッシュ（SHA-256）なので、蔵コードを知らない人は場所も分からず、読めず書けない
// ・蔵コードの総当たり対策：蔵コードの形を確かめ（推測されにくい12文字）、同じ利用者が1時間に試せる蔵コードの数を絞る
// ・デモ用の蔵コードの記録は、1時間ごとに元のデモデータ（空の共有）に戻す（ここで時刻を見て戻すのと、demo-reset の定期実行の両方）
// Claude は呼ばないので、Claude の呼び出し回数の上限（limits.mjs）とは別に数える
import { getStore } from "@netlify/blobs";
import { hash, docKey } from "../lib/sync-key.mjs";
import { isValidCode, isDemoCode, normalizeCode, mergeDoc, emptyDoc } from "../../shared/kura-code.mjs";

const CODES_PER_HOUR = 12; // 同じ利用者（IP）が1時間に試せる、違う蔵コードの数
const MAX_BYTES = 400_000;  // 1つの蔵の共有の大きさの上限（いたずらで大きくされないように）

const hourStamp = () => new Date().toISOString().slice(0, 13); // UTC の「年月日時」

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

// 同じ利用者が1時間に試した蔵コード（ハッシュ）を数える。数えられないとき（Blobs の不調）は止めない
async function checkCodeTries(ip, code) {
  try {
    const limits = getStore({ name: "kura-sync-limits", consistency: "strong" });
    const key = `tries/${hourStamp()}/${hash(`ip:${ip || "unknown"}`).slice(0, 24)}`;
    const tried = (await limits.get(key, { type: "json" })) ?? [];
    const h = hash(normalizeCode(code)).slice(0, 16);
    if (tried.includes(h)) return true;
    if (tried.length >= CODES_PER_HOUR) return false;
    await limits.setJSON(key, [...tried, h]);
  } catch (e) {
    console.warn("[sync] 試した数を数えられませんでした:", e.message);
  }
  return true;
}

async function readDoc(store, key, demo) {
  const got = await store.getWithMetadata(key, { type: "json" });
  let doc = got?.data ?? null;
  // デモ用：前の「時」に書かれたものは、元のデモデータ（空の共有）に戻す
  if (demo && doc && doc.hour !== hourStamp()) doc = null;
  return { doc: doc ?? { ...emptyDoc(), hour: hourStamp() }, etag: got?.etag ?? null, exists: !!got };
}

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "POST で送ってください" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "送られた内容を読めませんでした" }, 400); }
  const { code, op, change, since } = body ?? {};
  if (!isValidCode(code)) return json({ error: "蔵コードの形が違います（12文字。例：AB23-CD45-EF67）" }, 400);
  const demo = isDemoCode(code);
  const ip = context?.ip ?? req.headers.get("x-nf-client-connection-ip");
  if (!demo && !(await checkCodeTries(ip, code))) {
    return json({ error: "短い時間に多くの蔵コードが試されました。1時間ほど待ってから入れ直してください" }, 429);
  }
  let store;
  try {
    store = getStore({ name: "kura-shared", consistency: "strong" });
  } catch (e) {
    return json({ error: `共有の保存先を使えません：${e.message}` }, 503);
  }
  const key = docKey(code);

  if (op === "get") {
    const { doc } = await readDoc(store, key, demo);
    if (since != null && since === doc.rev) return json({ rev: doc.rev, unchanged: true });
    return json(doc);
  }

  if (op === "put") {
    if (!change || typeof change !== "object") return json({ error: "変更がありません" }, 400);
    // 同時に書いたときに上書きし合わないよう、読んだ版（ETag）が変わっていなければ書く。変わっていたら読み直して重ね直す
    for (let i = 0; i < 6; i++) {
      const { doc, etag, exists } = await readDoc(store, key, demo);
      const next = { ...mergeDoc(doc, change), rev: (doc.rev ?? 0) + 1, hour: demo ? hourStamp() : doc.hour, updated_at: new Date().toISOString() };
      if (JSON.stringify(next).length > MAX_BYTES) return json({ error: "共有の記録が大きくなりすぎました" }, 413);
      const res = exists && etag ? await store.setJSON(key, next, { onlyIfMatch: etag }) : await store.setJSON(key, next, exists ? {} : { onlyIfNew: true });
      if (res?.modified !== false) return json(next);
    }
    return json({ error: "ほかの端末と同時に保存しました。もう一度試してください" }, 409);
  }

  return json({ error: "op は get か put です" }, 400);
};

// 同じ利用者（IP）からは1分間に 90 回まで（数秒ごとの更新の確認を含む。Netlify の rateLimit。超えると 429）
export const config = { path: "/api/sync", rateLimit: { windowLimit: 90, windowSize: 60, aggregateBy: ["ip", "domain"] } };
