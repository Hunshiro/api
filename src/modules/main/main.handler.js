import { fetchKaidoMainPage } from '@/services/kaido';
import { validationError } from '@/utils/errors';

export default async function mainHandler() {
  try {
    return await fetchKaidoMainPage();
  } catch (error) {
    throw new validationError(error.message);
  }
}
