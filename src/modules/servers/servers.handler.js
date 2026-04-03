import { NotFoundError } from '@/utils/errors';
import { fetchKaidoServers } from '@/services/kaido';
import { fetchAnikaiServers } from '@/services/anikai';
import { mapAnikaiToKaido } from '@/services/idMapper';

export default async function (c) {
  const { id } = c.req.valid('param');

  const response = await getServers(id);

  return response;
}

export async function getServers(id) {
  try {
    return await fetchServersWithFallback(id);
  } catch (err) {
    console.log(err.message);
    throw new NotFoundError('servers not found');
  }
}

/**
 * Fetch servers with ID mapping and fallback
 */
async function fetchServersWithFallback(id) {
  const kaidoId = await mapAnikaiToKaido(id);
  
  if (kaidoId) {
    try {
      return await fetchKaidoServers(kaidoId);
    } catch (kaidoError) {
      console.log(`Kaido servers lookup failed for ${id} (mapped to ${kaidoId}), trying anikai.to...`);
      return await fetchAnikaiServers(id);
    }
  }
  
  return await fetchAnikaiServers(id);
}
