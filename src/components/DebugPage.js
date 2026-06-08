import React, { useEffect, useRef, useState } from 'react';
import {
    YEARS_BACK,
    serverNow,
    getReplayDate,
    getDebugClock,
    setDebugClock,
    clearDebugClock,
    replayDateToServerMs,
} from '../services/expoService';

const pad2 = (n) => String(n).padStart(2, '0');

// Date -> datetime-local の value 文字列(秒まで)
function toLocalInput(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
        `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function formatReplay(d) {
    return d.toLocaleString('ja-JP', {
        year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

const SPEEDS = [1, 2, 5, 10, 30, 60, 300, 600];
const JUMPS = [
    { label: '-1時間', ms: -3600 * 1000 },
    { label: '-10分', ms: -600 * 1000 },
    { label: '-1分', ms: -60 * 1000 },
    { label: '+1分', ms: 60 * 1000 },
    { label: '+10分', ms: 600 * 1000 },
    { label: '+1時間', ms: 3600 * 1000 },
];

function DebugPage() {
    // 表示用: 現在の再生時刻(ライブ更新)
    const [nowReplay, setNowReplay] = useState(getReplayDate());
    // クロックが有効か
    const [active, setActive] = useState(!!getDebugClock());
    // 再生速度(再生中の倍率) と 再生/一時停止
    const [speed, setSpeed] = useState(() => {
        const c = getDebugClock();
        return c && c.speed > 0 ? c.speed : 1;
    });
    const [playing, setPlaying] = useState(() => {
        const c = getDebugClock();
        return c ? c.speed > 0 : true;
    });
    // 日時入力(ジャンプ先)
    const [input, setInput] = useState(toLocalInput(getReplayDate()));

    const speedRef = useRef(speed);
    const playingRef = useRef(playing);
    speedRef.current = speed;
    playingRef.current = playing;

    // 現在の再生時刻をライブ表示
    useEffect(() => {
        const t = setInterval(() => setNowReplay(getReplayDate()), 200);
        return () => clearInterval(t);
    }, []);

    // 現在のserverNow位置を起点に、speed/playing状態でクロックを張り直す(時刻はジャンプさせない)
    const reanchor = (nextPlaying, nextSpeed) => {
        const eff = nextPlaying ? nextSpeed : 0;
        setDebugClock(serverNow().getTime(), eff);
        setActive(true);
    };

    const handleSpeed = (s) => {
        setSpeed(s);
        if (active) reanchor(playingRef.current, s);
    };

    const togglePlay = () => {
        const next = !playing;
        setPlaying(next);
        if (active) reanchor(next, speedRef.current);
        else {
            // 未有効なら現在の再生時刻のまま有効化
            setDebugClock(replayDateToServerMs(getReplayDate()), next ? speedRef.current : 0);
            setActive(true);
        }
    };

    // 入力した再生日時へジャンプして有効化
    const jumpToInput = () => {
        const d = new Date(input);
        if (isNaN(d.getTime())) return;
        setDebugClock(replayDateToServerMs(d), playingRef.current ? speedRef.current : 0);
        setActive(true);
    };

    // 相対ジャンプ
    const jumpBy = (ms) => {
        const base = active ? getReplayDate() : new Date(input);
        const d = new Date(base.getTime() + ms);
        setInput(toLocalInput(d));
        setDebugClock(replayDateToServerMs(d), playingRef.current ? speedRef.current : 0);
        setActive(true);
    };

    // 入力欄を現在の再生時刻に合わせる
    const syncInputToNow = () => setInput(toLocalInput(getReplayDate()));

    // デバッグ解除(実時刻に戻す)
    const reset = () => {
        clearDebugClock();
        setActive(false);
        setPlaying(true);
        setSpeed(1);
        setInput(toLocalInput(getReplayDate()));
    };

    const s = styles;
    return (
        <div style={s.page}>
            <div style={s.card}>
                <div style={s.titleRow}>
                    <h1 style={s.title}>🛠 デバッグ時刻コントロール</h1>
                    <a href="#/" style={s.link}>← アプリへ戻る</a>
                </div>

                <div style={{ ...s.statusBar, background: active ? '#1f6feb' : '#444' }}>
                    {active
                        ? `デバッグ時刻 有効${playing ? `（${speed}倍速 再生中）` : '（一時停止中）'}`
                        : 'デバッグ時刻 無効（実時刻で動作中）'}
                </div>

                <div style={s.bigClock}>{formatReplay(nowReplay)}</div>
                <div style={s.sub}>
                    実時刻換算: {formatReplay(serverNow())}（履歴は{YEARS_BACK}年前のデータを再生）
                </div>

                <div style={s.section}>
                    <div style={s.label}>再生時刻を指定してジャンプ</div>
                    <div style={s.row}>
                        <input
                            type="datetime-local"
                            step="1"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            style={s.input}
                        />
                        <button style={s.btnPrimary} onClick={jumpToInput}>ジャンプ</button>
                        <button style={s.btn} onClick={syncInputToNow}>現在値を取得</button>
                    </div>
                    <div style={s.row}>
                        {JUMPS.map((j) => (
                            <button key={j.label} style={s.btnSm} onClick={() => jumpBy(j.ms)}>{j.label}</button>
                        ))}
                    </div>
                </div>

                <div style={s.section}>
                    <div style={s.label}>早送り速度</div>
                    <div style={s.row}>
                        {SPEEDS.map((sp) => (
                            <button
                                key={sp}
                                style={active && speed === sp ? s.btnActive : s.btn}
                                onClick={() => handleSpeed(sp)}
                            >
                                {sp}倍
                            </button>
                        ))}
                    </div>
                </div>

                <div style={s.section}>
                    <div style={s.row}>
                        <button style={s.btnPrimary} onClick={togglePlay}>
                            {playing && active ? '⏸ 一時停止' : '▶ 再生'}
                        </button>
                        <button style={s.btnDanger} onClick={reset}>実時刻に戻す</button>
                    </div>
                </div>

                <p style={s.note}>
                    ※ 設定はブラウザに保存され、別タブで開いたアプリ本体にも即時反映されます。
                </p>
            </div>
        </div>
    );
}

const baseBtn = {
    border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 14,
    cursor: 'pointer', color: '#fff', background: '#3a3f47',
};
const styles = {
    page: {
        minHeight: '100vh', background: '#0d1117', color: '#e6edf3',
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        padding: '24px 12px', boxSizing: 'border-box',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    },
    card: {
        width: '100%', maxWidth: 560, background: '#161b22',
        border: '1px solid #30363d', borderRadius: 12, padding: 20,
    },
    titleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
    title: { fontSize: 18, margin: 0 },
    link: { color: '#58a6ff', textDecoration: 'none', fontSize: 14, whiteSpace: 'nowrap' },
    statusBar: { marginTop: 14, padding: '8px 12px', borderRadius: 6, fontSize: 14, fontWeight: 600 },
    bigClock: { marginTop: 16, fontSize: 26, fontWeight: 700, textAlign: 'center', fontVariantNumeric: 'tabular-nums' },
    sub: { marginTop: 4, fontSize: 12, color: '#8b949e', textAlign: 'center' },
    section: { marginTop: 20 },
    label: { fontSize: 13, color: '#8b949e', marginBottom: 8 },
    row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 8 },
    input: {
        flex: '1 1 220px', padding: '8px 10px', borderRadius: 6,
        border: '1px solid #30363d', background: '#0d1117', color: '#e6edf3', fontSize: 14,
    },
    btn: baseBtn,
    btnSm: { ...baseBtn, padding: '6px 10px', fontSize: 13 },
    btnPrimary: { ...baseBtn, background: '#238636' },
    btnDanger: { ...baseBtn, background: '#b62324' },
    btnActive: { ...baseBtn, background: '#1f6feb', outline: '2px solid #58a6ff' },
    note: { marginTop: 18, fontSize: 12, color: '#8b949e' },
};

export default DebugPage;
