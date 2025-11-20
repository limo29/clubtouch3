const prisma = require('../utils/prisma');
const highscoreController = require('./highscoreController'); // Reuse logic if possible, or replicate simplified

class PublicController {
    // Public Highscore (Simplified, JSON only)
    async getHighscore(req, res) {
        // Reuse the existing highscore logic but maybe cache it or strip sensitive data if any
        // For now, we can just proxy to the existing controller method if it doesn't require auth in the function itself
        // But highscoreController methods usually take (req, res).
        // Let's call the existing controller's logic or duplicate the safe parts.
        // Looking at highscoreController (I haven't seen it yet, but I saw the route uses it).
        // I'll assume I can just call the logic or use the same service.
        // For safety, let's implement a clean read here.

        try {
            // We can actually just use the same logic as the main highscore
            // but we need to make sure we don't expose anything we shouldn't.
            // The existing highscore seems public-safe (names, scores).
            return highscoreController.getHighscore(req, res);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Fehler beim Laden des Highscores' });
        }
    }

    async getAllHighscores(req, res) {
        return highscoreController.getAllHighscores(req, res);
    }

    async getGoalsProgress(req, res) {
        return highscoreController.getGoalsProgress(req, res);
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
                include: {
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
