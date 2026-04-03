import { NotFoundError } from '@/utils/errors';
import charactersExtract from './characters.extract';
import { upstreamFetch } from '@/services/upstreamFetch';

export default async function charactersHandler(c) {
  const { id } = c.req.valid('param');
  const { page } = c.req.valid('query');

  const idNum = id.split('-').pop();
  const endpoint = `/ajax/character/list/${idNum}?page=${page}`;
  try {
    const { response: upstreamResponse } = await upstreamFetch(endpoint, {
      refererPath: '/home',
    });

    const data = await upstreamResponse.json();
    const response = charactersExtract(data.html);

    return response;
  } catch {
    throw new NotFoundError('characters not found');
  }
}
