const prisma = require('../utils/prisma');
const highscoreController = require('./highscoreController');

/**
 * Gemeinsamer PIN für die öffentliche Guthaben-Abfrage (hängt z.B. an der Theke aus), damit nicht
 * jeder im Internet per Name Kontostände abrufen kann. Fehlversuche werden je IP gebremst
 * (In-Memory wie die Login-Bremse in authController).
 */
const BALANCE_PIN = String(process.env.PUBLIC_BALANCE_PIN || '666');
const MAX_PIN_FAILS = 10;
const PIN_WINDOW_MS = 15 * 60 * 1000;
const pinFails = new Map();
function isPinThrottled(ip) {
    const entry = pinFails.get(ip);
    if (!entry) return false;
    if (Date.now() - entry.first > PIN_WINDOW_MS) { pinFails.delete(ip); return false; }
    return entry.count >= MAX_PIN_FAILS;
}
function notePinFailure(ip) {
    const now = Date.now();
    const entry = pinFails.get(ip);
    if (!entry || now - entry.first > PIN_WINDOW_MS) pinFails.set(ip, { first: now, count: 1 });
    else entry.count += 1;
    if (pinFails.size > 5000) pinFails.clear();
}

class PublicController {
    // Clubscore: dieselben Handler wie /api/highscore (dort mit Fehlerbehandlung)
    getHighscore(req, res) {
        return highscoreController.getHighscore(req, res);
    }

    getAllHighscores(req, res) {
        return highscoreController.getAllHighscores(req, res);
    }

    getGoalsProgress(req, res) {
        return highscoreController.getGoalsProgress(req, res);
    }

    getHighscoreDisplay(req, res) {
        return highscoreController.getDisplay(req, res);
    }

    // Frühere Jahreswertungen, nur Platz 1-3 (Public-Display)
    getArchive(req, res) {
        return highscoreController.getPublicArchive(req, res);
    }

    // Public Ads
    async getAds(req, res) {
        try {
            const ads = await prisma.adSlide.findMany({
                where: { active: true },
                orderBy: { order: 'asc' }
            });
            res.json(ads);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Fehler beim Laden der Werbung' });
        }
    }

    // Artikel für das Menü-Element der Werbe-Slides (öffentliches Display, kein Login).
    // Bewusst minimal: keine Bestände, keine EK-Daten, nur aktive Artikel.
    async getMenuArticles(req, res) {
        try {
            const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
            const articles = await prisma.article.findMany({
                where: {
                    active: true,
                    ...(category ? { category: { equals: category, mode: 'insensitive' } } : {})
                },
                orderBy: [{ order: 'asc' }, { name: 'asc' }],
                select: { id: true, name: true, price: true, category: true, unit: true }
            });
            res.json({ articles });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Fehler beim Laden der Artikel' });
        }
    }

    // Guthaben per Name + gemeinsamem PIN. Falscher PIN und unbekannter Name zählen als Fehlversuch.
    async checkBalance(req, res) {
        try {
            const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
            const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
            if (!name || !pin) {
                return res.status(400).json({ error: 'Name und PIN sind erforderlich' });
            }
            if (isPinThrottled(req.ip)) {
                return res.status(429).json({ error: 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.' });
            }
            // 403 statt 401: bei 401 versucht das Frontend einen Token-Refresh und leitet zum Login
            if (pin !== BALANCE_PIN) {
                notePinFailure(req.ip);
                return res.status(403).json({ error: 'PIN ist falsch' });
            }

            // Case-insensitive search
            const customer = await prisma.customer.findFirst({
                where: {
                    name: {
                        equals: name,
                        mode: 'insensitive'
                    }
                },
                select: {
                    id: true,
                    name: true,
                    balance: true,
                    transactions: {
                        take: 5,
                        orderBy: { createdAt: 'desc' },
                        include: {
                            items: {
                                include: { article: true }
                            }
                        }
                    },
                    accountTopUps: {
                        take: 5,
                        orderBy: { createdAt: 'desc' }
                    }
                }
            });

            if (!customer) {
                notePinFailure(req.ip);
                return res.status(404).json({ error: 'Kunde nicht gefunden' });
            }

            // Format history similar to customerService.getHistory but simplified
            const history = [
                ...customer.transactions.map(t => ({
                    type: 'PURCHASE',
                    date: t.createdAt,
                    amount: t.cancelled ? 0 : -Number(t.totalAmount),
                    items: t.items.map(i => `${i.quantity}x ${i.article.name}`).join(', '),
                    cancelled: t.cancelled
                })),
                ...customer.accountTopUps.map(t => ({
                    type: 'TOPUP',
                    date: t.createdAt,
                    amount: Number(t.amount),
                    method: t.method
                }))
            ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);

            res.json({
                name: customer.name,
                balance: customer.balance,
                history
            });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Fehler beim Abrufen des Kontostands' });
        }
    }
}

module.exports = new PublicController();
