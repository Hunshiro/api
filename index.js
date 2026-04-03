import app from '@/app.js';
import { serve } from 'bun';

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3030);

const bunApp = serve({
  hostname: host,
  port,
  fetch: app.fetch,
  idleTimeout: 20,
});

console.log(`Server running at ${bunApp.url}`);
console.log(`Docs available at ${bunApp.url}doc`);
console.log(`Swagger available at ${bunApp.url}swagger`);
