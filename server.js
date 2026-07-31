const rateLimiter = rateLimit({
  windowMs: 3 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(429).json({
      success: false,
      results: [],
      total: 0,
      error: 'مهلاً! الرجاء الانتظار',
      message: '⏳ يرجى الانتظار 3 ثواني بين عمليات البحث'
    });
  }
});
