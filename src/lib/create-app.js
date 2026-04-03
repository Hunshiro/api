import { OpenAPIHono } from '@hono/zod-openapi';
import { rateLimiter } from 'hono-rate-limiter';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { fail } from '../utils/response';
import { AppError } from '../utils/errors';
import zodValidationHook from '@/middlewares/hook';

const frontendFiles = {
  html: Bun.file(new URL('../frontend/index.html', import.meta.url)),
  css: Bun.file(new URL('../frontend/styles.css', import.meta.url)),
  js: Bun.file(new URL('../frontend/app.js', import.meta.url)),
};

export function createRouter() {
  return new OpenAPIHono({
    defaultHook: zodValidationHook,
    strict: false,
  });
}

export default function createApp() {
  const allowedOrigins = parseOrigins(process.env.ORIGIN);

  const corsConf = cors({
    origin: (origin) => {
      if (!origin || allowedOrigins.includes('*')) {
        return origin || '*';
      }

      return allowedOrigins.includes(normalizeOrigin(origin)) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: '*',
  });

  const rateLimiterConf = rateLimiter({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60 * 1000),
    limit: Number(process.env.RATE_LIMIT_LIMIT || 20),
    standardHeaders: 'draft-6',
    message: {
      success: false,
      message: 'Too many requests, please try again in a moment.',
      details: null,
    },
    keyGenerator: (c) => {
      const forwarded = (c.req.header('x-forwarded-for') || '').split(',')[0].trim();
      const realIp = c.req.header('x-real-ip') || '';
      const userAgent = c.req.header('user-agent') || 'unknown-client';

      return forwarded || realIp || `local:${userAgent}`;
    },
  });

  const app = createRouter()
    .use(corsConf)
    .use('/api/v1/*', rateLimiterConf)
    .use('/api/v1/*', logger())
    .get('/', async (c) => c.html(await frontendFiles.html.text()))
    .get('/assets/styles.css', () => {
      return new Response(frontendFiles.css, {
        headers: {
          'content-type': 'text/css; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    })
    .get('/assets/app.js', () => {
      return new Response(frontendFiles.js, {
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    })
    .get('/ping', (c) => c.text('pong'))
    .notFound((c) => fail(c, 'page not found', 404))
    .onError((err, c) => {
      if (err instanceof AppError) {
        return fail(c, err.message, err.statusCode, err.details);
      }

      console.error('Unexpected Error:', err.message);
      return fail(c);
    });

  return app;
}

function parseOrigins(rawOrigins) {
  const values = String(rawOrigins || '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return values.length ? values.map(normalizeOrigin) : ['*'];
}

function normalizeOrigin(origin) {
  if (origin === '*') {
    return origin;
  }

  return origin.replace(/\/+$/, '');
}
