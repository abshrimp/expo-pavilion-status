import React, { useEffect, useState } from 'react';
import { getStatusIconComponent, names, serverNow } from '../services/expoService';
import ReservedModal from './ReservedModal';

const str2date = (time) => {
    const hours = time.slice(0, 2);
    const minutes = time.slice(2, 4);
    const date = serverNow();
    date.setHours(Number(hours), Number(minutes), 0, 0);
    return date;
}

const PavilionTable = ({ pavilions, setIsOpen, settings, errMsg }) => {
    const [timeSlots, setTimeSlots] = useState([]);
    const [tableData, setTableData] = useState([]);
    const [reserved, setReserved] = useState(null);
    const [notice, setNotice] = useState(null);

    useEffect(() => {
        let minDate = serverNow();
        minDate.setHours(8, 30, 0, 0);
        let maxDate = serverNow();
        maxDate.setHours(21, 59, 0, 0);

        const interval = 15 * 60 * 1000;
        const times = [];
        const timesCount = [];
        const availableTimesCount = [];
        for (let t = minDate.getTime(); t <= maxDate.getTime(); t += interval) {
            times.push(new Date(t));
            timesCount.push(0);
            availableTimesCount.push(0);
        }

        const tableDataTmp = [];
        for (let i = 0; i < pavilions.length; i++) {
            if (pavilions[i].n == "") continue;

            const timeData = {};
            const slotTimeData = {}; // 列キー -> 実際のスロット時刻文字列（"1458" 等）
            for (let j = 0; j < pavilions[i].s.length; j++) {
                const time = str2date(pavilions[i].s[j].t);
                for (let k = 0; k < times.length - 1; k++) {
                    if (times[k] <= time && time < times[k + 1]) {
                        timesCount[k]++;
                        const key = times[k].getTime();
                        // 列内で最も空いている（status が小さい）スロットを採用し、その実時刻も記録
                        if (!(key in timeData) || pavilions[i].s[j].s < timeData[key]) {
                            timeData[key] = pavilions[i].s[j].s;
                            slotTimeData[key] = pavilions[i].s[j].t;
                        }
                        if (Number(pavilions[i].s[j].s) <= 1) availableTimesCount[k]++;
                        break;
                    }
                }
            }

            tableDataTmp.push({
                code: pavilions[i].c,
                name: pavilions[i].c in names ? names[pavilions[i].c][0].replaceAll(names[pavilions[i].c][1], "") : pavilions[i].n,
                category: pavilions[i].c in names ? names[pavilions[i].c][1] : '',
                fullName: pavilions[i].n,
                url: pavilions[i].u,
                timeData: timeData,
                slotTimeData: slotTimeData
            })
        }

        const start = timesCount.findIndex(x => x !== 0);
        const end = timesCount.length - 1 - [...timesCount].reverse().findIndex(x => x !== 0);
        const newTimes = times.slice(start, end + 1);
        setTimeSlots(newTimes);

        const now = serverNow();
        if (newTimes.length == 0 ||
            now.getHours() < 8 ||
            (now.getHours() == 8 && now.getMinutes() < 30) ||
            (now.getHours() >= 21 && newTimes[newTimes.length - 1].toTimeString().slice(0, 8) < now.toTimeString().slice(0, 8))) {
            setTableData([]);
            setIsOpen(false);
        } else {
            if (settings.showAvailableOnly) {
                setTimeSlots(times.filter((_, i) => availableTimesCount[i] > 0));
            }
            setTableData(tableDataTmp);
            setIsOpen(true);
        }

    }, [pavilions]);

    const nowClock = serverNow();
    const reservationOpen = nowClock.getHours() > 9 || (nowClock.getHours() === 9 && nowClock.getMinutes() >= 10);

    return (
        <>
        <div className="table-container">
            {tableData && tableData.length > 0 ? (
                <table className="reservation-table">
                    <thead>
                        <tr>
                            <th>施設名</th>
                            {timeSlots.map(time => {
                                const hhmm = time.toTimeString().slice(0, 5);
                                return <th key={`header-${hhmm}`}>{`${hhmm}`}</th>
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {tableData.map((pavilion) => (
                            <tr key={pavilion.code}>
                                <td>
                                    {pavilion.url ? (
                                        <a href={pavilion.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-blue)' }}>
                                            {pavilion.name}
                                        </a>
                                    ) : (
                                        pavilion.name
                                    )}
                                    <span className="pavilion-category">{pavilion.category}</span>
                                </td>
                                {timeSlots.map(time => {
                                    const hhmm = time.toTimeString().slice(0, 5);
                                    const status = time.getTime() in pavilion.timeData ? pavilion.timeData[time.getTime()].toString() : '';

                                    const uniqueCellKey = `${pavilion.code}-${hhmm}`;

                                    // ◯（空きあり = status 0）なら押せる。9:10より前は注意メッセージを表示
                                    const clickable = status === '0';
                                    // 列は15分刻みだが、表示は実際のスロット時刻（"1458" → "14:58"）
                                    const slotRaw = pavilion.slotTimeData[time.getTime()];
                                    const slotLabel = slotRaw ? `${slotRaw.slice(0, 2)}:${slotRaw.slice(2, 4)}` : hhmm;
                                    const reserve = () => {
                                        if (!reservationOpen) {
                                            setNotice('まだ入場していません！9時10分以降に押せるようになります');
                                            return;
                                        }
                                        setReserved({
                                            name: pavilion.fullName || pavilion.name,
                                            time: slotLabel,
                                            code: pavilion.code,
                                        });
                                    };

                                    return (
                                        <td key={uniqueCellKey}>
                                            <span
                                                className={`status-icon ${clickable ? 'status-icon-hover' : ''}`}
                                                onClick={clickable ? reserve : undefined}
                                                role={clickable ? 'button' : undefined}
                                                tabIndex={clickable ? 0 : -1}
                                                onKeyDown={clickable ? (e) => {
                                                    if (e.key === 'Enter' || e.key === ' ') reserve();
                                                } : undefined}
                                            >
                                                {getStatusIconComponent(status)}
                                            </span>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : (
                <div className="no-data-message" style={{
                    height: '100%',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    color: 'rgb(102, 102, 102)',
                    backgroundColor: 'rgb(245, 245, 245)',
                }}>
                    {(() => {
                        if (errMsg) return errMsg;

                        const now = serverNow();
                        const hour = now.getHours();
                        if (hour < 9 || hour >= 21) {
                            return "営業時間外です";
                        }
                        return "表示できるデータがありません";
                    })()}
                </div>
            )}
        </div>
        <ReservedModal isOpen={!!reserved} onClose={() => setReserved(null)} reserved={reserved} />
        {notice && (
            <div
                className="modal"
                onClick={() => setNotice(null)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
                <div
                    className="modal-content"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        margin: 0,
                        maxWidth: 340,
                        textAlign: 'center',
                        borderRadius: 0,
                        border: '2px solid var(--color-black)',
                        boxShadow: 'none',
                        padding: 24,
                    }}
                >
                    <p style={{ color: 'var(--color-black)', fontWeight: 'bold', lineHeight: 1.7, margin: '8px 0 20px' }}>
                        {notice}
                    </p>
                    <button
                        onClick={() => setNotice(null)}
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
        )}
        </>
    );
};

export default PavilionTable;