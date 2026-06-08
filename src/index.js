import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css'; // if you have one
import App from './App';
import DebugPage from './components/DebugPage';
import './App.css'; // Import your main CSS file

// デバッグページは本番ビルド(production)では無効化する
const DEBUG_ENABLED = process.env.NODE_ENV !== 'production';

// 簡易ハッシュルーティング（ルーターライブラリ不要・静的ホスティングでも動作）
const isDebugHash = () => {
    if (!DEBUG_ENABLED) return false;
    const h = window.location.hash.replace(/^#\/?/, '').toLowerCase();
    return h === 'debug' || h.startsWith('debug/') || h.startsWith('debug?');
};

function Root() {
    const [debug, setDebug] = useState(isDebugHash());
    useEffect(() => {
        const onHash = () => setDebug(isDebugHash());
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);
    return debug ? <DebugPage /> : <App />;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <Root />
    </React.StrictMode>
);
