const prisma = require('../utils/prisma');
const fs = require('fs');
const path = require('path');

const UPLOAD_PREFIX = '/uploads/ads/';
const ADS_DIR = path.join(process.cwd(), 'uploads', 'ads');

/** Dauer in Sekunden: 1..3600, sonst null (→ 400); undefined = nicht angegeben */
function parseDuration(raw) {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1 || n > 3600) return null;
    return Math.round(n);
}

const TRANSITIONS = ['FADE', 'SLIDE', 'ZOOM', 'NONE'];

/** Hochgeladene Datei löschen, wenn kein anderer Slide sie mehr referenziert (verwaiste Uploads vermeiden) */
async function removeUploadIfUnused(imageUrl, exceptId) {
    if (!imageUrl || !imageUrl.startsWith(UPLOAD_PREFIX)) return;
    const stillUsed = await prisma.adSlide.count({ where: { imageUrl, ...(exceptId ? { id: { not: exceptId } } : {}) } });
    if (stillUsed > 0) return;
    const file = path.join(ADS_DIR, path.basename(imageUrl));
    fs.promises.unlink(file).catch(() => { /* Datei fehlt bereits: egal */ });
}

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
            const { duration, transition, active } = req.body;
            let imageUrl = req.body.imageUrl;

            if (req.file) {
                // Construct URL for uploaded file
                // Assuming server serves 'uploads' directory at /uploads
                imageUrl = `/uploads/ads/${req.file.filename}`;
            }
            if (!imageUrl) {
                return res.status(400).json({ error: 'Bitte eine Datei hochladen oder eine URL angeben' });
            }
            const dur = parseDuration(duration);
            if (dur === null) return res.status(400).json({ error: 'Dauer muss zwischen 1 und 3600 Sekunden liegen' });
            if (transition && !TRANSITIONS.includes(transition)) return res.status(400).json({ error: 'Ungültiger Übergang' });

            // Get max order to append
            const lastAd = await prisma.adSlide.findFirst({
                orderBy: { order: 'desc' }
            });
            const newOrder = (lastAd?.order || 0) + 1;

            const ad = await prisma.adSlide.create({
                data: {
                    imageUrl,
                    duration: dur || 10,
                    transition: transition || 'FADE',
                    order: newOrder,
                    active: active !== undefined ? String(active) === 'true' : true,
                    slideData: req.body.slideData ? JSON.parse(req.body.slideData) : undefined
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

            let imageUrl = data.imageUrl;

            if (req.file) {
                imageUrl = `/uploads/ads/${req.file.filename}`;
            }

            const dur = parseDuration(data.duration);
            if (dur === null) return res.status(400).json({ error: 'Dauer muss zwischen 1 und 3600 Sekunden liegen' });
            if (data.transition && !TRANSITIONS.includes(data.transition)) return res.status(400).json({ error: 'Ungültiger Übergang' });

            const existing = await prisma.adSlide.findUnique({ where: { id } });
            if (!existing) return res.status(404).json({ error: 'Werbung nicht gefunden' });

            const updateData = {
                duration: dur,
                transition: data.transition,
                order: data.order ? Number(data.order) : undefined,
                slideData: data.slideData ? JSON.parse(data.slideData) : undefined
            };

            if (imageUrl !== undefined) {
                updateData.imageUrl = imageUrl;
            }

            if (data.active !== undefined) {
                updateData.active = String(data.active) === 'true';
            }

            const ad = await prisma.adSlide.update({
                where: { id },
                data: updateData
            });
            // Ersetzte Datei aufräumen
            if (updateData.imageUrl && updateData.imageUrl !== existing.imageUrl) {
                await removeUploadIfUnused(existing.imageUrl, id);
            }
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
            const existing = await prisma.adSlide.findUnique({ where: { id } });
            if (!existing) return res.status(404).json({ error: 'Werbung nicht gefunden' });
            await prisma.adSlide.delete({ where: { id } });
            await removeUploadIfUnused(existing.imageUrl);
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
            if (!Array.isArray(orderedIds) || orderedIds.some((x) => typeof x !== 'string')) {
                return res.status(400).json({ error: 'orderedIds muss eine Liste von IDs sein' });
            }

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
