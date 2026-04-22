function extractToken(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  return (req.headers['x-api-key'] || '').toString().trim();
}

function auth(req, res, next) {
  const expected = (process.env.INTERNAL_API_KEY || '').trim();

  // For local development, auth is optional when no key is configured.
  if (!expected) {
    return next();
  }

  const provided = extractToken(req);
  if (!provided || provided !== expected) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' });
  }

  return next();
}

module.exports = auth;
