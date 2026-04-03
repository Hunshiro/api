import { validationError } from '@/utils/errors';

const HLS_CONTENT_TYPES = [
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
];

export default async function proxyHandler(c) {
  const { url, referer } = c.req.valid('query');

  let upstreamUrl;
  try {
    upstreamUrl = new URL(url);
  } catch {
    throw new validationError('invalid proxy url');
  }

  const response = await fetch(upstreamUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': referer ? new URL(referer).origin : undefined,
      ...(referer ? { Referer: referer } : {}),
    },
  });

  if (!response.ok) {
    throw new validationError(`proxy upstream failed with HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const isManifest =
    HLS_CONTENT_TYPES.some((type) => contentType.includes(type)) || upstreamUrl.pathname.endsWith('.m3u8');

  if (isManifest) {
    const text = await response.text();
    const rewritten = rewriteManifest(text, upstreamUrl, referer);

    return new Response(rewritten, {
      headers: {
        'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  const headers = new Headers();
  if (contentType) headers.set('content-type', contentType);
  headers.set('cache-control', 'no-store');

  return new Response(response.body, {
    headers,
  });
}

function rewriteManifest(manifest, baseUrl, referer) {
  return manifest
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        if (trimmed.startsWith('#EXT-X-KEY:')) {
          return line.replace(/URI="([^"]+)"/, (_, uri) => {
            const resolved = new URL(uri, baseUrl).toString();
            return `URI="${buildProxyUrl(resolved, referer)}"`;
          });
        }

        return line;
      }

      const resolved = new URL(trimmed, baseUrl).toString();
      return buildProxyUrl(resolved, referer);
    })
    .join('\n');
}

function buildProxyUrl(url, referer) {
  const params = new URLSearchParams({ url });
  if (referer) params.set('referer', referer);
  return `/api/v1/proxy?${params.toString()}`;
}
