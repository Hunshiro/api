import { load } from 'cheerio';

const DEFAULT_KAIDO_BASE_URL = process.env.KAIDO_BASE_URL?.trim() || 'https://kaido.to';
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  Referer: `${DEFAULT_KAIDO_BASE_URL}/`,
};

// Timeout wrapper for fetch
const FETCH_TIMEOUT = 15000; // 15 seconds

async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(id);
  }
}

export async function fetchKaidoMainPage() {
  const response = await fetchWithTimeout(`${DEFAULT_KAIDO_BASE_URL}/home`, {
    headers: FETCH_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Kaido home request failed with HTTP ${response.status}`);
  }

  const html = await response.text();
  const $ = load(html);

  const spotlight = extractSpotlight($);
  const trending = extractTrending($);
  const featuredSections = extractFeaturedSections($);
  const recentlyUpdated = firstNonEmpty(
    extractAnimeCards($, '.alist-group .tab-body[data-id="all-updates"] .aitem'),
    extractSectionByHeading($, ['Recently Updated']),
    extractAnimeCards($, '.block_area.block_area_home .tab-content .film_list-wrap .flw-item')
  );

  const latestEpisode = recentlyUpdated;
  const newEpisode = recentlyUpdated;
  const newAiring = firstNonEmpty(
    extractSectionByHeading($, ['New Airing', 'Top Airing']),
    findFeaturedSection(featuredSections, /top\s*airing|new\s*airing/i)
  );
  const upcoming = firstNonEmpty(
    extractSectionByHeading($, ['Upcoming', 'Top Upcoming']),
    findFeaturedSection(featuredSections, /upcoming/i)
  );
  const mostPopular = firstNonEmpty(
    extractSectionByHeading($, ['Most Popular']),
    findFeaturedSection(featuredSections, /most\s*popular/i)
  );
  const mostFavorite = firstNonEmpty(
    extractSectionByHeading($, ['Most Favorite']),
    findFeaturedSection(featuredSections, /most\s*favorite/i)
  );
  const latestCompleted = firstNonEmpty(
    extractSectionByHeading($, ['Latest Completed', 'Recently Completed', 'Completed Anime']),
    findFeaturedSection(featuredSections, /latest\s*completed|recently\s*completed|completed/i)
  );
  const newAdded = firstNonEmpty(
    extractSectionByHeading($, ['New On Kaido', 'New Added', 'New On HiAnime', 'Recently Added']),
    findFeaturedSection(featuredSections, /new\s*(on\s*)?(kaido|hianime)|new\s*added|recently\s*added/i)
  );
  const topTen = extractTopTen($);
  const genres = extractGenres($);

  return {
    source: DEFAULT_KAIDO_BASE_URL,
    spotlight,
    trending,
    topAiring: newAiring,
    mostPopular,
    mostFavorite,
    latestCompleted,
    latestEpisode,
    newAdded,
    topUpcoming: upcoming,
    topTen,
    genres,
  };
}

export async function fetchKaidoAnimeInfo(id) {
  const response = await fetchWithTimeout(`${DEFAULT_KAIDO_BASE_URL}/watch/${id}`, {
    headers: FETCH_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Kaido anime info request failed with HTTP ${response.status}`);
  }

  const html = await response.text();
  const $ = load(html);

  const mainEntity = $('.ani_watch-poster, .poster-wrap, .film-poster').first();
  const detailElements = $('.ani_detail-info, .film-infor, .detail');

  // Parse episodes info
  const episodes = {
    sub: toNumber($('.tick-sub, .tick-item.tick-sub').text()),
    dub: toNumber($('.tick-dub, .tick-item.tick-dub').text()),
    eps: toNumber($('.tick-eps, .tick-item.tick-eps').text()),
  };
  episodes.eps = episodes.eps || episodes.sub || episodes.dub;

  // Parse detail map
  const details = parseDetailMap($, detailElements);

  // Get related anime
  const related = extractRelatedAnime($);
  const recommended = extractRecommendedAnime($);
  const moreSeasons = extractMoreSeasons($);

  return {
    title: $('.ani_watch-detail .film-name, .film-name, h1.film-name').first().text().trim() ||
           $('.film-title, h2.film-title').first().text().trim() || null,
    alternativeTitle: $('.ani_watch-detail .film-name, .film-name').first().attr('data-jname') ||
                      $('.ani_watch-detail .film-name, .film-name').first().attr('title') || null,
    id,
    poster: mainEntity.find('img').first().attr('data-src') ||
            mainEntity.find('img').first().attr('src') ||
            extractBackground(mainEntity.attr('style')) || null,
    episodes,
    rating: $('.film-rating, .ani_rate').first().text().trim() || null,
    type: details.type || null,
    is18Plus: false,
    synopsis: $('.ani_watch-detail .description, .film-description, .description, .desc').first().text().trim() || null,
    synonyms: $('.film-name').first().attr('title') || null,
    aired: details.aired || null,
    premiered: details.premiered || null,
    duration: details.duration || null,
    status: details.status || null,
    MAL_score: details.mal || null,
    genres: details.genres || [],
    studios: details.studios || [],
    producers: details.producers || [],
    moreSeasons,
    related,
    mostPopular: [],
    recommended,
    kaidoAnimeId: id,
  };
}

function parseDetailMap($, elements) {
  const details = {
    type: null,
    aired: null,
    premiered: null,
    duration: null,
    status: null,
    mal: null,
    genres: [],
    studios: [],
    producers: [],
  };

  elements.find('.film-infor-item, .detail-item, .meta').each((_, el) => {
    const label = $(el).find('.item-label, .label, dt').first().text().trim().replace(':', '');
    const value = $(el).find('.item-value, .value, dd').first().text().trim();

    switch (label.toLowerCase()) {
      case 'type':
        details.type = value;
        break;
      case 'aired':
      case 'date aired':
        details.aired = value;
        break;
      case 'premiered':
        details.premiered = value;
        break;
      case 'duration':
        details.duration = value;
        break;
      case 'status':
        details.status = value;
        break;
      case 'mal score':
      case 'mal':
        details.mal = value;
        break;
      case 'genres':
        details.genres = $(el).find('a').map((_, link) => $(link).text().trim()).get();
        break;
      case 'studios':
      case 'studio':
        details.studios = $(el).find('a').map((_, link) => $(link).text().trim()).get();
        break;
      case 'producers':
      case 'producer':
        details.producers = $(el).find('a').map((_, link) => $(link).text().trim()).get();
        break;
      default:
        break;
    }
  });

  // Also try to extract from common patterns
  if (!details.genres.length) {
    details.genres = $('.film-infor a[href*="/genre/"], .genres a')
      .map((_, el) => $(el).text().trim())
      .get();
  }

  if (!details.studios.length) {
    details.studios = $('.film-infor a[href*="/producer/"], .studios a')
      .map((_, el) => $(el).text().trim())
      .get();
  }

  return details;
}

function extractRelatedAnime($) {
  return $('#related-anime .tab-body .aitem, .related-anime .film_list-wrap .flw-item')
    .map((_, el) => {
      const item = $(el);
      const titleEl = item.find('.title, .film-name a').first();
      return {
        title: titleEl.text().trim() || titleEl.attr('title') || null,
        alternativeTitle: titleEl.attr('data-jp') || titleEl.attr('data-jname') || null,
        id: toId(item.find('a[href*="/watch/"]').first().attr('href') || titleEl.attr('href')),
        poster: item.find('img').first().attr('data-src') ||
                item.find('img').first().attr('src') ||
                extractBackground(item.attr('style')) || null,
        episodes: readEpisodes(item),
        type: readType(item),
      };
    })
    .get()
    .filter(Boolean);
}

function extractRecommendedAnime($) {
  return $('#recommended-anime .tab-body .aitem, .recommended-anime .film_list-wrap .flw-item')
    .map((_, el) => {
      const item = $(el);
      const titleEl = item.find('.title, .film-name a').first();
      return {
        title: titleEl.text().trim() || titleEl.attr('title') || null,
        alternativeTitle: titleEl.attr('data-jp') || titleEl.attr('data-jname') || null,
        id: toId(item.find('a[href*="/watch/"]').first().attr('href') || titleEl.attr('href')),
        poster: item.find('img').first().attr('data-src') ||
                item.find('img').first().attr('src') ||
                extractBackground(item.attr('style')) || null,
        episodes: readEpisodes(item),
        type: readType(item),
      };
    })
    .get()
    .filter(Boolean);
}

function extractMoreSeasons($) {
  return $('.block_area-seasons .os-list .os-item, .seasons-wrap .os-list .os-item')
    .map((_, el) => {
      const season = $(el);
      const title = season.attr('title') || season.find('.title').text().trim() || null;
      const href = season.attr('href') || season.find('a').attr('href') || '';
      const posterFromImage = season.find('img').first().attr('data-src') ||
                              season.find('img').first().attr('src') || null;
      const posterFromStyle = extractBackground(season.find('.season-poster').attr('style')) ||
                              extractBackground(season.attr('style'));

      return {
        title,
        alternativeTitle: season.find('.title').text().trim() || title,
        id: href ? href.split('/').at(-1) : null,
        poster: posterFromImage || posterFromStyle || null,
        isActive: season.hasClass('active'),
      };
    })
    .get()
    .filter((item) => item.id || item.title);
}

function extractSpotlight($) {
  const modernCards = $('#featured .swiper-slide')
    .map((index, el) => {
      const href = $(el).find('.watch-btn').attr('href');
      const title = $(el).find('.title').first();

      return cleanupItem({
        title: title.text().trim(),
        alternativeTitle: title.attr('data-jp') || title.text().trim(),
        id: toId(href),
        poster: extractBackground($(el).attr('style')),
        episodes: readEpisodes($(el).find('.info, .mics').first()),
        rank: index + 1,
        type: $(el).find('.info b').first().text().trim() || null,
        quality: $(el).find('.mics div').eq(2).find('span').text().trim() || null,
        duration: $(el).find('.mics div').eq(0).find('span').text().trim() || null,
        aired: $(el).find('.mics div').eq(1).find('span').text().trim() || null,
        synopsis: $(el).find('.desc').text().trim() || null,
      });
    })
    .get()
    .filter(Boolean);

  if (modernCards.length) return modernCards;

  return $('.deslide-wrap .swiper-wrapper .swiper-slide')
    .map((index, el) =>
      cleanupItem({
        title: $(el).find('.desi-head-title').text().trim(),
        alternativeTitle: $(el).find('.desi-head-title').attr('data-jname') || null,
        id: toId($(el).find('.desi-buttons a').first().attr('href')),
        poster: readPoster($(el)),
        episodes: {
          sub: toNumber($(el).find('.tick-sub').text()),
          dub: toNumber($(el).find('.tick-dub').text()),
          eps: toNumber($(el).find('.tick-eps').text()) || toNumber($(el).find('.tick-sub').text()),
        },
        rank: index + 1,
        type: $(el).find('.sc-detail .scd-item').eq(0).text().trim() || null,
        quality: $(el).find('.quality').text().trim() || null,
        duration: $(el).find('.sc-detail .scd-item').eq(1).text().trim() || null,
        aired: $(el).find('.sc-detail .scd-item.m-hide').text().trim() || null,
        synopsis: $(el).find('.desi-description').text().trim() || null,
      })
    )
    .get()
    .filter(Boolean);
}

function extractTrending($) {
  const modernCards = extractAnimeCards($, '#trending-anime .tab-body[data-id="trending"] .aitem');
  if (modernCards.length) return modernCards.map((item, index) => ({ ...item, rank: index + 1 }));

  return $('#trending-home .swiper-container .swiper-slide')
    .map((index, el) =>
      cleanupItem({
        title: $(el).find('.film-title').text().trim(),
        alternativeTitle: $(el).find('.film-title').attr('data-jname') || null,
        id: toId($(el).find('.film-poster').attr('href')),
        poster: readPoster($(el).find('.film-poster')),
        rank: index + 1,
      })
    )
    .get()
    .filter(Boolean);
}

function extractFeaturedSections($) {
  return $('#anime-featured .anif-block')
    .map((_, el) => ({
      heading: $(el).find('.anif-block-header').first().text().trim(),
      items: extractAnimeCards($, $(el).find('.anif-block-ul ul li')),
    }))
    .get()
    .filter((section) => section.items.length);
}

function extractSectionByHeading($, headings) {
  const normalizedTargets = headings.map(normalizeHeading);

  const modernMatch = $('.section')
    .map((_, el) => {
      const heading = $(el).find('.stitle, .section-name, .cat-heading, .anif-block-header').first().text().trim();
      const items = extractAnimeCards($, $(el).find('.aitem, .flw-item, li'));
      return { heading, items };
    })
    .get()
    .find((section) => normalizedTargets.includes(normalizeHeading(section.heading)) && section.items.length);

  if (modernMatch) return modernMatch.items;

  const legacyHomeMatch = $('.block_area.block_area_home')
    .map((_, el) => {
      const heading = $(el).find('.cat-heading').first().text().trim();
      const items = extractAnimeCards($, $(el).find('.tab-content .film_list-wrap .flw-item'));
      return { heading, items };
    })
    .get()
    .find((section) => normalizedTargets.includes(normalizeHeading(section.heading)) && section.items.length);

  if (legacyHomeMatch) return legacyHomeMatch.items;

  const legacyFeaturedMatch = $('#anime-featured .anif-block')
    .map((_, el) => {
      const heading = $(el).find('.anif-block-header').first().text().trim();
      const items = extractAnimeCards($, $(el).find('.anif-block-ul ul li'));
      return { heading, items };
    })
    .get()
    .find((section) => normalizedTargets.includes(normalizeHeading(section.heading)) && section.items.length);

  return legacyFeaturedMatch?.items || [];
}

function extractAnimeCards($, selectorOrElements) {
  return $(selectorOrElements)
    .map((index, el) => {
      const item = $(el);

      if (item.hasClass('anif-block')) {
        return {
          heading: item.find('.anif-block-header').first().text().trim(),
          items: extractAnimeCards($, item.find('.anif-block-ul ul li')),
        };
      }

      const href =
        item.attr('href') ||
        item.find('a[href*="/watch/"]').first().attr('href') ||
        item.find('.film-name a').first().attr('href') ||
        item.find('.dynamic-name').first().attr('href');

      const titleElement =
        item.find('.title').first().length
          ? item.find('.title').first()
          : item.find('.film-name a').first().length
            ? item.find('.film-name a').first()
            : item.find('.dynamic-name').first();

      const title =
        titleElement.text().trim() ||
        titleElement.attr('title') ||
        item.find('.film-title').text().trim() ||
        null;

      const alternativeTitle =
        titleElement.attr('data-jp') ||
        titleElement.attr('data-jname') ||
        titleElement.attr('title') ||
        title ||
        null;

      const result = cleanupItem({
        title,
        alternativeTitle,
        id: toId(href),
        poster: readPoster(item),
        type: readType(item),
        duration: readDuration(item),
        episodes: readEpisodes(item),
        rank: toNumber(item.find('.num').text()) || index + 1,
      });

      return result?.id || result?.title ? result : null;
    })
    .get()
    .filter(Boolean);
}

function extractTopTen($) {
  const readGroup = (selector) => extractAnimeCards($, selector).map(stripOptionalFields);

  const modernToday = readGroup('#trending-anime .tab-body[data-id="day"] .aitem');
  const modernWeek = readGroup('#trending-anime .tab-body[data-id="week"] .aitem');
  const modernMonth = readGroup('#trending-anime .tab-body[data-id="month"] .aitem');

  if (modernToday.length || modernWeek.length || modernMonth.length) {
    return {
      today: modernToday,
      week: modernWeek,
      month: modernMonth,
    };
  }

  return {
    today: readGroup('#top-viewed-day ul li'),
    week: readGroup('#top-viewed-week ul li'),
    month: readGroup('#top-viewed-month ul li'),
  };
}

function extractGenres($) {
  const modernGenres = $('.nav-menu a[href*="/genres/"]')
    .map((_, el) => $(el).attr('href')?.split('/').at(-1))
    .get()
    .filter(Boolean);

  if (modernGenres.length) return [...new Set(modernGenres)];

  return [
    ...new Set(
      $('.sb-genre-list li a')
        .map((_, el) => $(el).attr('title')?.trim().toLowerCase() || $(el).text().trim().toLowerCase())
        .get()
        .filter(Boolean)
    ),
  ];
}

function cleanupItem(item) {
  if (!item?.title && !item?.id) return null;

  return {
    ...item,
    title: item.title || null,
    alternativeTitle: item.alternativeTitle || item.title || null,
    id: item.id || null,
    poster: item.poster || null,
    type: item.type || null,
    duration: item.duration || null,
    episodes: item.episodes || { sub: 0, dub: 0, eps: 0 },
  };
}

function stripOptionalFields(item) {
  return {
    title: item.title,
    alternativeTitle: item.alternativeTitle,
    id: item.id,
    poster: item.poster,
    episodes: item.episodes,
    rank: item.rank,
  };
}

function readPoster(item) {
  return (
    item.find('img').first().attr('data-src') ||
    item.find('img').first().attr('src') ||
    extractBackground(item.attr('style')) ||
    extractBackground(item.find('[style*="url("]').first().attr('style')) ||
    null
  );
}

function readType(item) {
  return (
    item.find('.fd-infor .fdi-item').first().text().trim() ||
    item.find('.info > span > b').last().text().trim() ||
    item.find('.scd-item').first().text().trim() ||
    null
  );
}

function readDuration(item) {
  return (
    item.find('.fd-infor .fdi-duration').first().text().trim() ||
    item.find('.scd-item').eq(1).text().trim() ||
    null
  );
}

function readEpisodes(item) {
  const sub = toNumber(item.find('.tick-sub, .sub').first().text());
  const dub = toNumber(item.find('.tick-dub, .dub').first().text());
  const eps = toNumber(item.find('.tick-eps').first().text()) || sub || dub;

  return { sub, dub, eps };
}

function normalizeHeading(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function extractBackground(styleValue = '') {
  const match = styleValue.match(/url\((['"]?)(.*?)\1\)/);
  return match?.[2] || null;
}

function toId(href = '') {
  return href ? href.split('/').filter(Boolean).at(-1)?.split('?').at(0) || null : null;
}

function toNumber(value) {
  const normalized = String(value || '')
    .replace(/[^\d]/g, '')
    .trim();

  return normalized ? Number(normalized) : 0;
}

function firstNonEmpty(...collections) {
  return collections.find((items) => Array.isArray(items) && items.length) || [];
}

function findFeaturedSection(sections, matcher) {
  return sections.find((section) => matcher.test(section.heading))?.items || [];
}

export async function fetchKaidoEpisodes(id) {
  // Fetch the watch page
  const watchResponse = await fetchWithTimeout(`${DEFAULT_KAIDO_BASE_URL}/watch/${id}`, {
    headers: FETCH_HEADERS,
  });

  if (!watchResponse.ok) {
    throw new Error(`Kaido watch page request failed with HTTP ${watchResponse.status}`);
  }

  const watchHtml = await watchResponse.text();
  const $ = load(watchHtml);

  // Try AJAX endpoint first
  const animeId = $('#syncData').length ?
    JSON.parse($('#syncData').text()).anime_id :
    $('#wrapper').attr('data-id') || id;

  try {
    const ajaxResponse = await fetchWithTimeout(`${DEFAULT_KAIDO_BASE_URL}/ajax/episode/list/${animeId}`, {
      headers: {
        ...FETCH_HEADERS,
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${DEFAULT_KAIDO_BASE_URL}/watch/${id}`,
      },
    });

    if (ajaxResponse.ok) {
      const data = await ajaxResponse.json();
      if (data.html) {
        const episode$ = load(data.html);
        const episodes = episode$('.ssl-item.ep-item')
          .map((_, el) => {
            const item = episode$(el);
            const number = toNumber(item.attr('data-number'));
            const dataId = item.attr('data-id');
            const title = item.attr('title') || item.find('.ep-name').text().trim() || `Episode ${number}`;
            const href = item.attr('href') || '';
            const episodeId = dataId ? `${id}::ep=${number}::token=${dataId}` : `${id}::ep=${number}`;

            return {
              title,
              alternativeTitle: title,
              id: episodeId,
              isFiller: item.hasClass('ssl-item-filler'),
              episodeNumber: number,
            };
          })
          .get();
        
        if (episodes.length > 0) return episodes;
      }
    }
  } catch (ajaxError) {
    console.log('Kaido AJAX episodes failed, parsing from HTML:', ajaxError.message);
  }

  // Fallback: Parse episodes directly from the watch page HTML
  const episodes = [];
  
  // Try to find episodes in the episodes list section
  $('.episodes-list a, .ep-item, .episode-item, [class*="ep-list"] a, [class*="episode"] a').each((_, el) => {
    const item = $(el);
    const number = toNumber(item.attr('data-number') || item.attr('data-ep') || item.find('.ep-number').text());
    const title = item.attr('title') || item.find('.ep-title').text().trim() || item.text().trim() || `Episode ${number}`;
    const href = item.attr('href') || '';
    const episodeId = href ? href.split('/').at(-1)?.split('?').at(0) || null : null;

    if (number > 0) {
      episodes.push({
        title,
        alternativeTitle: title,
        id: episodeId || `${id}::ep=${number}`,
        isFiller: item.hasClass('ssl-item-filler') || item.hasClass('filler'),
        episodeNumber: number,
      });
    }
  });

  if (episodes.length === 0) {
    throw new Error('Episodes not found on kaido.to');
  }

  return episodes;
}

export async function fetchKaidoServers(episodeId) {
  // Extract episode data from episodeId format "anime-id::ep=NUMBER::token=DATA_ID"
  const epMatch = episodeId?.match(/::ep=(\d+)/);
  const tokenMatch = episodeId?.match(/::token=(\d+)/);
  const episodeNumber = epMatch ? epMatch[1] : null;
  const dataId = tokenMatch ? tokenMatch[1] : null;
  const animeId = episodeId?.split('::')[0] || episodeId;

  // If we have the data-id token, use it directly
  const actualEpisodeId = dataId || episodeId;

  const response = await fetchWithTimeout(`${DEFAULT_KAIDO_BASE_URL}/ajax/episode/servers?episodeId=${actualEpisodeId}`, {
    headers: {
      ...FETCH_HEADERS,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${DEFAULT_KAIDO_BASE_URL}/watch/${animeId}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Kaido servers request failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data.html) {
    throw new Error('Servers not found');
  }

  const server$ = load(data.html);
  const groups = { sub: [], dub: [] };

  // Parse servers from the HTML structure
  server$('.server-item').each((_, el) => {
    const item = server$(el);
    const type = item.attr('data-type') || 'sub';
    const serverId = item.attr('data-id');
    const name = item.find('.btn').text().trim().toLowerCase().replace(/\s+/g, '-');

    if (serverId) {
      groups[type].push({
        index: groups[type].length + 1,
        type,
        id: serverId,
        name: name || `server-${groups[type].length + 1}`,
        label: item.find('.btn').text().trim(),
      });
    }
  });

  if (groups.sub.length === 0 && groups.dub.length === 0) {
    throw new Error('No servers found');
  }

  return {
    episode: actualEpisodeId,
    sub: groups.sub,
    dub: groups.dub,
  };
}

export async function fetchKaidoStream(episodeId, serverName, type = 'sub') {
  const servers = await fetchKaidoServers(episodeId);
  const serverList = servers[type] || [];
  
  // Find server by name or use first available
  const selectedServer = serverList.find((s) =>
    s.name === serverName ||
    s.name?.includes(serverName) ||
    serverName?.includes(s.name)
  ) || serverList[0];

  if (!selectedServer?.id) {
    throw new Error('Server not found');
  }

  const animeId = episodeId?.split('::')[0] || episodeId;

  const response = await fetchWithTimeout(
    `${DEFAULT_KAIDO_BASE_URL}/ajax/episode/sources?id=${selectedServer.id}`,
    {
      headers: {
        ...FETCH_HEADERS,
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${DEFAULT_KAIDO_BASE_URL}/watch/${animeId}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Kaido stream request failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  const sourceUrl = data.link || '';

  // Always return as embed type - let browser handle it in iframe
  return {
    id: episodeId,
    type,
    link: {
      file: sourceUrl,
      type: 'embed',
    },
    tracks: [],
    intro: null,
    outro: null,
    server: selectedServer.name,
    referer: DEFAULT_KAIDO_BASE_URL + '/',
    label: selectedServer.label,
  };
}
