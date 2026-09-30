const userService = require('../services/userService');
const { comparePassword, generateTokens, verifyRefreshToken } = require('../utils/auth');
const prisma = require('../utils/prisma');

/**
 * Einfache Bremse gegen Passwort-Raten: je Kennung+IP höchstens MAX_FAILED Fehlversuche
 * in WINDOW_MS, danach 429. In-Memory, reicht für eine Instanz; wird bei Erfolg zurückgesetzt.
 */
const MAX_FAILED = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failedLogins = new Map();
function loginKey(req, identifier) {
  return `${String(identifier || '').trim().toLowerCase()}|${req.ip}`;
}
function isThrottled(key) {
  const entry = failedLogins.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) { failedLogins.delete(key); return false; }
  return entry.count >= MAX_FAILED;
}
function noteFailure(key) {
  const now = Date.now();
  const entry = failedLogins.get(key);
  if (!entry || now - entry.first > WINDOW_MS) failedLogins.set(key, { first: now, count: 1 });
  else entry.count += 1;
  if (failedLogins.size > 5000) failedLogins.clear();
}

class AuthController {
  // Login
  async login(req, res) {
    try {
      const { email, password, identifier } = req.body;
      const loginIdentifier = String(identifier || email || '').trim();
      const key = loginKey(req, loginIdentifier);

      if (isThrottled(key)) {
        return res.status(429).json({ error: 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.' });
      }

      // Finde User (E-Mail oder Benutzername, Groß-/Kleinschreibung egal)
      const user = await userService.findByIdentifier(loginIdentifier);

      if (!user) {
        noteFailure(key);
        return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
      }

      if (!user.active) {
        return res.status(401).json({ error: 'Benutzer ist deaktiviert' });
      }

      // Prüfe Passwort
      const isValid = await comparePassword(password, user.password);

      if (!isValid) {
        noteFailure(key);
        return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
      }
      failedLogins.delete(key);

      // Generiere Tokens
      const { accessToken, refreshToken } = generateTokens(user.id);

      // Session speichern, abgelaufene Sessions dieses Benutzers aufräumen
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 Tage

      await prisma.$transaction([
        prisma.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } }),
        prisma.session.create({ data: { userId: user.id, token: accessToken, refreshToken, expiresAt } }),
        prisma.auditLog.create({ data: { userId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id } })
      ]);

      res.json({
        message: 'Erfolgreich angemeldet',
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          name: user.name,
          role: user.role
        },
        accessToken,
        refreshToken
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Fehler bei der Anmeldung' });
    }
  }

  // Eigenes Passwort ändern (altes Passwort erforderlich)
  async changePassword(req, res) {
    try {
      const { currentPassword, newPassword } = req.body;
      const keepToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const result = await userService.changeOwnPassword(req.user.id, { currentPassword, newPassword, keepToken });

      await prisma.auditLog.create({
        data: { userId: req.user.id, action: 'CHANGE_PASSWORD', entityType: 'User', entityId: req.user.id }
      });

      res.json({ message: 'Passwort geändert', closedSessions: result.closedSessions });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      console.error('Change password error:', error);
      res.status(500).json({ error: 'Passwort konnte nicht geändert werden' });
    }
  }

  // Logout
  async logout(req, res) {
    try {
      const authHeader = req.headers.authorization;

      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);

        // Lösche Session
        await prisma.session.deleteMany({
          where: { token }
        });

        // Audit-Log
        if (req.user) {
          await prisma.auditLog.create({
            data: {
              userId: req.user.id,
              action: 'LOGOUT',
              entityType: 'User',
              entityId: req.user.id
            }
          });
        }
      }

      res.json({ message: 'Erfolgreich abgemeldet' });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ error: 'Fehler beim Abmelden' });
    }
  }

  // Refresh Token
  async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(401).json({ error: 'Refresh Token fehlt' });
      }

      // Verifiziere Refresh Token
      const decoded = verifyRefreshToken(refreshToken);

      // Prüfe ob Session existiert
      const session = await prisma.session.findFirst({
        where: {
          refreshToken,
          userId: decoded.userId
        }
      });

      if (!session) {
        return res.status(401).json({ error: 'Ungültige Session' });
      }

      // Prüfe ob User noch aktiv
      const user = await userService.findById(decoded.userId);

      if (!user || !user.active) {
        return res.status(401).json({ error: 'Benutzer inaktiv' });
      }

      // Generiere neue Tokens
      const tokens = generateTokens(user.id);

      // Update Session
      await prisma.session.update({
        where: { id: session.id },
        data: {
          token: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        }
      });

      res.json({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken
      });
    } catch (error) {
      console.error('Refresh token error:', error);
      res.status(401).json({ error: 'Token-Erneuerung fehlgeschlagen' });
    }
  }

  // Aktueller User
  async me(req, res) {
    res.json({
      user: req.user
    });
  }
}

module.exports = new AuthController();
