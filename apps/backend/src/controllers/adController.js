const prisma = require('../utils/prisma');

class AdController {
    // List all ads (for admin)
    async listAds(req, res) {
        try {
            const ads = await prisma.adSlide.findMany({
                orderBy: { order: 'asc' }
            });
            res.json(ads);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Fehler beim Laden der Werbung' });
        }
    }

    // Create new ad
    async createAd(req, res) {
        try {
            const { imageUrl, duration, transition, active } = req.body;

            // Get max order to append
            const lastAd = await prisma.adSlide.findFirst({
                orderBy: { order: 'desc' }
            });
            const newOrder = (lastAd?.order || 0) + 1;

            const ad = await prisma.adSlide.create({
                data: {
                    imageUrl,
                    duration: Number(duration) || 10,
                    transition: transition || 'FADE',
                    order: newOrder,
                    active: active !== undefined ? active : true
                }
            });
            res.json(ad);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Fehler beim Erstellen der Werbung' });
        }
    }

    // Update ad
    async updateAd(req, res) {
        try {
            const { id } = req.params;
            const data = req.body;

            const ad = await prisma.adSlide.update({
                where: { id },
                data: {
                    imageUrl: data.imageUrl,
                    duration: data.duration ? Number(data.duration) : undefined,
                    transition: data.transition,
                    active: data.active,
                    order: data.order ? Number(data.order) : undefined
                }
            });
            res.json(ad);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Fehler beim Aktualisieren der Werbung' });
        }
    }

    // Delete ad
    async deleteAd(req, res) {
        try {
            const { id } = req.params;
            await prisma.adSlide.delete({ where: { id } });
            res.json({ success: true });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Fehler beim Löschen der Werbung' });
        }
    }

    // Reorder ads
    async reorderAds(req, res) {
        try {
            const { orderedIds } = req.body; // Array of IDs in new order

            const updates = orderedIds.map((id, index) =>
                prisma.adSlide.update({
                    where: { id },
                    data: { order: index }
                })
            );

            await prisma.$transaction(updates);
            res.json({ success: true });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Fehler beim Sortieren der Werbung' });
        }
    }
}

module.exports = new AdController();
