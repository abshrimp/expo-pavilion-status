import React from 'react';
import {
    StatusAvailableIcon, StatusFewLeftIcon, StatusFullIcon, StatusNoSlotsIcon,
    HelpSettingsIcon
} from './Icons';


const HelpModal = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div className="modal" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <span className="close" onClick={onClose}>&times;</span>
                <h2>使い方</h2>

                <div className="usage-section">
                    <h3>はじめに</h3>
                    <p>• 本サイトは、<strong>ちょうど1年前の同じ日時</strong>の大阪・関西万博2025の当日予約状況を再生して表示する非公式サイトです。</p>
                    <p>• 過去の記録のため実際の予約はできませんが、◯（空きあり）をタップすると当時の予約完了画面風の演出とともに、当サイト上で<strong>そのパビリオンを今日何番目に予約できたか</strong>を表示します。</p>
                    <p>• 本サイトは有志により個人的に作成された<strong>非公式</strong>のものであり、博覧会協会およびその他の関連団体とは一切関係ございません。</p>
                </div>

                <div className="usage-section">
                    <h3>予約状況の見方</h3>
                    <div className="legend">
                        <div className="legend-item">
                            <span className="legend-icon"><StatusAvailableIcon /></span>
                            <div><strong>空きあり (疑似予約できます)</strong></div>
                        </div>
                        <div className="legend-item">
                            <span className="legend-icon"><StatusFewLeftIcon /></span>
                            <div><strong>残りわずか</strong></div>
                        </div>
                        <div className="legend-item">
                            <span className="legend-icon"><StatusFullIcon /></span>
                            <div><strong>空きなし</strong></div>
                        </div>
                        <div className="legend-item">
                            <span className="legend-icon"><StatusNoSlotsIcon /></span>
                            <div><strong>予約枠なし</strong></div>
                        </div>
                    </div>
                </div>

                <div className="usage-section">
                    <h3>操作方法</h3>
                    <p>• 設定ボタン（<HelpSettingsIcon />）で表示の絞り込みができます。</p>
                </div>

                <div className="usage-section">
                    <h3>免責事項</h3>
                    <p>• 本サイトは有志によって作成された非公式の情報提供サイトです。博覧会協会およびその他の関係団体とは一切関係がありません。</p>
                    <p>• 掲載している情報は正確を期すよう努めておりますが、その内容の正確性、最新性、完全性について保証するものではありません。</p>
                    <p>• 本サイトの利用により生じたいかなる損害についても、運営者は一切の責任を負いません。</p>
                    <p>• サービスは予告なく変更または削除されることがあります。</p>
                    <p>• 本サイトでは、Google アナリティクスを使用しており、個人を特定しない形でトラフィックデータを収集しています。</p>
                    <p>• チケットID・パスワードなど、個人を特定する情報は一切収集しておりません。</p>
                </div>

                <div className="usage-section" style={{ textAlign: 'center', marginTop: '30px' }}>
                    <p style={{ color: 'var(--color-dark-gray)', fontSize: '0.7rem' }}>
                        Created by <a href="https://x.com/s__hrimp" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-blue)', textDecoration: 'none' }}>@s__hrimp</a>
                    </p>
                </div>
            </div>
        </div>
    );
};

export default HelpModal;