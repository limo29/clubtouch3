const express = require('express'); 
const app = express(); 
 
app.get('/', (req, res) => { 
  res.send('Clubtouch3 Backend läuft!'); 
}); 
 
app.listen(3001, () => { 
  console.log('Backend gestartet auf Port 3001'); 
}); 
