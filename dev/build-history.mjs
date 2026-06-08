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

// "HH:MM:SS" に1分加算（日付を跨ぐ場合は 23:59:59 に丸める）
function addOneMinute(t) {
    const [h, mi, s] = t.split(':').map(Number);
    let total = h * 3600 + mi * 60 + s + 60;
    if (total >= 24 * 3600) total = 24 * 3600 - 1; // 23:59:59 に丸め
    return hms(Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60);
}

// ◯/△ のまま ✗ へ戻る変化が記録されていない枠は、✗ へ戻る変化ログが抜け落ちている
// 可能性が高い。次のケースについて ✗（status 2）への合成イベントを補う。
//   (1) イベントで◯になり、その後変化が無い枠 … 最終◯の1分後に✗
//   (2) base が◯のまま終日イベントが無い枠   … 9:00 に✗
//   (3) イベントで△になり、その後変化が無い枠 … 最終△の1分後に✗
//       ただし △ になったのが 20:00 より前 かつ 非車椅子枠（isRestricted=false）に限る。
//       さらに 10:00 以降の△は、その時刻に◯/△が同時4枠以上ある「人気なし」枠を
//       補正しない（10:00より前＝オープンラッシュ中の△は人気判定せず常に✗）。
//       （◯→✗ の (1)(2) は人気に関わらず通常どおり補正する）
// いずれも ✗ にする時刻は 9:00 以降に丸める。戻り値は追加した件数。
// isRestricted(code) はフロントエンド filterData と同じ「車いす等の制限」判定。
const NINE_AM = '09:00:00';
const EIGHT_PM = '20:00:00';
// オープンラッシュ（予約開始直後）の終端△は、どの館も多数◯になり人気判定が誤るため、
// この時刻より前の△には人気判定を適用せず常に✗を補う。
const OPEN_RUSH_END = '10:00:00';
function patchMissingFull(day, isRestricted) {
    // 枠（code+slot）ごとの最終イベントと、code ごとのイベント列（時刻順）を作る。
    // ※どちらも合成イベントを混ぜる前の元データから作る（人気判定を実データで行うため）
    const lastByKey = new Map();
    const evByCode = new Map();
    for (const e of day.ev) {
        lastByKey.set(`${e[1]}\t${e[2]}`, e);
        let arr = evByCode.get(e[1]);
        if (!arr) { arr = []; evByCode.set(e[1], arr); }
        arr.push(e);
    }

    // 時刻 T 時点での code の「◯/△（status<=1）枠数」を、base + その時刻までのイベントで復元
    const availableCountAt = (code, T) => {
        const state = Object.assign({}, day.base[code] || {});
        const arr = evByCode.get(code) || [];
        for (const e of arr) {
            if (e[0] > T) break;
            state[e[2]] = e[3];
        }
        let cnt = 0;
        for (const k in state) if (state[k] <= 1) cnt++;
        return cnt;
    };

    let added = 0;
    const pushFull = (time, code, slot) => {
        day.ev.push([time < NINE_AM ? NINE_AM : time, code, slot, 2]);
        added++;
    };

    // (1)(3) イベントで◯/△になったまま戻らない枠
    for (const e of lastByKey.values()) {
        if (e[3] === 0) {
            // (1) 最終◯の1分後（最早でも9:00）に✗
            pushFull(addOneMinute(e[0]), e[1], e[2]);
        } else if (e[3] === 1 && e[0] < EIGHT_PM && !isRestricted(e[1])) {
            // (3) 20:00より前・非車椅子の△のみ。10:00以降の△は、その時刻に◯/△が
            //     同時4枠以上あるパビリオンを「人気なし」とみなし補正しない。
            //     （10:00より前＝オープンラッシュ中の△は人気判定せず常に✗）
            if (e[0] >= OPEN_RUSH_END && availableCountAt(e[1], e[0]) >= 4) continue;
            pushFull(addOneMinute(e[0]), e[1], e[2]);
        }
    }

    // (2) base が◯のまま、その日その枠にイベントが1件も無い枠 … 9:00 に✗
    for (const code in day.base) {
        const slots = day.base[code];
        for (const slot in slots) {
            if (slots[slot] !== 0) continue;
            if (lastByKey.has(`${code}\t${slot}`)) continue; // イベントがある枠は(1)で処理済み
            pushFull(NINE_AM, code, slot);
        }
    }

    if (added) {
        // 合成イベントを混ぜたので時刻順へ並べ直す（同時刻は元の順序を維持）
        day.ev.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    }
    return added;
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

    const dateKeys = [...days.keys()].sort();
    let totalEv = 0, totalBytes = 0, totalPatched = 0;
    for (const dk of dateKeys) {
        const day = days.get(dk);
        if (!day.base) day.base = {}; // ブロブが無い日（初日など）は空ベースライン
        // ◯/△のまま✗へ戻らない枠は変化ログ欠落とみなし、✗を補う（NO_PATCH=1 で無効化＝検証用）
        if (process.env.NO_PATCH !== '1') totalPatched += patchMissingFull(day, isRestricted);
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
