import config from '@/config/config';

export async function upstreamFetch(
  endpoint,
  { headers = {}, refererPath, refererUrl, ...options } = {}
) {
  let lastError = null;

  for (const baseurl of config.baseurls) {
    try {
      const resolvedHeaders = {
        ...config.headers,
        ...headers,
      };

      if (refererUrl) {
        resolvedHeaders.Referer = refererUrl(baseurl);
      } else if (refererPath) {
        resolvedHeaders.Referer = `${baseurl}${refererPath}`;
      }

      const response = await fetch(baseurl + endpoint, {
        ...options,
        headers: resolvedHeaders,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return { response, baseurl };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Unable to connect to upstream source');
}
