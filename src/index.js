import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'; // if you have one
import App from './App';
import './App.css'; // Import your main CSS file

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
