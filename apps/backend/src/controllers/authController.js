const userService = require('../services/userService');
const { comparePassword, generateTokens, verifyRefreshToken } = require('../utils/auth');
const prisma = require('../utils/prisma');

class AuthController {
  // Login
  async login(req, res) {
    try {
      const { email, password, identifier } = req.body;
      const loginIdentifier = identifier || email;

      console.log('Login attempt for:', loginIdentifier); // Debug

      // Finde User
      const user = await userService.findByIdentifier(loginIdentifier);

      if (!user) {
        console.log('User not found'); // Debug
        return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
      }

      if (!user.active) {
        console.log('User is inactive'); // Debug
        return res.status(401).json({ error: 'Benutzer ist deaktiviert' });
      }

      // Prüfe Passwort
      const isValid = await comparePassword(password, user.password);

      if (!isValid) {
        console.log('Invalid password'); // Debug
        return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
      }


      // Generiere Tokens
      const { accessToken, refreshToken } = generateTokens(user.id);

      // Speichere Session
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 Tage

      await prisma.session.create({
        data: {
          userId: user.id,
          token: accessToken,
          refreshToken,
          expiresAt
        }
      });

      // Erstelle Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: 'LOGIN',
          entityType: 'User',
          entityId: user.id
        }
      });

      res.json({
        message: 'Erfolgreich angemeldet',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        },
        accessToken,
        refreshToken
      });
    } catch (error) {
      console.error('Login error details:', error); // Besseres Error-Logging
      res.status(500).json({
        error: 'Fehler bei der Anmeldung',
        details: error.message // Temporär für Debugging
      });
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
