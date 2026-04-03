import { load } from 'cheerio';
import { upstreamFetch } from './upstreamFetch';

const ANIKAI_CRYPTO_URL = 'https://enc-dec.app/api';

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  'X-Requested-With': 'XMLHttpRequest',
};

export async function fetchAnikaiWatchPage(id) {
  const { html, $, resolvedId } = await fetchResolvedWatchPage(id);

  return {
    html,
    $,
    resolvedId,
    syncData: parseSyncData($),
  };
}

export async function fetchAnikaiAnimeInfo(id) {
  const { $, syncData, resolvedId } = await fetchAnikaiWatchPage(id);
  const mainEntity = $('.main-entity, #main-entity').first();

  if (!mainEntity.length) {
    throw new Error('Anime page not found');
  }

  const infoValues = mainEntity
    .find('.info > span > b')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  const details = parseDetailMap($, mainEntity.find('.detail'));

  return {
    title: mainEntity.find('.title').first().text().trim(),
    alternativeTitle: mainEntity.find('.title').first().attr('data-jp') || null,
    id: resolvedId || id,
    poster:
      readImageSource($('.poster img').first()) ||
      extractBackground($('.poster-wrap-bg').first().attr('style')) ||
      extractBackground($('.poster').first().attr('style')) ||
      null,
    episodes: {
      sub: toNumber(mainEntity.find('.info .sub').text()),
      dub: toNumber(mainEntity.find('.info .dub').text()),
      eps:
        toNumber(infoValues.find((value) => /^\d+$/.test(value))) ||
        Math.max(
          toNumber(mainEntity.find('.info .sub').text()),
          toNumber(mainEntity.find('.info .dub').text())
        ),
    },
    rating: mainEntity.find('.info .rating').text().trim() || null,
    type: infoValues.find((value) => /tv|movie|ova|ona|special|music/i.test(value)) || null,
    is18Plus: false,
    synopsis: mainEntity.find('.desc').text().trim() || null,
    synonyms: mainEntity.find('.al-title').text().trim() || null,
    aired: parseAired(details.aired),
    premiered: details.premiered,
    duration: details.duration,
    status: details.status,
    MAL_score: parseMalScore(details.mal),
    genres: details.genres,
    studios: details.studios,
    producers: details.producers,
    moreSeasons: extractMoreSeasons($),
    related: extractAitemCollection($, '#related-anime .tab-body .aitem'),
    mostPopular: [],
    recommended: extractSectionAitemsByTitle($, 'Recommended'),
    anikaiAnimeId: syncData.anime_id || $('#anime-rating').attr('data-id') || null,
  };
}

function extractMoreSeasons($) {
  return $('.block_area-seasons .os-list .os-item, .seasons-wrap .os-list .os-item')
    .map((_, el) => {
      const season = $(el);
      const title = season.attr('title') || season.find('.title').text().trim() || null;
      const href = season.attr('href') || season.find('a').attr('href') || '';
      const posterFromImage = readImageSource(season.find('img').first());
      const posterFromStyle =
        extractBackground(season.find('.season-poster').attr('style')) ||
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

export async function fetchAnikaiEpisodes(id) {
  const { $, syncData } = await fetchAnikaiWatchPage(id);
  const animeId = syncData.anime_id || $('#anime-rating').attr('data-id');

  if (!animeId) {
    throw new Error('Anime identifier not found');
  }

  const html = await fetchAnikaiEpisodesHtml(animeId, id);
  const list = load(html);

  return list('a[token]')
    .map((_, el) => {
      const token = list(el).attr('token');
      const number = toNumber(list(el).attr('num'));
      const title = list(el).find('span').text().trim() || `Episode ${number}`;

      return {
        title,
        alternativeTitle: title,
        id: serializeEpisodeId({
          animeId: id,
          episode: number,
          token,
        }),
        isFiller: false,
        episodeNumber: number,
      };
    })
    .get();
}

export async function fetchAnikaiServers(episodeId) {
  const parsed = parseEpisodeId(episodeId);
  const html = await fetchAnikaiLinksListHtml(parsed.token, parsed.animeId);
  const $ = load(html);

  const groups = {
    sub: [],
    dub: [],
  };

  $('.server-items.lang-group').each((_, group) => {
    const rawType = $(group).attr('data-id');
    const targetType = rawType === 'dub' ? 'dub' : 'sub';
    const offset = groups[targetType].length;

    $(group)
      .find('.server')
      .each((index, el) => {
        groups[targetType].push({
          index: offset + index + 1,
          type: targetType,
          id: $(el).attr('data-lid'),
          name: `hd-${offset + index + 1}`,
          label: `${normalizeServerGroup(rawType)} - ${$(el).text().trim()}`,
          rawType,
        });
      });
  });

  return {
    episode: parsed.episode,
    sub: groups.sub,
    dub: groups.dub,
  };
}

export async function fetchAnikaiStream(episodeId, serverName, type) {
  const servers = await fetchAnikaiServers(episodeId);
  const selectedServer = pickServer(servers[type] || [], serverName, type);

  if (!selectedServer?.id) {
    throw new Error('invalid or server not found');
  }

  const encrypted = await fetchAnikaiLinkView(selectedServer.id, episodeId);
  const decrypted = await anikaiCrypto('dec', encrypted);
  const payload = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
  const providerUrl = payload.url;

  // Try to extract raw m3u8 from the embed page
  let m3u8Url = null;
  try {
    const embedResponse = await fetch(providerUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': providerUrl,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    if (embedResponse.ok) {
      const embedHtml = await embedResponse.text();
      const embed$ = load(embedHtml);

      // Look for m3u8 in script variables
      embed$('script').each((_, el) => {
        const scriptContent = embed$(el).html() || '';
        // Common patterns for m3u8 URLs in player scripts
        const patterns = [
          /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/g,
          /file:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/g,
          /source:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/g,
          /url:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/g,
        ];

        for (const pattern of patterns) {
          let match;
          while ((match = pattern.exec(scriptContent)) !== null) {
            m3u8Url = match[1];
            break;
          }
          if (m3u8Url) break;
        }
      });

      // Also check for video source elements
      if (!m3u8Url) {
        m3u8Url = embed$('source[src*=".m3u8"]').attr('src') ||
                  embed$('video').attr('data-source') ||
                  embed$('video').attr('data-hls') ||
                  null;
      }

      if (m3u8Url) {
        console.log('Extracted m3u8 from embed page:', m3u8Url);
      }
    }
  } catch (err) {
    console.log('Failed to extract m3u8 from embed:', err.message);
  }

  // Also try the resolveProviderStream method as fallback
  const resolvedStream = m3u8Url ? null : await resolveProviderStream(providerUrl).catch(() => null);

  return {
    id: episodeId,
    type,
    link: {
      file: m3u8Url || resolvedStream?.file || providerUrl,
      type: m3u8Url || resolvedStream?.file ? 'm3u8' : 'embed',
    },
    tracks: resolvedStream?.tracks || [],
    intro: parseSkipWindow(payload.skip?.intro),
    outro: parseSkipWindow(payload.skip?.outro),
    server: selectedServer.name,
    referer: resolvedStream?.referer || new URL(providerUrl).origin + '/',
    label: selectedServer.label,
  };
}

export async function fetchAnikaiHomePage() {
  const { response } = await upstreamFetch('/home');
  const html = await response.text();
  const $ = load(html);

  const spotlight = $('#featured .swiper-slide')
    .map((index, el) => {
      const href = $(el).find('.watch-btn').attr('href');

      return {
        title: $(el).find('.title').text().trim(),
        alternativeTitle: $(el).find('.title').attr('data-jp') || null,
        id: href?.split('/').at(-1) || null,
        poster: extractBackground($(el).attr('style')),
        episodes: {
          sub: toNumber($(el).find('.info .sub').text()),
          dub: toNumber($(el).find('.info .dub').text()),
          eps: toNumber($(el).find('.info .sub').text()),
        },
        rank: index + 1,
        type: $(el).find('.info b').first().text().trim() || null,
        quality: $(el).find('.mics div').eq(2).find('span').text().trim() || null,
        duration: null,
        aired: $(el).find('.mics div').eq(1).find('span').text().trim() || null,
        synopsis: $(el).find('.desc').text().trim() || null,
      };
    })
    .get();

  const latestEpisode = extractAitemCollection(
    $,
    '.alist-group .tab-body[data-id="all-updates"] .aitem, .alist-group .tab-body .aitem'
  );
  const trending = extractAitemCollection($, '#trending-anime .tab-body[data-id="trending"] .aitem');
  const dayTrending = extractAitemCollection($, '#trending-anime .tab-body[data-id="day"] .aitem');
  const weekTrending = extractAitemCollection($, '#trending-anime .tab-body[data-id="week"] .aitem');
  const monthTrending = extractAitemCollection($, '#trending-anime .tab-body[data-id="month"] .aitem');

  // Extract additional homepage categories
  const topAiring = extractSectionByHeading($, ['Top Airing', 'Top Airing Anime']);
  const mostPopular = extractSectionByHeading($, ['Most Popular', 'Most Popular Anime']);
  const mostFavorite = extractSectionByHeading($, ['Most Favorite', 'Most Favorite Anime']);
  const latestCompleted = extractSectionByHeading($, ['Latest Completed', 'Recently Completed']);
  const newAdded = extractSectionByHeading($, ['New Added', 'New On Anikai', 'Recently Added']);
  const topUpcoming = extractSectionByHeading($, ['Top Upcoming', 'Upcoming Anime']);

  return {
    spotlight,
    trending,
    topAiring,
    mostPopular,
    mostFavorite,
    latestCompleted,
    latestEpisode,
    newAdded,
    topUpcoming,
    topTen: {
      today: dayTrending,
      week: weekTrending,
      month: monthTrending,
    },
    genres: $('.nav-menu a[href^="/genres/"]')
      .map((_, el) => $(el).attr('href').split('/').at(-1))
      .get()
      .filter(Boolean),
  };
}

/**
 * Extract anime items from a section matching one of the target headings
 */
function extractSectionByHeading($, headings) {
  const normalizedTargets = headings.map((h) => h.trim().toLowerCase());

  // Try various section patterns
  const sections = $(
    '.section, .block_area, .block_area_home, #anime-featured .anif-block, .sidebar-section, [class*="section"], [class*="block_area"]'
  );

  for (let i = 0; i < sections.length; i++) {
    const section = sections.eq(i);
    const headingText = section
      .find('.stitle, .section-name, .cat-heading, .anif-block-header, .block-name, h2, h3')
      .first()
      .text()
      .trim()
      .toLowerCase();

    if (normalizedTargets.includes(headingText)) {
      // Try to find .aitem elements first
      const aitems = section.find('.aitem');
      if (aitems.length > 0) {
        return extractAitemCollection($, section.find('.aitem'));
      }

      // Try .flw-item elements
      const flwItems = section.find('.flw-item');
      if (flwItems.length > 0) {
        return extractFlwItemCollection($, section.find('.flw-item'));
      }

      // Try li elements within the section
      const listItems = section.find('ul li');
      if (listItems.length > 0) {
        return extractAitemCollection($, section.find('ul li'));
      }
    }
  }

  return [];
}

/**
 * Extract anime items from .flw-item elements (film list wrapper items)
 */
function extractFlwItemCollection($, selector) {
  return $(selector)
    .map((index, el) => {
      const item = $(el);
      const titleEl = item.find('.film-name a, .dynamic-name').first();
      const posterImg = item.find('img').first();
      const posterSrc = posterImg.attr('data-src') || posterImg.attr('src') || null;

      return {
        title: titleEl.text().trim() || titleEl.attr('title') || null,
        alternativeTitle: titleEl.attr('data-jp') || titleEl.attr('data-jname') || titleEl.attr('title') || null,
        id: (item.find('a[href*="/watch/"]').first().attr('href') || titleEl.attr('href') || '')
          .split('/watch/')
          .at(-1)
          ?.split('?')
          .at(0) || null,
        poster: posterSrc || extractBackground(item.find('[style*="url("]').first().attr('style')),
        type: item.find('.fd-infor .fdi-item').first().text().trim() || null,
        duration: item.find('.fd-infor .fdi-duration').first().text().trim() || null,
        episodes: {
          sub: toNumber(item.find('.tick-sub').text()),
          dub: toNumber(item.find('.tick-dub').text()),
          eps: toNumber(item.find('.tick-eps').text()) || toNumber(item.find('.tick-sub').text()),
        },
        rank: index + 1,
      };
    })
    .get()
    .filter((item) => item.id || item.title);
}

export function parseEpisodeId(id) {
  const [animeId, ...parts] = id.split('::');
  const values = Object.fromEntries(
    parts.map((part) => {
      const [key, ...rest] = part.split('=');
      return [key, rest.join('=')];
    })
  );

  return {
    animeId,
    episode: toNumber(values.ep),
    token: values.token,
  };
}

function serializeEpisodeId({ animeId, episode, token }) {
  return `${animeId}::ep=${episode}::token=${token}`;
}

async function fetchAnikaiEpisodesHtml(animeId, watchSlug) {
  const encoded = await anikaiCrypto('enc', animeId);
  const res = await fetch(`https://anikai.to/ajax/episodes/list?ani_id=${animeId}&_=${encoded}`, {
    headers: {
      ...FETCH_HEADERS,
      Referer: `https://anikai.to/watch/${watchSlug}`,
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  if (data.status !== 'ok' || !data.result) {
    throw new Error('Episode list not found');
  }

  return data.result;
}

async function fetchResolvedWatchPage(id, visited = new Set()) {
  const { response } = await upstreamFetch(`/watch/${id}`);
  const html = await response.text();
  const $ = load(html);
  const canonicalId = resolveCanonicalWatchId($, id);

  if (canonicalId && canonicalId !== id && !visited.has(canonicalId)) {
    return fetchResolvedWatchPage(canonicalId, new Set([...visited, id]));
  }

  return {
    html,
    $,
    resolvedId: canonicalId || id,
  };
}

async function fetchAnikaiLinksListHtml(token, watchSlug) {
  const encoded = await anikaiCrypto('enc', token);
  const res = await fetch(
    `https://anikai.to/ajax/links/list?token=${encodeURIComponent(token)}&_=${encodeURIComponent(encoded)}`,
    {
      headers: {
        ...FETCH_HEADERS,
        Referer: `https://anikai.to/watch/${watchSlug}`,
      },
    }
  );

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  if (data.status !== 'ok' || !data.result) {
    throw new Error('Server list not found');
  }

  return data.result;
}

async function fetchAnikaiLinkView(linkId, watchSlug) {
  const encoded = await anikaiCrypto('enc', linkId);
  const res = await fetch(
    `https://anikai.to/ajax/links/view?id=${encodeURIComponent(linkId)}&_=${encodeURIComponent(encoded)}`,
    {
      headers: {
        ...FETCH_HEADERS,
        Referer: `https://anikai.to/watch/${watchSlug}`,
      },
    }
  );

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  if (data.status !== 'ok' || !data.result) {
    throw new Error('Stream link not found');
  }

  return data.result;
}

async function anikaiCrypto(mode, text) {
  const res = await fetch(
    `${ANIKAI_CRYPTO_URL}/${mode === 'enc' ? 'enc-kai' : 'dec-kai'}?text=${encodeURIComponent(text)}`,
    {
      headers: {
        'User-Agent': FETCH_HEADERS['User-Agent'],
      },
    }
  );

  if (!res.ok) {
    throw new Error(`Crypto service failed with HTTP ${res.status}`);
  }

  const data = await res.json();
  if (!data?.result) {
    throw new Error('Crypto service returned an invalid response');
  }

  return data.result;
}

async function resolveProviderStream(url) {
  const provider = new URL(url);
  const mediaUrl = url.replace('/e/', '/media/');
  const mediaResponse = await fetch(mediaUrl, {
    headers: {
      'User-Agent': FETCH_HEADERS['User-Agent'],
      Referer: `${provider.origin}/`,
    },
  });

  if (!mediaResponse.ok) {
    throw new Error(`Provider media request failed with HTTP ${mediaResponse.status}`);
  }

  const mediaPayload = await mediaResponse.json();
  if (!mediaPayload?.result) {
    throw new Error('Provider media payload missing result');
  }

  const decryptMode = /rapid/i.test(provider.hostname) ? 'dec-rapid' : 'dec-mega';
  const decrypted = await providerCrypto(decryptMode, mediaPayload.result);
  const source = pickBestProviderSource(decrypted?.sources);

  if (!source?.file) {
    throw new Error('No playable provider source found');
  }

  return {
    file: source.file,
    type: source.file.includes('.m3u8') ? 'm3u8' : 'mp4',
    tracks: normalizeTracks(decrypted?.tracks),
    referer: `${provider.origin}/`,
  };
}

async function providerCrypto(mode, text, retry = 0) {
  const response = await fetch(`${ANIKAI_CRYPTO_URL}/${mode}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': FETCH_HEADERS['User-Agent'],
    },
    body: JSON.stringify({
      text,
      agent: FETCH_HEADERS['User-Agent'],
    }),
  }).catch((error) => {
    if (retry < 1) {
      return providerCrypto(mode, text, retry + 1);
    }

    throw error;
  });

  if (!response.ok) {
    throw new Error(`Provider crypto failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data?.result) {
    throw new Error('Provider crypto returned an invalid response');
  }

  return data.result;
}

function parseSyncData($) {
  try {
    return JSON.parse($('#syncData').text() || '{}');
  } catch {
    return {};
  }
}

function parseDetailMap($, root) {
  const map = {
    aired: null,
    premiered: null,
    duration: null,
    status: null,
    mal: null,
    genres: [],
    studios: [],
    producers: [],
  };

  root.find('div > div').each((_, el) => {
    const label = $(el).clone().find('span').remove().end().text().trim();
    const value = $(el).find('span').first().text().trim();

    switch (label) {
      case 'Date aired:':
        map.aired = $(el).text().replace('Date aired:', '').trim();
        break;
      case 'Premiered:':
        map.premiered = value;
        break;
      case 'Duration:':
        map.duration = value;
        break;
      case 'Status:':
        map.status = value;
        break;
      case 'MAL:':
        map.mal = $(el).text().replace('MAL:', '').trim();
        break;
      case 'Genres:':
        map.genres = $(el)
          .find('a')
          .map((__, link) => $(link).text().trim())
          .get();
        break;
      case 'Studios:':
        map.studios = $(el)
          .find('a')
          .map((__, link) => $(link).attr('href').split('/').at(-1))
          .get();
        break;
      case 'Producers:':
        map.producers = $(el)
          .find('a')
          .map((__, link) => $(link).attr('href').split('/').at(-1))
          .get();
        break;
      default:
        break;
    }
  });

  return map;
}

function extractAitemCollection($, selector) {
  return $(selector)
    .map((index, el) => {
      const title = $(el).find('.title').first();
      const infoValues = $(el)
        .find('.info > span > b')
        .map((_, item) => $(item).text().trim())
        .get()
        .filter(Boolean);

      return {
        title: title.text().trim(),
        alternativeTitle: title.attr('data-jp') || title.text().trim(),
        id: $(el).attr('href')?.split('/').at(-1) || null,
        poster: extractBackground($(el).attr('style')),
        type: infoValues.at(-1) || null,
        duration: null,
        episodes: {
          sub: toNumber($(el).find('.info .sub').text()),
          dub: toNumber($(el).find('.info .dub').text()),
          eps:
            toNumber(infoValues.find((value) => /^\d+$/.test(value))) ||
            toNumber($(el).find('.info .sub').text()),
        },
        rank: toNumber($(el).find('.num').text()) || index + 1,
      };
    })
    .get();
}

function extractSectionAitemsByTitle($, title) {
  const section = $('.sidebar-section')
    .filter((_, el) => $(el).find('.stitle').first().text().trim() === title)
    .first();

  if (!section.length) return [];

  return extractAitemCollection($, section.find('.aitem-col .aitem'));
}

function resolveCanonicalWatchId($, requestedId) {
  const canonicalHref = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content') || '';
  const canonicalId = canonicalHref ? canonicalHref.split('/watch/').at(-1)?.split('?').at(0) : null;

  if (canonicalId && canonicalId !== 'browser') {
    return canonicalId;
  }

  if (!isBrowserPage($)) {
    return requestedId;
  }

  const candidateIds = $('a[href^="/watch/"]')
    .map((_, el) => $(el).attr('href')?.split('/watch/').at(-1)?.split('?').at(0))
    .get()
    .filter(Boolean);

  return pickMatchingWatchId(candidateIds, requestedId) || requestedId;
}

function extractBackground(styleValue = '') {
  const match = styleValue.match(/url\((['"]?)(.*?)\1\)/);
  return match?.[2] || null;
}

function isBrowserPage($) {
  const title = $('title').text().trim();
  const canonicalHref = $('link[rel="canonical"]').attr('href') || '';
  return /browser/i.test(title) || /\/browser(?:\/)?$/i.test(canonicalHref);
}

function pickMatchingWatchId(candidateIds, requestedId) {
  const normalizedRequestedId = normalizeWatchId(requestedId);
  if (!normalizedRequestedId) return null;

  const uniqueCandidates = [...new Set(candidateIds)];

  return (
    uniqueCandidates.find((candidateId) => normalizeWatchId(candidateId) === normalizedRequestedId) ||
    uniqueCandidates.find((candidateId) => candidateId.startsWith(`${normalizedRequestedId}-`)) ||
    uniqueCandidates.find((candidateId) => candidateId.includes(normalizedRequestedId)) ||
    null
  );
}

function normalizeWatchId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/-\w{4,6}$/i, '');
}

function readImageSource(element) {
  if (!element || element.length === 0) return null;

  return (
    element.attr('src') ||
    element.attr('data-src') ||
    element.attr('data-lazy-src') ||
    element.attr('data-original') ||
    null
  );
}

function pickBestProviderSource(sources = []) {
  return [...sources]
    .filter((source) => source?.file)
    .sort((left, right) => readSourceLabel(right?.label) - readSourceLabel(left?.label))[0];
}

function normalizeTracks(tracks = []) {
  return tracks
    .filter((track) => track?.file && track?.label)
    .map((track) => ({
      file: track.file,
      label: track.label,
      kind: /thumbnail/i.test(track.kind) ? 'thumbnails' : 'captions',
      default: Boolean(track.default),
    }));
}

function readSourceLabel(value) {
  return Number(String(value || '').replace(/[^\d]/g, '')) || 0;
}

function normalizeServerGroup(group) {
  return (
    {
      sub: 'Hard Sub',
      softsub: 'Soft Sub',
      dub: 'Dub',
    }[group] || group
  );
}

function pickServer(servers, requestedName, type) {
  return (
    servers.find((server) => server.name === requestedName) ||
    servers.find((server) => server.name === 'hd-1') ||
    servers[0] || {
      id: null,
      name: requestedName || 'hd-1',
      type,
    }
  );
}

function parseSkipWindow(value) {
  if (!Array.isArray(value) || value.length < 2) return null;

  return {
    start: toNumber(value[0]),
    end: toNumber(value[1]),
  };
}

function parseAired(value) {
  const [from, to] = (value || '').split(' to ');
  return {
    from: from?.trim() || null,
    to: to?.trim() === '?' ? null : to?.trim() || null,
  };
}

function parseMalScore(value) {
  return value?.split('by').at(0).trim() || null;
}

function toNumber(value) {
  const normalized = String(value ?? '')
    .replace(/[^\d]/g, '')
    .trim();

  return normalized ? Number(normalized) : 0;
}
