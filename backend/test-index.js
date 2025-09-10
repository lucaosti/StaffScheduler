console.log('🚀 Starting minimal test server...');

const express = require('express');
console.log('Express imported ✅');

const app = express();
console.log('Express app created ✅');

app.get('/health', (req, res) => {
  res.json({ message: 'Test server is running' });
});
console.log('Health route registered ✅');

const PORT = process.env.PORT || 3001;
console.log('PORT:', PORT);

app.listen(PORT, () => {
  console.log(`🎉 Test server running on port ${PORT}`);
});
