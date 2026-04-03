import { createRoute, z } from '@hono/zod-openapi';

const proxySchema = createRoute({
  method: 'get',
  path: '/proxy',
  request: {
    query: z.object({
      url: z.url(),
      referer: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Proxy media or HLS manifests through the API server',
    },
  },
});

export default proxySchema;
