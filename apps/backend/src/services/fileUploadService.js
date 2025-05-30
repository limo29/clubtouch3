const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

class FileUploadService {
  constructor() {
    this.uploadDir = path.join(process.cwd(), 'uploads');
    this.ensureUploadDirs();
  }

  async ensureUploadDirs() {
    const dirs = [
      'uploads/invoices',
      'uploads/articles/original',
      'uploads/articles/thumbnail',
      'uploads/articles/small',
      'uploads/articles/medium',
      'uploads/articles/large'
    ];

    for (const dir of dirs) {
      await fs.mkdir(path.join(process.cwd(), dir), { recursive: true });
    }
  }

  // Multer config für Rechnungen
  invoiceUpload = multer({
    storage: multer.diskStorage({
      destination: async (req, file, cb) => {
        cb(null, path.join(this.uploadDir, 'invoices'));
      },
      filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
      }
    }),
    limits: {
      fileSize: 10 * 1024 * 1024 // 10MB
    },
    fileFilter: (req, file, cb) => {
      const allowedTypes = /jpeg|jpg|png|pdf/;
      const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
      const mimetype = allowedTypes.test(file.mimetype);

      if (mimetype && extname) {
        return cb(null, true);
      } else {
        cb(new Error('Nur JPEG, PNG und PDF Dateien sind erlaubt'));
      }
    }
  });

  // Multer config für Artikelbilder
  articleImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 5 * 1024 * 1024 // 5MB
    },
    fileFilter: (req, file, cb) => {
      const allowedTypes = /jpeg|jpg|png|webp/;
      const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
      const mimetype = allowedTypes.test(file.mimetype);

      if (mimetype && extname) {
        return cb(null, true);
      } else {
        cb(new Error('Nur JPEG, PNG und WebP Bilder sind erlaubt'));
      }
    }
  });

  // Artikelbilder verarbeiten
  async processArticleImage(file) {
    const filename = `${uuidv4()}.webp`;
    const sizes = [
      { name: 'thumbnail', width: 150, height: 150 },
      { name: 'small', width: 300, height: 300 },
      { name: 'medium', width: 600, height: 600 },
      { name: 'large', width: 1200, height: 1200 }
    ];

    const results = {};

    // Original speichern
    const originalPath = path.join(this.uploadDir, 'articles', 'original', filename);
    await sharp(file.buffer)
      .webp({ quality: 90 })
      .toFile(originalPath);
    results.original = `/uploads/articles/original/${filename}`;

    // Verschiedene Größen erstellen
    for (const size of sizes) {
      const outputPath = path.join(this.uploadDir, 'articles', size.name, filename);
      await sharp(file.buffer)
        .resize(size.width, size.height, {
          fit: 'cover',
          position: 'center'
        })
        .webp({ quality: 85 })
        .toFile(outputPath);
      
      results[size.name] = `/uploads/articles/${size.name}/${filename}`;
    }

    return results;
  }

  // Alte Bilder löschen
  async deleteArticleImages(imagePaths) {
    for (const imagePath of Object.values(imagePaths)) {
      if (imagePath) {
        try {
          const fullPath = path.join(process.cwd(), imagePath.substring(1));
          await fs.unlink(fullPath);
        } catch (error) {
          console.error('Error deleting image:', error);
        }
      }
    }
  }
}

module.exports = new FileUploadService();
