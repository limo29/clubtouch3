const bcrypt = require('bcrypt'); 
const jwt = require('jsonwebtoken'); 
 
// Passwort hashen 
async function hashPassword(password) { 
  const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 10; 
  return await bcrypt.hash(password, rounds); 
} 
 
// Passwort vergleichen 
async function comparePassword(password, hash) { 
  return await bcrypt.compare(password, hash); 
} 
 
// JWT Token generieren 
function generateTokens(userId) { 
  const payload = { userId }; 
   
  const accessToken = jwt.sign( 
    payload,  
    process.env.JWT_SECRET, 
    { expiresIn: process.env.JWT_EXPIRE_TIME } 
  ); 
   
  const refreshToken = jwt.sign( 
    payload, 
    process.env.JWT_REFRESH_SECRET, 
    { expiresIn: process.env.JWT_REFRESH_EXPIRE_TIME } 
  ); 
   
  return { accessToken, refreshToken }; 
} 
 
// JWT Token verifizieren 
function verifyAccessToken(token) { 
  try { 
    return jwt.verify(token, process.env.JWT_SECRET); 
  } catch (error) { 
    throw new Error('Invalid access token'); 
  } 
} 
 
function verifyRefreshToken(token) { 
  try { 
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET); 
  } catch (error) { 
    throw new Error('Invalid refresh token'); 
  } 
} 
 
module.exports = { 
  hashPassword, 
  comparePassword, 
  generateTokens, 
  verifyAccessToken, 
  verifyRefreshToken 
};