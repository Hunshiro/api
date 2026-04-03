import { NotFoundError } from '@/utils/errors';
import { fetchKaidoEpisodes } from '@/services/kaido';
import { fetchAnikaiEpisodes } from '@/services/anikai';
import { mapAnikaiToKaido } from '@/services/idMapper';

export default async function episodesHandler(c) {
  const { id } = c.req.valid('param');

  try {
    return await fetchEpisodesWithFallback(id);
  } catch (err) {
    console.error(`Episodes error for ${id}:`, err.message);
    throw new NotFoundError('episodes Not Found');
  }
}

/**
 * Fetch episodes with ID mapping and fallback
 */
async function fetchEpisodesWithFallback(id) {
  const kaidoId = await mapAnikaiToKaido(id);
  
  if (kaidoId) {
    try {
      console.log(`Fetching episodes from kaido.to for ${id} (mapped to ${kaidoId})`);
      return await fetchKaidoEpisodes(kaidoId);
    } catch (kaidoError) {
      console.log(`Kaido episodes lookup failed for ${id} (mapped to ${kaidoId}): ${kaidoError.message}`);
      console.log(`Trying anikai.to for ${id}...`);
      try {
        return await fetchAnikaiEpisodes(id);
      } catch (anikaiError) {
        console.error(`Anikai episodes lookup also failed for ${id}: ${anikaiError.message}`);
        throw anikaiError;
      }
    }
  }
  
  console.log(`No kaido mapping for ${id}, fetching from anikai.to`);
  return await fetchAnikaiEpisodes(id);
}
