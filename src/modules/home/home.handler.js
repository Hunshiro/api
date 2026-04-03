import { validationError } from '@/utils/errors';
import { fetchKaidoMainPage } from '@/services/kaido';
import { fetchAnikaiHomePage } from '@/services/anikai';

import connectRedis from '@/utils/connectRedis';

export default async function homeHandler() {
  const { exist, redis } = await connectRedis();

  if (!exist) {
    try {
      // Fetch trending and spotlight from anikai.to
      const anikaiData = await fetchAnikaiHomePage();
      // Fetch other categories from kaido.to
      const kaidoData = await fetchKaidoMainPage();

      // Merge: use anikai.to for spotlight/trending, kaido.to for everything else
      return {
        spotlight: anikaiData.spotlight || [],
        trending: anikaiData.trending || [],
        topAiring: kaidoData.topAiring || [],
        mostPopular: kaidoData.mostPopular || [],
        mostFavorite: kaidoData.mostFavorite || [],
        latestCompleted: kaidoData.latestCompleted || [],
        latestEpisode: kaidoData.latestEpisode || [],
        newAdded: kaidoData.newAdded || [],
        topUpcoming: kaidoData.topUpcoming || [],
        topTen: anikaiData.topTen || kaidoData.topTen || { today: [], week: [], month: [] },
        genres: kaidoData.genres || anikaiData.genres || [],
      };
    } catch (error) {
      throw new validationError(error.message);
    }
  }

  const homePageData = await redis.get('home');
  if (homePageData) {
    return homePageData;
  }

  try {
    // Fetch trending and spotlight from anikai.to
    const anikaiData = await fetchAnikaiHomePage();
    // Fetch other categories from kaido.to
    const kaidoData = await fetchKaidoMainPage();

    const mergedData = {
      spotlight: anikaiData.spotlight || [],
      trending: anikaiData.trending || [],
      topAiring: kaidoData.topAiring || [],
      mostPopular: kaidoData.mostPopular || [],
      mostFavorite: kaidoData.mostFavorite || [],
      latestCompleted: kaidoData.latestCompleted || [],
      latestEpisode: kaidoData.latestEpisode || [],
      newAdded: kaidoData.newAdded || [],
      topUpcoming: kaidoData.topUpcoming || [],
      topTen: anikaiData.topTen || kaidoData.topTen || { today: [], week: [], month: [] },
      genres: kaidoData.genres || anikaiData.genres || [],
    };

    await redis.set('home', JSON.stringify(mergedData), {
      ex: 60 * 60 * 24,
    });
    return mergedData;
  } catch (error) {
    throw new validationError(error.message);
  }
}
