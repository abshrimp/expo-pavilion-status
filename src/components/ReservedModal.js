import React, { useEffect, useState } from 'react';
import { CalendarClockIcon } from './Icons';
import { reservePavilion } from '../services/expoService';

const ReservedModal = ({ isOpen, onClose, reserved }) => {
    const [info, setInfo] = useState(null);
    const [status, setStatus] = useState('idle');
    const code = reserved?.code;

    useEffect(() => {
        if (!isOpen || !code) return;
        let alive = true;
        setInfo(null);
        setStatus('loading');
        reservePavilion(code)
            .then((r) => { if (alive) { setInfo(r); setStatus('done'); } })
            .catch(() => { if (alive) setStatus('error'); });
        return () => { alive = false; };
    }, [isOpen, code]);

    if (!isOpen || !reserved) return null;
    const { name, time } = reserved;

    return (
        <div
            className="modal"
            onClick={onClose}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
            <div
                className="modal-content"
                onClick={(e) => e.stopPropagation()}
                style={{
                    margin: 0,
                    maxWidth: 380,
                    maxHeight: '90vh',
                    textAlign: 'center',
                    borderRadius: 0,
                    border: '2px solid var(--color-black)',
                    boxShadow: 'none',
                }}
            >
                <span
                    className="close"
                    onClick={onClose}
                    style={{ fontSize: 40, fontWeight: 300, color: 'var(--color-black)', top: 10, lineHeight: 1 }}
                >&times;</span>

                <h2 style={{ color: 'var(--color-black)', fontSize: '1.3rem', lineHeight: 1.5, marginTop: 10 }}>
                    ＜当日登録＞<br />パビリオン/イベントが予約されました
                </h2>

                <div style={{ display: 'flex', justifyContent: 'center', margin: '28px 0', color: 'var(--color-black)' }}>
                    <CalendarClockIcon />
                </div>

                <p style={{ fontSize: '1rem', fontWeight: 'bold', margin: '24px 0 16px', color: 'var(--color-black)', lineHeight: 1.6 }}>
                    {name}　{time}
                </p>

                {status === 'loading' && (
                    <p style={{ color: 'var(--color-dark-gray)', margin: '0 0 24px' }}>予約番号を確認中…</p>
                )}
                {status === 'done' && info && (
                    <p style={{ fontSize: '0.85rem', color: 'var(--color-black)', margin: '0 0 24px', lineHeight: 1.5 }}>
                        本日このパビリオンを<br />
                        <strong style={{ fontSize: '1.2rem' }}>{info.rank}</strong> 番目に予約しました
                        {info.repeat && (
                            <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-dark-gray)', marginTop: 6 }}>
                                ※本日は予約済みです
                            </span>
                        )}
                    </p>
                )}

                <button
                    onClick={onClose}
                    style={{
                        width: '100%',
                        padding: '14px',
                        background: 'var(--color-white)',
                        color: 'var(--color-black)',
                        border: '2px solid var(--color-black)',
                        borderRadius: 0,
                        fontSize: '1rem',
                        cursor: 'pointer',
                    }}
                >
                    とじる
                </button>
            </div>
        </div>
    );
};

export default ReservedModal;
