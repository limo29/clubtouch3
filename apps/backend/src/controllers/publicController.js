const prisma = require('../utils/prisma');
const highscoreController = require('./highscoreController');

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

    // Check Balance by Name
    async checkBalance(req, res) {
        try {
            const { name } = req.query;
            if (!name) {
                return res.status(400).json({ error: 'Name ist erforderlich' });
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
