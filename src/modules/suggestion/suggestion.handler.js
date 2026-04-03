import { validationError } from '@/utils/errors';
import suggestionExtract from './suggestion.extract';
import { upstreamFetch } from '@/services/upstreamFetch';

export default async function suggestionHandler(c) {
  const { keyword } = c.req.valid('query');

  const endpoint = `/ajax/search/suggest?keyword=${keyword}`;
  const { response: upstreamResponse } = await upstreamFetch(endpoint, {
    refererPath: '/home',
  });

  const data = await upstreamResponse.json();
  if (!data.status) throw new validationError('suggestion not found');

  const response = suggestionExtract(data.html);

  return response;
}
