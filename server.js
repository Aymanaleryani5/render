const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

app.all('/api/search', async (req, res) => {
  const query = req.method === 'GET' ? req.query.query : req.body.query;
  
  if (!query) {
    return res.status(200).json({ success: false, results: [], total: 0, error: 'البحث فارغ' });
  }

  try {
    // جلب البيانات من Vercel مباشرة دون عمل Redirect للتطبيق
    const vercelResponse = await fetch(`https://prox-alpha-one.vercel.app/api/search?query=${encodeURIComponent(query)}`);
    const data = await vercelResponse.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ success: false, results: [], total: 0, error: 'فشل الجلب من سيرفر المعالجة' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
