import React from 'react';

const Controls = ({ currentDate }) => {
    return (
        <div className="controls">
            <div className="current-date">
                <span>{currentDate}</span>
            </div>
        </div>
    );
};

export default Controls;