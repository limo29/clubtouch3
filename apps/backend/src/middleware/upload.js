const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directory exists
const { UPLOADS_DIR } = require('../utils/uploadsDir');
const uploadDir = path.join(UPLOADS_DIR, 'ads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

// Die Datei wird unter /uploads/ads/ mit ihrer Endung ausgeliefert. Der MIME-Typ kommt vom Client,
// deshalb zusätzlich die Endung prüfen (sonst ginge z.B. eine .html- oder .svg-Datei mit Skript durch).
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.ogg', '.mov', '.m4v'];

const fileFilter = (req, file, cb) => {
    const extOk = ALLOWED_EXT.includes(path.extname(file.originalname || '').toLowerCase());
    if (extOk && (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/'))) {
        cb(null, true);
    } else {
        cb(new Error('Nur Bilder und Videos sind erlaubt!'), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 500 * 1024 * 1024, // 500MB limit
        fieldSize: 100 * 1024 * 1024 // 100MB limit for text fields (slideData JSON)
    }
});

module.exports = upload;
