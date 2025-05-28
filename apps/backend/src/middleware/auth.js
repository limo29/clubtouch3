const { verifyAccessToken } = require('../utils/auth'); 
const prisma = require('../utils/prisma'); 
 
// Middleware für geschützte Routes 
async function authenticate(req, res, next) { 
  try { 
    const authHeader = req.headers.authorization; 
     
    if (!authHeader || !authHeader.startsWith('Bearer ')) { 
      return res.status(401).json({ error: 'Kein Token vorhanden' }); 
    } 
     
    const token = authHeader.substring(7); 
    const decoded = verifyAccessToken(token); 
     
    // Prüfe ob User existiert und aktiv ist 
    const user = await prisma.user.findUnique({ 
      where: { id: decoded.userId }, 
      select: { 
        id: true, 
        email: true, 
        name: true, 
        role: true, 
        active: true 
      } 
    }); 
     
    if (!user || !user.active) { 
      return res.status(401).json({ error: 'Ungültiger Benutzer' }); 
    } 
     
    // User-Objekt an Request anhängen 
    req.user = user; 
    next(); 
  } catch (error) { 
    return res.status(401).json({ error: 'Ungültiger Token' }); 
  } 
} 
 
// Middleware für Rollen-basierte Zugriffskontrolle 
function authorize(...roles) { 
  return (req, res, next) => { 
    if (!req.user) { 
      return res.status(401).json({ error: 'Nicht authentifiziert' }); 
    } 
     
    if (!roles.includes(req.user.role)) { 
      return res.status(403).json({ error: 'Keine Berechtigung für diese Aktion' }); 
    } 
     
    next(); 
  }; 
} 
 
module.exports = { authenticate, authorize }; 
