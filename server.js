const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

class MemoryCache {
  constructor() {
    this.cache = new NodeCache({ stdTTL: 172800, checkperiod: 172800 });
  }
  match(requestKey) { return this.cache.get(requestKey) || null; }
  put(requestKey, responseData) { this.cache.set(requestKey, responseData); }
}

const rateLimiter = rateLimit({
  windowMs: 3 * 1000,
  max: 1,
  message: JSON.stringify({
    success: false,
    results: [],
    total: 0,
    error: 'مهلاً! الرجاء الانتظار',
    message: '⏳ يرجى الانتظار 3 ثواني بين عمليات البحث'
  }),
  keyGenerator: (req) => {
    return req.headers['cf-connecting-ip'] ||
           req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.ip ||
           'anonymous';
  },
  handler: (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(429).send(rateLimiter.message);
  }
});

const cache = new MemoryCache();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

app.get('/ping', (req, res) => res.status(200).send('OK'));

app.all(['/api/search', '/api/search/'], rateLimiter, async (req, res) => {
  try {
    const query = req.method === 'GET' 
      ? req.query.query 
      : (req.body ? req.body.query : null);

    if (!query) {
      return res.status(200).json({ success: false, results: [], total: 0, error: 'البحث فارغ' });
    }

    const cacheKey = `phone_${query}`;
    const cachedData = cache.match(cacheKey);
    if (cachedData) {
      return res.status(200).set('X-Cache-Status', 'HIT').json(cachedData);
    }

    // استدعاء Vercel الذي ينظف البيانات ويُرجعها جاهزة
    const vercelUrl = `https://prox-alpha-one.vercel.app/api/search?query=${encodeURIComponent(query)}`;
    const vercelResponse = await fetch(vercelUrl, {
      method: 'GET',
      headers: { 'accept': 'application/json' }
    });

    if (!vercelResponse.ok) {
      return res.status(200).json({ 
        success: false, 
        results: [], 
        total: 0, 
        error: `خطأ من Vercel: ${vercelResponse.status}` 
      });
    }

    const data = await vercelResponse.json();

    if (data && data.success) {
      cache.put(cacheKey, data);
    }

    return res.status(200).json(data);

  } catch (e) {
    return res.status(500).json({ success: false, results: [], total: 0, error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
