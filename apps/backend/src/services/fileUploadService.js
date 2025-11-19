// apps/backend/src/services/fileUploadService.js
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

class FileUploadService {
  constructor() {
    this.uploadDir = path.join(process.cwd(), 'uploads');
    this.baseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''); // ohne trailing /
    this.ensureUploadDirs();
  }

  async ensureUploadDirs() {
    const dirs = [
      // Belege
      path.join(this.uploadDir, 'nachweise'),
      // Artikel
      path.join(this.uploadDir, 'articles', 'original'),
      path.join(this.uploadDir, 'articles', 'thumbnail'),
      path.join(this.uploadDir, 'articles', 'small'),
      path.join(this.uploadDir, 'articles', 'medium'),
      path.join(this.uploadDir, 'articles', 'large'),
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  // Hilfsfunktionen
  _relUrl(...segments) {
    // ergibt z.B. "/uploads/articles/thumbnail/abc.webp"
    return '/' + path.join('uploads', ...segments).replace(/\\/g, '/');
  }
  _absUrl(...segments) {
    // ergibt z.B. "http://localhost:3001/uploads/articles/thumbnail/abc.webp"
    const rel = this._relUrl(...segments);
    // Fix: Wenn baseUrl intern ist (z.B. "http://backend:8080"), lieber relative URL zurückgeben
    if (this.baseUrl && (this.baseUrl.includes('backend') || this.baseUrl.includes('localhost'))) {
      return rel;
    }
    return this.baseUrl ? `${this.baseUrl}${rel}` : rel;
  }
  _fromAnyUrlToFsPath(anyUrlOrPath) {
    // akzeptiert:
    //  - "http://host/uploads/.."
    //  - "/uploads/.."
    //  - "uploads/.." (zur Sicherheit)
    try {
      let pathname = anyUrlOrPath;
      if (/^https?:\/\//i.test(anyUrlOrPath)) {
        const u = new URL(anyUrlOrPath);
        pathname = u.pathname; // "/uploads/.."
      }
      // führende "/" entfernen, damit path.join(process.cwd(), ...) korrekt ist
      const rel = pathname.replace(/^\/+/, '');
      return path.join(process.cwd(), rel);
    } catch {
      // Fallback: als relative Angabe behandeln
      const rel = String(anyUrlOrPath || '').replace(/^\/+/, '');
      return path.join(process.cwd(), rel);
    }
  }

  // -------- Nachweise (PDF/IMG auf Disk) --------
  nachweisUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, path.join(this.uploadDir, 'nachweise')),
      filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
    }),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
      const allowed = /jpeg|jpg|png|pdf/;
      const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
      const mimeOk = allowed.test(file.mimetype);
      return (extOk && mimeOk) ? cb(null, true) : cb(new Error('Nur JPEG, PNG und PDF Dateien sind erlaubt'));
    },
  });

  // -------- Artikelbilder (im Speicher, dann sharp -> Disk) --------
  articleImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
      const allowed = /jpeg|jpg|png|webp/;
      const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
      const mimeOk = allowed.test(file.mimetype);
      return (extOk && mimeOk) ? cb(null, true) : cb(new Error('Nur JPEG, PNG und WebP Bilder sind erlaubt'));
    },
  });

  // Artikelbilder verarbeiten (original + 4 Größen) -> absolute URLs zurückgeben
  async processArticleImage(file) {
    const filename = `${uuidv4()}.webp`;
    const sizes = [
      { name: 'thumbnail', width: 150, height: 150 },
      { name: 'small', width: 300, height: 300 },
      { name: 'medium', width: 600, height: 600 },
      { name: 'large', width: 1200, height: 1200 },
    ];

    // Original speichern (nicht skaliert, aber in WebP)
    const originalPath = path.join(this.uploadDir, 'articles', 'original', filename);
    await sharp(file.buffer).webp({ quality: 90 }).toFile(originalPath);

    const results = {
      original: this._absUrl('articles', 'original', filename),
    };

    // Thumbs erzeugen
    for (const size of sizes) {
      const outPath = path.join(this.uploadDir, 'articles', size.name, filename);
      await sharp(file.buffer)
        .resize(size.width, size.height, { fit: 'cover', position: 'center' })
        .webp({ quality: 85 })
        .toFile(outPath);

      results[size.name] = this._absUrl('articles', size.name, filename);
    }

    return results;
  }

  // Alte Bilder löschen (nimmt sowohl absolute als auch relative URLs)
  async deleteArticleImages(imagePaths) {
    for (const imagePath of Object.values(imagePaths || {})) {
      if (!imagePath) continue;
      try {
        const fsPath = this._fromAnyUrlToFsPath(imagePath);
        await fs.unlink(fsPath);
      } catch (err) {
        // stillschweigend ignorieren, wenn Datei nicht existiert
        if (err && err.code !== 'ENOENT') {
          console.error('Error deleting image:', imagePath, err.message);
        }
      }
    }
  }
}

module.exports = new FileUploadService();
