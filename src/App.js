import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import Header from './components/Header';
import Controls from './components/Controls';
import PavilionTable from './components/PavilionTable';
import HelpModal from './components/HelpModal';
import SettingsModal from './components/SettingsModal';
import {
    fetchExpoData,
    loadSettings,
    saveSettings,
    filterData,
    getCurrentFormattedDate,
    syncServerTime
} from './services/expoService';

function App() {
    const [pavilions, setPavilions] = useState([]);
    const [filteredPavilions, setFilteredPavilions] = useState([]);
    const [currentDate, setCurrentDate] = useState(getCurrentFormattedDate());
    const [settings, setSettings] = useState(loadSettings());
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isOpen, setIsOpen] = useState(true);

    const firstRefresh = useRef(false);
    const lastRefresh = useRef(new Date(Date.now() - 60 * 1000));

    const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

    const [errMsg] = useState(false);

    const refreshData = useCallback(async () => {
        if (isRefreshing) return;
        setIsRefreshing(true);
        try {
            const rawData = await fetchExpoData();
            setPavilions(rawData);
            setFilteredPavilions(filterData(rawData, settings));
            setCurrentDate(getCurrentFormattedDate());
        } catch (error) {
            // 取得失敗時は表示を更新しない
        } finally {
            setIsRefreshing(false);
        }
    }, [settings, isRefreshing]);

    useEffect(() => {
        const handlePageShow = () => {
            lastRefresh.current = new Date(Date.now() - 60 * 1000);
            syncServerTime();
        };
        window.addEventListener('pageshow', handlePageShow);
        syncServerTime().finally(() => refreshData());
        const timeTimer = setInterval(syncServerTime, 10 * 60 * 1000);
        return () => {
            window.removeEventListener('pageshow', handlePageShow);
            clearInterval(timeTimer);
        };
    }, [refreshData]);

    useEffect(() => {
        lastRefresh.current = new Date(Date.now() - 60 * 1000);
    }, [isHelpModalOpen, isSettingsModalOpen]);

    useEffect(() => {
        if (firstRefresh.current) return;
        firstRefresh.current = true;

        try {
            const seen = localStorage.getItem('seen');
            const seen2 = sessionStorage.getItem('seen');
            if (!(seen || seen2)) {
                setIsHelpModalOpen(true);
            };
        } catch {
            setIsHelpModalOpen(true);
        }

        try {
            localStorage.setItem('seen', true);
        } catch {
            try {
                sessionStorage.setItem('seen', true);
            } catch {
                console.error("storageに保存できませんでした")
            }
        }
    }, []);

    useEffect(() => {
        const autoRefreshTimer = setInterval(() => {
            const now = new Date();
            if (isOpen && !isRefreshing && !isSettingsModalOpen && !isHelpModalOpen &&
                    now.getSeconds() !== lastRefresh.current.getSeconds()) {
                refreshData();
                lastRefresh.current = now;
            }
            if (!isOpen) {
                setCurrentDate(getCurrentFormattedDate());
            }
        }, 10);
        return () => clearInterval(autoRefreshTimer);
    }, [refreshData, isRefreshing, isSettingsModalOpen, isHelpModalOpen, isOpen]);

    const handleSettingsChange = (newSettings) => {
        setSettings(newSettings);
        saveSettings(newSettings);
        const currentFilteredData = filterData(pavilions, newSettings);
        setFilteredPavilions(currentFilteredData);
    };

    return (
        <div className="App">
            <Header
                onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
                onOpenHelpModal={() => setIsHelpModalOpen(true)}
            />
            <div className="container">
                <Controls currentDate={currentDate} />
                <PavilionTable
                    pavilions={filteredPavilions}
                    setIsOpen={setIsOpen}
                    settings={settings}
                    errMsg={errMsg}
                />
            </div>

            <HelpModal isOpen={isHelpModalOpen} onClose={() => setIsHelpModalOpen(false)} />
            <SettingsModal
                isOpen={isSettingsModalOpen}
                onClose={() => setIsSettingsModalOpen(false)}
                settings={settings}
                onSettingsChange={handleSettingsChange}
            />
        </div>
    );
}

export default App;