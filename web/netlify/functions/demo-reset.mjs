// デモ用の蔵コードの共有を、1時間ごとに元のデモデータ（空の共有）に戻す（Netlify の定期実行）。
// 審査員やほかの人がデモ用の蔵コードで書いた記録・判断メモ・質問は、毎時0分に消える。
// （sync.mjs でも、読むときに前の「時」に書かれたものは戻すので、定期実行が遅れても見え方は同じ）
import { getStore } from "@netlify/blobs";
import { DEMO_CODE } from "../../shared/kura-code.mjs";
import { docKey } from "../lib/sync-key.mjs";

export default async () => {
  const store = getStore({ name: "kura-shared", consistency: "strong" });
  await store.delete(docKey(DEMO_CODE));
  console.log("[demo-reset] デモ用の蔵コードの共有を元に戻しました");
};

export const config = { schedule: "@hourly" };
