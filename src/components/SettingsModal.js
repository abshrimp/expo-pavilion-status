import React from 'react';

const SettingsModal = ({ isOpen, onClose, settings, onSettingsChange }) => {
    if (!isOpen) return null;

    const handleToggle = (key) => {
        onSettingsChange({ ...settings, [key]: !settings[key] });
    };

    return (
        <div className="modal" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <span className="close" onClick={onClose}>&times;</span>
                <h2>設定</h2>
                <div className="usage-section">
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            id="showAvailableOnly"
                            checked={settings.showAvailableOnly}
                            onChange={() => handleToggle('showAvailableOnly')}
                        />
                        <span className="label-text">空きがあるものだけ表示</span>
                    </label>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            id="showWheelchairAccessible"
                            checked={settings.showWheelchairAccessible}
                            onChange={() => handleToggle('showWheelchairAccessible')}
                        />
                        <span className="label-text">車いす等の制限があるものを表示</span>
                    </label>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;