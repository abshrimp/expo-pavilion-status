const HISTORY_BASE = `${process.env.PUBLIC_URL || ''}/history`;
const RESERVE_URL = process.env.REACT_APP_RESERVE_URL ?? `${process.env.PUBLIC_URL || ''}/reserve.php`;
export const YEARS_BACK = Number(process.env.REACT_APP_YEARS_BACK || 1);

const TIME_URL = process.env.REACT_APP_TIME_URL ?? 'https://3fe5a5f690efc790d4764f1c528a4ebb89fa4168.nict.go.jp/cgi-bin/json';
let _serverOffsetMs = 0;
let _syncing = false;

export async function syncServerTime() {
    if (_syncing) return;
    _syncing = true;
    try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 4000);
        const t0 = Date.now();
        const res = await fetch(TIME_URL, { cache: 'no-store', signal: ctrl.signal });
        const t1 = Date.now();
        clearTimeout(to);
        if (res.ok) {
            const data = await res.json();
            if (typeof data.st === 'number') {
                _serverOffsetMs = data.st * 1000 - (t0 + (t1 - t0) / 2);
            }
        }
    } catch {
        // 失敗しても何もしない
    } finally {
        _syncing = false;
    }
}

export function serverNow() {
    return new Date(Date.now() + _serverOffsetMs);
}

export function getReplayDate() {
    const d = serverNow();
    d.setFullYear(d.getFullYear() - YEARS_BACK);
    return d;
}

const pad2 = (n) => String(n).padStart(2, '0');

let _namesPromise = null;
function loadNames() {
    if (!_namesPromise) {
        _namesPromise = fetch(`${HISTORY_BASE}/names.json`)
            .then((r) => (r.ok ? r.json() : {}))
            .catch(() => ({}));
    }
    return _namesPromise;
}

const _dayCache = new Map();
function loadDay(dateKey) {
    if (_dayCache.has(dateKey)) return _dayCache.get(dateKey);
    const p = fetch(`${HISTORY_BASE}/${dateKey}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    _dayCache.set(dateKey, p);
    return p;
}

export function getReplayKeyAndTime() {
    const d = getReplayDate();
    return {
        dateKey: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
        hms: `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`,
    };
}

export const DEFAULT_SETTINGS = {
    showAvailableOnly: false,
    showWheelchairAccessible: true,
};

export async function fetchExpoData() {
    const { dateKey, hms } = getReplayKeyAndTime();
    const [day, nameMap] = await Promise.all([loadDay(dateKey), loadNames()]);
    if (!day) return [];
    const state = {};
    for (const c in day.base) state[c] = { ...day.base[c] };
    for (let i = 0; i < day.ev.length; i++) {
        const ev = day.ev[i];
        if (ev[0] <= hms) {
            (state[ev[1]] || (state[ev[1]] = {}))[ev[2]] = ev[3];
        } else {
            break;
        }
    }

    const nowHM = hms.slice(0, 2) + hms.slice(3, 5);

    const result = [];
    for (const c in state) {
        const slotObj = state[c];
        const s = Object.keys(slotObj)
            .filter((t) => t >= nowHM)
            .sort()
            .map((t) => ({ t, s: slotObj[t] }));
        if (s.length === 0) continue;
        result.push({ c, n: nameMap[c] || '名称不明', u: '', s });
    }
    result.sort((a, b) => a.c.localeCompare(b.c));
    return result;
}

export function getBrowserId() {
    try {
        let id = localStorage.getItem('bid');
        if (!id) {
            id = (window.crypto && crypto.randomUUID)
                ? crypto.randomUUID().replace(/-/g, '')
                : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
            localStorage.setItem('bid', id);
        }
        return id;
    } catch {
        return '';
    }
}

function localTodayKey() {
    const d = serverNow();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function loadReservedToday() {
    try {
        const obj = JSON.parse(localStorage.getItem('reservedToday') || 'null');
        if (obj && obj.date === localTodayKey() && obj.map) return obj;
    } catch { /* ignore */ }
    return { date: localTodayKey(), map: {} };
}
function saveReservedToday(store) {
    try { localStorage.setItem('reservedToday', JSON.stringify(store)); } catch { /* ignore */ }
}

export async function reservePavilion(code) {
    const store = loadReservedToday();
    if (store.map[code]) {
        return { ...store.map[code], repeat: true };
    }
    const res = await fetch(RESERVE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, bid: getBrowserId() }),
    });
    if (!res.ok) throw new Error('予約番号の取得に失敗しました');
    const data = await res.json();
    store.map[code] = { rank: data.rank, total: data.total };
    saveReservedToday(store);
    return data;
}

export function getStatusIconComponent(status) {
    const { StatusAvailableIcon, StatusFewLeftIcon, StatusFullIcon, StatusNoSlotsIcon } = require('../components/Icons'); // Lazy load to avoid circular deps if Icons import something from service

    switch (status.toString()) {
        case '0': return <StatusAvailableIcon />;
        case '1': return <StatusFewLeftIcon />;
        case '2': return <StatusFullIcon />;
        default: return <StatusNoSlotsIcon />;
    }
}

export function saveSettings(settings) {
    try {
        localStorage.setItem('expoSettings', JSON.stringify(settings));
    } catch (error) {
        console.error('設定の保存に失敗しました:', error);
    }
}

export function loadSettings() {
    try {
        const savedSettings = localStorage.getItem('expoSettings');
        return savedSettings ? JSON.parse(savedSettings) : DEFAULT_SETTINGS;
    } catch (error) {
        console.error('設定の読み込みに失敗しました:', error);
        return DEFAULT_SETTINGS;
    }
}

export function filterData(data, settings) {
    if (!data) return [];

    return data.filter(pavilion => {
        if (pavilion.n == "") return false;

        if (settings.showAvailableOnly) {
            const hasAvailableSlots = pavilion.s && pavilion.s.some(slot => slot.s === 0 || slot.s === 1);
            if (!hasAvailableSlots) return false;
        }

        if (!settings.showWheelchairAccessible) {
            const name = pavilion.c in names ? names[pavilion.c][0] : pavilion.n;
            const isActuallyAccessibleOrHasRestrictions = name &&
                (name.includes('車いす') ||
                    name.includes('車椅子') ||
                    name.includes('障がい') ||
                    name.includes('障害') ||
                    name.includes('バリアフリー')
                );
            if (isActuallyAccessibleOrHasRestrictions) return false;
        }
        return true;
    });
}


export function getCurrentFormattedDate() {
    const replay = getReplayDate();
    return replay.toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        weekday: "short",
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    }) + "の予約状況";
}

export const names = {
    'C060': ['アイルランド生演奏含むツアー', '生演奏含むツアー'],
    'C063': ['アイルランドバンドライブ', 'バンドライブ'],
    'C066': ['アイルランド自由観覧', '自由観覧'],
    'C0R0': ['UAE', ''],
    'C0R3': ['UAEバリアフリー', 'バリアフリー'],
    'C2N0': ['イタリア~15:00', '~15:00'],
    'C2N3': ['イタリア15:00~', '15:00~'],
    'C570': ['英国', ''],
    'C730': ['オーストラリア', ''],
    'C7R0': ['オランダ', ''],
    'C930': ['カナダ', ''],
    'C9J0': ['韓国', ''],
    'CCB0': ['クウェート', ''],
    'CFR0': ['赤十字', ''],
    'CFV0': ['国連', ''],
    'CM30': ['セルビア', ''],
    'CO70': ['タイ', ''],
    'CO73': ['タイ障がい者用', '障がい者用'],
    'D630': ['ポーランド', ''],
    'D633': ['ポーランドショパン', 'ショパン'],
    'EDF0': ['ヨルダン', ''],
    'H1H9': ['日本館', ''],
    'H1HC': ['日本館プラント見学', 'プラント見学'],
    'H1HF': ['日本館プラント見学車いす', 'プラント見学車いす'],
    'H5H0': ['ヘルスケアリボーン', 'リボーン'],
    'H5H3': ['ヘルスケアリボ+人生', 'リボ+人生'],
    'H5H6': ['ヘルスケアリボ(ミライのじぶん無し)', 'リボ(ミライのじぶん無し)'],
    'H5H9': ['ヘルスケアモンハン', 'モンハン'],
    'H5HC': ['ヘルスケアモンハン(車いす)', 'モンハン(車いす)'],
    'H7H0': ['関西', ''],
    'H7H3': ['関西飲食付ハイチェア', '飲食付ハイチェア'],
    'H7H6': ['関西飲食付ローチェア', '飲食付ローチェア'],
    'HAH0': ['NTT', ''],
    'HCH0': ['電力館', ''],
    'HCH3': ['電力館車いす', '車いす'],
    'HCH6': ['電力館15歳以下', '15歳以下'],
    'HEH0': ['住友館', ''],
    'HEH3': ['住友館車いす', '車いす'],
    'HEH6': ['住友館植林体験', '植林体験'],
    'HGH0': ['ノモの国', ''],
    'HGH3': ['ノモの国15歳以下', '15歳以下'],
    'HIH0': ['三菱未来館', ''],
    'HIH3': ['三菱未来館車いす', '車いす'],
    'HKH0': ['よしもと', ''],
    'HMH0': ['PASONA', ''],
    'HMH3': ['PASONA車いす', '車いす'],
    'HOH0': ['ブルーオーシャンドーム', ''],
    'HOH3': ['ブルーオーシャンドーム車いす', '車いす'],
    'HQH0': ['ガンダム', ''],
    'HSH0': ['TECH WORLD', ''],
    'HUH0': ['ガス・おばけ', ''],
    'HUH3': ['ガス・おばけ車いす・補助犬', '車いす・補助犬'],
    'HUH6': ['ガス・おばけスマートデバイス', 'スマートデバイス'],
    'HWH0': ['飯田×大阪公立大学', ''],
    'HWH3': ['飯田×大阪公立大学車いす', '車いす'],
    'I300': ['Better Co-Being', ''],
    'I600': ['いのちの未来', ''],
    'I603': ['いのちの未来車いす', '車いす'],
    'I606': ['いのちの未来インクルーシブ', 'インクルーシブ'],
    'I900': ['いのちの遊び場', ''],
    'I903': ['いのちの遊び場車いす', '車いす'],
    'I906': ['いのちの遊び場English', 'English'],
    'I909': ['いのちの遊び場English車いす', 'English車いす'],
    'I90C': ['いのちの遊び場ぺちゃくちゃ', 'ぺちゃくちゃ'],
    'I90F': ['いのちの遊び場ぺちゃくちゃ(車いす)', 'ぺちゃくちゃ(車いす)'],
    'IC00': ['null²', ''],
    'IC03': ['null²インスタレーション', 'インスタレーション'],
    'IC09': ['null²インスタレーション', 'インスタレーション'],
    'IF00': ['いのち動的平衡館', ''],
    'IF03': ['いのち動的平衡館触覚体験(視覚・聴覚に障害がある方)', '触覚体験(視覚・聴覚に障害がある方)'],
    'II00': ['いのちめぐる冒険超時空シアター', '超時空シアター'],
    'II03': ['いのちめぐる冒険超時空シアター(車いす)', '超時空シアター(車いす)'],
    'II06': ['いのちめぐる冒険ANIMA!', 'ANIMA!'],
    'IL00': ['EARTH MART', ''],
    'IO00': ['いのちのあかし', ''],
    'IO03': ['いのちのあかし車いす', '車いす'],
    'IO0F': ['いのちのあかしドキュメンタリー映像', 'ドキュメンタリー映像'],
    'IO0I': ['いのちのあかしドキュメンタリー映像(車いす)', 'ドキュメンタリー映像(車いす)'],
    'J900': ['未来の都市シアター入場付き', 'シアター入場付き'],
    'J903': ['未来の都市シアター入場なし', 'シアター入場なし'],
    'JC00': ['空飛ぶクルマ', ''],
    'Q001': ['アオと夜の虹', ''],
    'Q004': ['アオと夜の虹車いす', '車いす'],
    'Q007': ['万博サウナ90分男性', '90分男性'],
    'Q010': ['万博サウナ90分女性', '90分女性'],
    'Q013': ['万博サウナ90分男女混合', '90分男女混合'],
    'Q0H4': ['ふとももシアター', ''],
    'H3H0': ['ウーマンズ', ''],
    'S04L': ['ジュニアSDGsキャンプ会場内ツアー', '会場内ツアー'],
}