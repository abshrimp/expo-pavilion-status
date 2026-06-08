// dev/build-history.mjs
//
// 過去ログ（dev/data.csv）を「1日1ファイル」の静的JSONに事前変換する、開発用オフラインスクリプト。
// これにより expo-pavilion-status2 は（予約状況の表示について）バックエンド無しで動作する。
//
// 入力（既定。すべて dev/ 同梱）:
//   dev/data.csv   … server.js が出力した log.txt（予約状況の変化ログ）
//   dev/data.json  … 施設名マップ（コード→施設名。元 data2.json）
//   （任意）リポジトリ直下 server.js … 手動名称辞書 p_names。あれば不足分の名称を補完。
//
// 出力（既定: ../public/history/ = expo-pavilion-status2/public/history/）:
//   <YYYY-MM-DD>.json … その日の { date, base, ev }
//        base: { code: { slot: status } }      … 朝8:20時点のベースライン（その日のスナップショット）
//        ev:   [ ["HH:MM:SS","CODE","SLOT",status], ... ]  … 時刻順の変化イベント
//   names.json … { code: 施設名 }
//   index.json … { dates:[...], minDate, maxDate, generatedAt }
//
// ブラウザ側は「現在時刻−1年」の日付のファイルを取得し、base をコピーして
// ev のうち現在時刻以前のものを適用するだけで、その瞬間の予約状況を復元できる。
//
// 使い方（アプリ直下から）:  node dev/build-history.mjs
//   LOG_PATH, NAME_MAP_PATH, SERVER_JS, OUT_DIR を環境変数で上書き可能。

import fs from 'fs';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // expo-pavilion-status2/dev

const LOG_PATH = process.env.LOG_PATH || path.join(__dirname, 'data.csv');
const NAME_MAP_PATH = process.env.NAME_MAP_PATH || path.join(__dirname, 'data.json');
// 手動名称辞書は任意。既定ではリポジトリ直下（dev から3つ上）の server.js を best-effort で読む。
const SERVER_JS = process.env.SERVER_JS || path.join(__dirname, '..', '..', '..', 'server.js');
// フロントエンドの names 定数（車いす等の制限判定に使用）。
const FRONTEND_SERVICE = process.env.FRONTEND_SERVICE || path.join(__dirname, '..', 'src', 'services', 'expoService.js');
const OUT_DIR = process.env.OUT_DIR || path.join(__dirname, '..', 'public', 'history');

// フロントエンド filterData と同じ「車いす等の制限があるもの」の判定語
const RESTRICTED_RE = /車いす|車椅子|障がい|障害|バリアフリー/;

const pad2 = (n) => String(n).padStart(2, '0');
const dateKeyOf = (y, mo, d) => `${y}-${pad2(mo)}-${pad2(d)}`;
const hms = (h, mi, s) => `${pad2(h)}:${pad2(mi)}:${pad2(s)}`;

// "HH:MM:SS" ⇄ 秒。日付跨ぎは 23:59:59 に丸める。
const toSec = (t) => { const [h, mi, s] = t.split(':').map(Number); return h * 3600 + mi * 60 + s; };
const secToHms = (sec) => {
    if (sec > 24 * 3600 - 1) sec = 24 * 3600 - 1; // 23:59:59 に丸め
    return hms(Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60);
};
// "HH:MM:SS" に1分加算
const addOneMinute = (t) => secToHms(toSec(t) + 60);
// スロットコード "HHMM" のエントリー時刻（"HH:MM:00" と秒）
const slotEntryHms = (slot) => `${slot.slice(0, 2)}:${slot.slice(2, 4)}:00`;
const slotEntrySec = (slot) => toSec(slotEntryHms(slot));
const isHHMM = (slot) => /^\d{4}$/.test(slot);

// ✗ へ戻る変化ログが抜け落ちている枠に ✗（status 2）の合成イベントを補う。
//   (1) イベントで◯になり、その後変化が無い枠 … 最終◯の1分後に✗
//   (2) base が◯のまま終日イベントが無い枠   … 9:00 に✗
//   (3) イベントで△になり、その後変化が無い枠 … 最終△の1分後に✗
//       ただし △ になったのが 20:00 より前 かつ 非車椅子枠（isRestricted=false）に限る。
//       さらに 10:00 以降の△は、その時刻に◯/△が同時4枠以上ある「人気なし」枠を
//       補正しない（10:00より前＝オープンラッシュ中の△は人気判定せず常に✗）。
//   (4) 同一枠で ◯→◯ または △→△ の記録が連続 … 間に✗が確実に抜けているので、
//       先の記録の1分後に✗（次の記録より前に収まる場合のみ）。
//   (5) ◯が10分以上継続し、その日が高需要館（✗遷移数>=DEMAND_X2_MIN）のとき、
//       その◯は1分後に✗（人気館で居座る◯は欠落とみなす）。一斉開放の枠数に依存しない。
//       高需要館で base◯ が 10:00 を過ぎても最初のイベントが来ない枠は 9:00 で✗
//       （9:00〜10:00 に解決する正当な開場直後の空きは保持）。
//       高需要判定は「その館の全日平均✗遷移数 >= DEMAND_X2_MIN」（日次の揺らぎを吸収）。
//   (6) エントリー時刻が過ぎた枠（過去枠）が◯/△のまま … エントリー時刻に✗（予約不可）。
//       (3)(5) の人気判定カウントも過去枠を✗扱いにして水増しを防ぐ。
// いずれも ✗ にする時刻は 9:00 以降に丸める。戻り値は追加した件数。
// isRestricted(code) はフロントエンド filterData と同じ「車いす等の制限」判定。
const NINE_AM = '09:00:00';
const EIGHT_PM = '20:00:00';
// オープンラッシュ（予約開始直後）の終端△は、どの館も多数◯になり人気判定が誤るため、
// この時刻より前の△には人気判定を適用せず常に✗を補う。
const OPEN_RUSH_END = '10:00:00';
// 高需要館の判定: その日の✗（status 2）遷移数がこれ以上なら「人気館」とみなす。
// 一斉開放の枠数に振り回される瞬間カウントより安定した指標。日次は揺らぐので、
// その館の「全日平均✗遷移数」がこの値以上なら高需要館とみなす（isHighDemand を main で算出）。
const DEMAND_X2_MIN = 50;
function patchMissingFull(day, isRestricted, isHighDemand) {
    // 枠（code+slot）ごと・code ごとのイベント列（時刻順）を作る。
    // ※どちらも合成イベントを混ぜる前の元データから作る（判定を実データで行うため）
    const byKey = new Map();    // "code\tslot" -> [event,...]
    const evByCode = new Map(); // code -> [event,...]
    for (const e of day.ev) {
        const k = `${e[1]}\t${e[2]}`;
        let a = byKey.get(k); if (!a) { a = []; byKey.set(k, a); } a.push(e);
        let b = evByCode.get(e[1]); if (!b) { b = []; evByCode.set(e[1], b); } b.push(e);
    }

    // 時刻 T 時点の code の「◯/△（status<=1）枠数」（base + T以前のイベントで復元）。
    // エントリー時刻が T 以前の「過去枠」は予約不可なので✗扱い（カウントしない）。
    const availableCountAt = (code, T) => {
        const Tsec = toSec(T);
        const state = Object.assign({}, day.base[code] || {});
        for (const e of (evByCode.get(code) || [])) { if (e[0] > T) break; state[e[2]] = e[3]; }
        let openLE1 = 0;
        for (const k in state) {
            if (isHHMM(k) && slotEntrySec(k) <= Tsec) continue; // 過去枠は✗扱い
            if (state[k] <= 1) openLE1++;
        }
        return openLE1;
    };

    // 追加する✗を (時刻,code,slot) で重複排除しつつ収集（複数ルールが同じ✗を出すため）
    const adds = new Map();
    const addFull = (time, code, slot) => {
        const t = time < NINE_AM ? NINE_AM : time;
        adds.set(`${t}\t${code}\t${slot}`, [t, code, slot, 2]);
    };

    for (const [k, a] of byKey) {
        const [code, slot] = k.split('\t');

        // (5b) base◯ が高需要館でオープンラッシュ（10:00）を過ぎても最初のイベントが
        //      来ない枠は、開場時点で既に埋まっていた（記録欠落）とみなし 9:00 に✗。
        //      9:00〜10:00 に解決する正当な開場直後の空きは（最初のイベントが10:00前なので）保持。
        const baseS = day.base[code] ? day.base[code][slot] : undefined;
        if (baseS === 0 && a.length && a[0][0] >= OPEN_RUSH_END && isHighDemand(code)) {
            addFull(NINE_AM, code, slot);
        }

        for (let i = 0; i < a.length; i++) {
            const cur = a[i], next = a[i + 1]; // next が無ければ終端

            // (4) ◯→◯ / △→△ の連続 … 間に✗が抜けている。先の記録の1分後に✗
            if (next && (cur[3] === 0 || cur[3] === 1) && next[3] === cur[3]) {
                const t = addOneMinute(cur[0]);
                if (t < next[0]) addFull(t, code, slot); // 次の記録を追い越さない場合のみ
            }

            // (5) ◯が10分以上継続し、その日の高需要館（✗遷移≧DEMAND_X2_MIN）… 1分後に✗
            if (next && cur[3] === 0 && toSec(next[0]) - toSec(cur[0]) >= 600 && isHighDemand(code)) {
                addFull(addOneMinute(cur[0]), code, slot);
            }

            // 終端イベント: (1) ◯ / (3) △
            if (!next) {
                if (cur[3] === 0) {
                    addFull(addOneMinute(cur[0]), code, slot);
                } else if (cur[3] === 1 && cur[0] < EIGHT_PM && !isRestricted(code)) {
                    if (cur[0] >= OPEN_RUSH_END && availableCountAt(code, cur[0]) >= 4) continue;
                    addFull(addOneMinute(cur[0]), code, slot);
                }
            }
        }
    }

    // (2) base が◯のまま、その日その枠にイベントが1件も無い枠 … 9:00 に✗
    for (const code in day.base) {
        const slots = day.base[code];
        for (const slot in slots) {
            if (slots[slot] !== 0) continue;
            if (byKey.has(`${code}\t${slot}`)) continue; // イベントがある枠は上で処理済み
            addFull(NINE_AM, code, slot);
        }
    }

    // (6) エントリー時刻が過ぎた枠は予約不可なので、その時刻に✗（base/イベント由来の全枠）
    const allKeys = new Set(byKey.keys());
    for (const code in day.base) for (const slot in day.base[code]) allKeys.add(`${code}\t${slot}`);
    for (const key of allKeys) {
        const [code, slot] = key.split('\t');
        if (!isHHMM(slot)) continue;
        const entry = slotEntryHms(slot);
        // エントリー時刻時点の状態を復元（base + entry以前のイベント）
        const b = day.base[code];
        let s = (b && b[slot] !== undefined) ? b[slot] : undefined;
        for (const e of (byKey.get(key) || [])) { if (e[0] > entry) break; s = e[3]; }
        if (s !== undefined && s <= 1) addFull(entry, code, slot); // ◯/△ のままなら✗
    }

    if (adds.size === 0) return 0;
    for (const ev of adds.values()) day.ev.push(ev);
    // 合成イベントを混ぜたので時刻順へ並べ直す（同時刻は元の順序を維持）
    day.ev.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return adds.size;
}

// JSON ブロブの終端（深さ0に戻る '}' の位置）。文字列内に { } は出現しない前提。
function findJsonEnd(line) {
    let depth = 0;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
}

// 1日分のデータ入れ物
function emptyDay(date) {
    return { date, base: null, ev: [] };
}

const days = new Map(); // dateKey -> { date, base, ev }
function getDay(dateKey) {
    let d = days.get(dateKey);
    if (!d) { d = emptyDay(dateKey); days.set(dateKey, d); }
    return d;
}

// 通常の変化レコードをパースして該当日の ev に積む。成功時はその dateKey、失敗時は null。
function parseRecord(rec) {
    rec = rec.trim();
    if (!rec) return null;
    const parts = rec.split(',').map((x) => x.trim());
    try {
        if (/^\d{4}\//.test(rec)) {
            // 新形式: "YYYY/M/D H:MM:SS", CODE, SLOT, STATUS
            if (parts.length < 4) return null;
            const sp = parts[0].indexOf(' ');
            const [y, mo, d] = parts[0].slice(0, sp).split('/').map(Number);
            const [h, mi, s] = parts[0].slice(sp + 1).split(':').map(Number);
            const code = parts[1], slot = parts[2], status = Number(parts[3]);
            if (!code || !slot || Number.isNaN(status)) return null;
            const dk = dateKeyOf(y, mo, d);
            getDay(dk).ev.push([hms(h, mi, s || 0), code, slot, status]);
            return dk;
        } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(parts[0])) {
            // 旧形式: M/D/YYYY, H:MM:SS AM, CODE, SLOT, STATUS, undefined
            if (parts.length < 5) return null;
            const [mo, d, y] = parts[0].split('/').map(Number);
            const m = parts[1].match(/(\d{1,2}):(\d{1,2}):(\d{1,2})\s*(AM|PM)?/i);
            let h = Number(m[1]);
            const ap = (m[4] || '').toUpperCase();
            if (ap === 'PM' && h !== 12) h += 12;
            if (ap === 'AM' && h === 12) h = 0;
            const code = parts[2], slot = parts[3], status = Number(parts[4]);
            if (!code || !slot || Number.isNaN(status)) return null;
            const dk = dateKeyOf(y, mo, d);
            getDay(dk).ev.push([hms(h, Number(m[2]), Number(m[3])), code, slot, status]);
            return dk;
        }
    } catch { return null; }
    return null;
}

// server.js の手動名称辞書（p_names）から { code: フルネーム } を取り出す（任意・best-effort）
function loadCuratedNames() {
    try {
        const txt = fs.readFileSync(SERVER_JS, 'utf8');
        const start = txt.indexOf('const p_names = {');
        if (start < 0) return {};
        const open = txt.indexOf('{', start);
        let depth = 0, end = -1;
        for (let i = open; i < txt.length; i++) {
            const c = txt[i];
            if (c === '{') depth++;
            else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        // eslint-disable-next-line no-eval
        const obj = eval('(' + txt.slice(open, end + 1) + ')');
        const out = {};
        for (const k in obj) out[k] = obj[k][0];
        return out;
    } catch {
        return {}; // server.js が無くても続行（名称は data.json のみ）
    }
}

// フロントエンド expoService.js の `export const names = { code: [表示名, 区分] }` を取り出す。
// 車いす等の制限判定はフロントエンドと完全一致させたいので、この定数を正とする。
function loadFrontendNames() {
    try {
        const txt = fs.readFileSync(FRONTEND_SERVICE, 'utf8');
        const start = txt.indexOf('export const names = {');
        if (start < 0) return {};
        const open = txt.indexOf('{', start);
        let depth = 0, end = -1;
        for (let i = open; i < txt.length; i++) {
            const c = txt[i];
            if (c === '{') depth++;
            else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        // eslint-disable-next-line no-eval
        return eval('(' + txt.slice(open, end + 1) + ')');
    } catch {
        return {};
    }
}

async function main() {
    let lineNo = 0, badLines = 0, lastDateKey = null;

    const rl = readline.createInterface({
        input: fs.createReadStream(LOG_PATH, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    for await (const line of rl) {
        lineNo++;
        if (!line) continue;

        if (line[0] === '{') {
            // 日次ベースライン JSON ブロブ + 直後に連結された通常レコード
            const end = findJsonEnd(line);
            if (end < 0) { badLines++; continue; }
            let parsed = null;
            try { parsed = JSON.parse(line.slice(0, end + 1)); } catch { badLines++; }
            const rest = line.slice(end + 1).trim();
            let dateKey = null;
            if (rest) {
                const m = rest.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
                if (m) dateKey = dateKeyOf(Number(m[1]), Number(m[2]), Number(m[3]));
                parseRecord(rest);
            }
            if (!dateKey) dateKey = lastDateKey;
            if (parsed && dateKey) {
                // 空でない時間枠を持つコードのみベースラインに残す
                const base = {};
                for (const code in parsed) {
                    const slots = parsed[code];
                    if (!Array.isArray(slots) || slots.length === 0) continue;
                    const m = {};
                    for (const sc of slots) m[sc.t] = sc.s;
                    base[code] = m;
                }
                getDay(dateKey).base = base;
                lastDateKey = dateKey;
            }
            continue;
        }

        const dk = parseRecord(line);
        if (dk) lastDateKey = dk;
        else badLines++;
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });

    // 名前マップ: data.json をベースに、server.js の手動名称で不足分を補完
    let nameMap = {};
    try { nameMap = JSON.parse(fs.readFileSync(NAME_MAP_PATH, 'utf8')); }
    catch (e) { console.warn('data.json を読めませんでした:', e.message); }
    const curated = loadCuratedNames();
    for (const code in curated) if (!nameMap[code]) nameMap[code] = curated[code];
    fs.writeFileSync(path.join(OUT_DIR, 'names.json'), JSON.stringify(nameMap));

    // 車いす等の制限判定（フロントエンド filterData と同一ロジック）。
    // 名前はフロントエンド names 定数の表示名を優先し、無ければ nameMap を使う。
    const frontendNames = loadFrontendNames();
    const isRestricted = (code) =>
        RESTRICTED_RE.test((code in frontendNames ? frontendNames[code][0] : nameMap[code]) || '');

    // 高需要館の判定: 館ごとの「全日平均✗遷移数」で判定（日次は揺らぐため全日通しで算出）。
    const demandByCode = new Map(); // code -> { sum, days }
    for (const day of days.values()) {
        const perCode = new Map();
        for (const e of day.ev) if (e[3] === 2) perCode.set(e[1], (perCode.get(e[1]) || 0) + 1);
        for (const [code, n] of perCode) {
            const d = demandByCode.get(code) || { sum: 0, days: 0 };
            d.sum += n; d.days += 1; demandByCode.set(code, d);
        }
    }
    const isHighDemand = (code) => {
        const d = demandByCode.get(code);
        return d ? d.sum / d.days >= DEMAND_X2_MIN : false;
    };

    const dateKeys = [...days.keys()].sort();
    let totalEv = 0, totalBytes = 0, totalPatched = 0;
    for (const dk of dateKeys) {
        const day = days.get(dk);
        if (!day.base) day.base = {}; // ブロブが無い日（初日など）は空ベースライン
        // ◯/△のまま✗へ戻らない枠は変化ログ欠落とみなし、✗を補う（NO_PATCH=1 で無効化＝検証用）
        if (process.env.NO_PATCH !== '1') totalPatched += patchMissingFull(day, isRestricted, isHighDemand);
        // ev は読み込み順＝時刻順。出力。
        const body = JSON.stringify(day);
        fs.writeFileSync(path.join(OUT_DIR, `${dk}.json`), body);
        totalEv += day.ev.length;
        totalBytes += body.length;
    }

    const index = {
        dates: dateKeys,
        minDate: dateKeys[0] || null,
        maxDate: dateKeys[dateKeys.length - 1] || null,
        days: dateKeys.length,
        generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index));

    console.log(`lines=${lineNo} badLines=${badLines}`);
    console.log(`days=${dateKeys.length} (${index.minDate} 〜 ${index.maxDate}) totalEvents=${totalEv} (うち合成✗=${totalPatched})`);
    console.log(`names=${Object.keys(nameMap).length} 件`);
    console.log(`out=${OUT_DIR}  合計 ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
}

main();
