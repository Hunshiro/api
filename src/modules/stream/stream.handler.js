import { NotFoundError, validationError } from '@/utils/errors.js';
import { fetchKaidoStream, fetchKaidoServers } from '@/services/kaido';
import { fetchAnikaiStream, fetchAnikaiServers } from '@/services/anikai';
import { mapAnikaiToKaido } from '@/services/idMapper';

export default async function streamHandler(c) {
  let { id, server, type } = c.req.valid('query');

  try {
    await fetchStreamServers(id);
  } catch {
    throw new validationError('invalid or server not found', {
      server,
    });
  }

  const response = await fetchStream(id, server, type);
  // Return direct URL without proxy - let browser fetch it directly
  // This avoids cloud IP blocking issues
  if (!response) throw NotFoundError('Something Went Wrong While Fetching Stream');
  return response;
}

/**
 * Fetch stream servers with fallback
 */
async function fetchStreamServers(id) {
  const kaidoId = await mapAnikaiToKaido(id);
  
  if (kaidoId) {
    try {
      return await fetchKaidoServers(kaidoId);
    } catch {
      return await fetchAnikaiServers(id);
    }
  }
  
  return await fetchAnikaiServers(id);
}

/**
 * Fetch stream with fallback - returns direct URL (no proxy)
 */
async function fetchStream(id, server, type) {
  const kaidoId = await mapAnikaiToKaido(id);
  
  if (kaidoId) {
    try {
      const response = await fetchKaidoStream(kaidoId, server, type);
      if (response?.link?.file) return response;
    } catch {
      // Fall back to anikai.to
    }
  }
  
  return await fetchAnikaiStream(id, server, type);
}

function buildProxyUrl(requestUrl, targetUrl, referer) {
  const url = new URL('/api/v1/proxy', requestUrl);
  url.searchParams.set('url', targetUrl);
  url.searchParams.set('referer', referer);
  return `${url.pathname}${url.search}`;
}
