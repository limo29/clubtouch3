import { useState, useCallback, useEffect } from 'react';
import { io } from 'socket.io-client';
import api from '../services/api';
import { API_ENDPOINTS, WS_URL } from '../config/api';
import { usePrevious } from './usePrevious';

const RANK_1_MESSAGES = [
    "Neuer Spitzenreiter!", "Führungswechsel!", "Die neue Nummer 1!",
    "Ganz oben!", "Nicht zu stoppen!", "Der König des Clubs!"
];

const RANK_TOP3_MESSAGES = [
    "Neu auf dem Treppchen!", "Podiumsplatz gesichert!",
    "Bronze ist sicher!", "Fantastische Leistung!", "Aufstieg in die Top 3!"
];

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const useHighscoreLogic = () => {
    const [loading, setLoading] = useState(true);
    const [live, setLive] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [startDate, setStartDate] = useState(null);

    const [boards, setBoards] = useState({
        daily: { amount: { entries: [] }, count: { entries: [] } },
        yearly: { amount: { entries: [] }, count: { entries: [] } }
    });

    const [goalProgress, setGoalProgress] = useState({ goals: [], meta: null });
    const [overlay, setOverlay] = useState({ active: false, type: 'GOAL', message: '' });

    // 1. Data Fetching
    const fetchAll = useCallback(async () => {
        try {
            const [allHs, progress] = await Promise.all([
                api.get(API_ENDPOINTS.HIGHSCORE_ALL),
                api.get(API_ENDPOINTS.HIGHSCORE_GOALS_PROGRESS)
            ]);

            const hs = allHs.data || {};
            setBoards({
                daily: { amount: hs?.daily?.amount || { entries: [] }, count: hs?.daily?.count || { entries: [] } },
                yearly: { amount: hs?.yearly?.amount || { entries: [] }, count: hs?.yearly?.count || { entries: [] } }
            });

            setGoalProgress(progress.data);

            if (hs?.daily?.amount?.lastUpdated) setLastUpdated(new Date(hs.daily.amount.lastUpdated));
            if (hs?.daily?.amount?.startDate) setStartDate(new Date(hs.daily.amount.startDate));

            setLoading(false);
        } catch (err) {
            console.error("Failed to fetch highscore data", err);
            // Don't necessarily stop loading if it fails, maybe keep old data
            setLoading(false);
        }
    }, []);

    // 2. Initial Load & WebSocket
    useEffect(() => {
        fetchAll();

        // Auth token might be needed for socket in some setups, but PublicHighscore usually works without if configured public
        // Assuming WS_URL handles it or we pass token if available. 
        // PublicHighscore.js used: io(WS_URL)
        // Highscore.js used: io(WS_URL, { auth: { token: getToken() } })
        // We'll try to be generic. If we are on public page, maybe we don't have a token.
        const token = localStorage.getItem('token');
        const socketOpts = token ? { auth: { token } } : {};

        const socket = io(WS_URL, socketOpts);

        socket.on('connect', () => setLive(true));
        socket.on('disconnect', () => setLive(false));

        socket.on('highscore_update', (data) => {
            if (data) {
                // Optimistic / Direct update from socket
                setBoards(prev => ({
                    daily: { amount: data.daily?.amount || prev.daily.amount, count: data.daily?.count || prev.daily.count },
                    yearly: { amount: data.yearly?.amount || prev.yearly.amount, count: data.yearly?.count || prev.yearly.count }
                }));

                // Also refresh goals to be sure (since sales trigger goals too)
                api.get(API_ENDPOINTS.HIGHSCORE_GOALS_PROGRESS)
                    .then(res => setGoalProgress(res.data))
                    .catch(() => { });
            }
        });

        const interval = setInterval(fetchAll, 60000); // Fallback polling
        return () => { clearInterval(interval); socket.disconnect(); };
    }, [fetchAll]);

    // 3. Rank Change Detection Logic
    const prevDaily = usePrevious(boards.daily.amount.entries);
    const prevYearly = usePrevious(boards.yearly.amount.entries);

    useEffect(() => {
        if (loading) return;

        const checkChanges = (prev, curr, context) => {
            if (!prev || !curr) return;
            const top3Prev = prev.slice(0, 3);
            const top3Curr = curr.slice(0, 3);

            // Check Rank 1
            if (top3Curr[0] && top3Curr[0].customerId !== top3Prev[0]?.customerId) {
                const name = top3Curr[0].customerNickname || top3Curr[0].customerName;
                setOverlay({
                    active: true,
                    type: `${context}_RANK_1`,
                    message: `${pickRandom(RANK_1_MESSAGES)} ${name} ist jetzt #1!`
                });
                return; // Priority
            }

            // Check Rank 2 & 3
            for (let i = 1; i <= 2; i++) {
                const p = top3Prev[i];
                const c = top3Curr[i];
                if (c && c.customerId !== p?.customerId) {
                    // Check if dropped from higher
                    const wasHigher = top3Prev.slice(0, i).find(x => x.customerId === c.customerId);
                    if (!wasHigher) {
                        const name = c.customerNickname || c.customerName;
                        setOverlay({
                            active: true,
                            type: `${context}_RANK`,
                            message: `${pickRandom(RANK_TOP3_MESSAGES)} ${name} ist auf Platz ${i + 1}!`
                        });
                        return; // Trigger one at a time
                    }
                }
            }
        };

        checkChanges(prevDaily, boards.daily.amount.entries, 'DAILY');
        checkChanges(prevYearly, boards.yearly.amount.entries, 'YEARLY');

    }, [boards, prevDaily, prevYearly, loading]);

    return {
        boards,
        goalProgress,
        loading,
        live,
        lastUpdated,
        startDate,
        overlay,
        setOverlay,
        refresh: fetchAll
    };
};
