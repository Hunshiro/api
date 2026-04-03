import connectRedis from '@/utils/connectRedis';
import { validationError } from '@/utils/errors';
import { fetchKaidoAnimeInfo } from '@/services/kaido';
import { fetchAnikaiAnimeInfo } from '@/services/anikai';
import { mapAnikaiToKaido } from '@/services/idMapper';

export default async function animeInfo(c) {
  const { id } = c.req.valid('param');
  const cacheKey = `anime:${id}:v3`;

  const { exist, redis } = await connectRedis();
  if (!exist) {
    try {
      return await fetchAnimeInfoWithFallback(id);
    } catch (error) {
      throw new validationError(error.message, 'maybe id is incorrect : ' + id);
    }
  } else {
    const detail = await redis.get(cacheKey);
    if (detail) {
      return detail;
    }

    try {
      const response = await fetchAnimeInfoWithFallback(id);

      await redis.set(cacheKey, JSON.stringify(response), {
        ex: 60 * 60 * 24,
      });
      return response;
    } catch (error) {
      throw new validationError(error.message, 'maybe id is incorrect : ' + id);
    }
  }
}

/**
 * Fetch anime info with ID mapping fallback
 */
async function fetchAnimeInfoWithFallback(id) {
  // First try to map anikai.to ID to kaido.to ID
  const kaidoId = await mapAnikaiToKaido(id);
  
  if (kaidoId) {
    try {
      return await fetchKaidoAnimeInfo(kaidoId);
    } catch (kaidoError) {
      console.log(`Kaido lookup failed for ${id} (mapped to ${kaidoId}), trying anikai.to...`);
      // If kaido.to fails, fall back to anikai.to
      return await fetchAnikaiAnimeInfo(id);
    }
  }
  
  // No mapping found, try anikai.to directly
  return await fetchAnikaiAnimeInfo(id);
}
