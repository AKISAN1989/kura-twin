// 保存しておいた読み取りの表（table.json）を、Claude を呼ばずに数え直す
// 使い方：node eval/rescore.mjs <書式のid> <table.json>
import { readFileSync } from "node:fs";
import { score, setSeason } from "./score.js";

const [id, file] = process.argv.slice(2);
setSeason(JSON.parse(readFileSync(new URL("../public/data/season-current.json", import.meta.url))));
const truth = JSON.parse(readFileSync(new URL("./sheets/truth.json", import.meta.url)))[id];
const r = score(truth, JSON.parse(readFileSync(file, "utf8")));
console.log(`正解 ${r.correct}/${r.cells}・要確認 ${r.check}・誤り ${r.wrong}`);
r.misses.forEach(m => console.log(`  ${m}`));
