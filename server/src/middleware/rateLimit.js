import rateLimit from 'express-rate-limit';

const rateLimitedResponse = {
  success: false,
  error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
};

// Tight limit on auth endpoints to blunt credential stuffing / brute force
// (SECURITY_ARCHITECTURE.md §5). Skipped entirely in the test environment so
// the test suite isn't rate-limited by its own repeated requests.
export const authRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitedResponse,
  skip: () => process.env.NODE_ENV === 'test',
});

// Looser general-purpose limit for authenticated API traffic.
export const apiRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitedResponse,
  skip: () => process.env.NODE_ENV === 'test',
});
