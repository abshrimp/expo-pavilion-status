import React from 'react';
import { SettingsIcon } from './Icons';

const Header = ({ onOpenSettingsModal, onOpenHelpModal }) => {
    return (
        <div className="header">
            <h1>1年前の予約状況</h1>
            <p>大阪・関西万博 2025</p>
            <div className="header-buttons">
                <button className="header-btn" onClick={onOpenSettingsModal} aria-label="Open Settings">
                    <SettingsIcon />
                </button>
                <button className="header-btn" onClick={onOpenHelpModal} aria-label="Open Help">?</button>
            </div>
        </div>
    );
};

export default Header;