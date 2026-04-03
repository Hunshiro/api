import { load } from 'cheerio';

const ANIKAI_BASE_URL = process.env.HIANIME_BASE_URL?.trim() || 'https://anikai.to';
const KAIDO_BASE_URL = process.env.KAIDO_BASE_URL?.trim() || 'https://kaido.to';

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

// Timeout wrapper for fetch
const FETCH_TIMEOUT = 10000; // 10 seconds

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

// Cache for ID mappings
const idCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Map an anikai.to ID to a kaido.to ID by searching for the anime title
 * @param {string} anikaiId - The anikai.to anime ID
 * @param {string} title - The anime title to search for
 * @returns {Promise<string|null>} - The kaido.to ID or null if not found
 */
export async function mapAnikaiToKaido(anikaiId, title = null) {
  const cacheKey = `anikai:${anikaiId}`;
  const cached = idCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.kaidoId;
  }

  try {
    let searchTitle = title;
    
    // If no title provided, fetch it from anikai.to
    if (!searchTitle) {
      searchTitle = await getAnikaiTitle(anikaiId);
    }
    
    if (!searchTitle) {
      // Fallback: try using the same ID
      return tryFallbackId(anikaiId, cacheKey);
    }

    // Clean up the title for better search results
    const cleanedTitle = cleanTitleForSearch(searchTitle);
    
    // Search on kaido.to
    const kaidoId = await searchKaidoForTitle(cleanedTitle, searchTitle);
    
    if (kaidoId) {
      idCache.set(cacheKey, { kaidoId, timestamp: Date.now() });
      return kaidoId;
    }

    // Fallback: try using the same ID
    return tryFallbackId(anikaiId, cacheKey);
  } catch (error) {
    console.error(`ID mapping error for ${anikaiId}:`, error.message);
    // Fallback to original ID
    return anikaiId;
  }
}

/**
 * Try to use the same ID on kaido.to as a fallback
 */
async function tryFallbackId(anikaiId, cacheKey) {
  // Extract the base ID without episode/season suffixes
  const baseId = extractBaseId(anikaiId);
  
  if (baseId && baseId !== anikaiId) {
    const isValid = await validateKaidoId(baseId);
    if (isValid) {
      idCache.set(cacheKey, { kaidoId: baseId, timestamp: Date.now() });
      return baseId;
    }
  }
  
  // Try the full ID
  const isValid = await validateKaidoId(anikaiId);
  if (isValid) {
    idCache.set(cacheKey, { kaidoId: anikaiId, timestamp: Date.now() });
    return anikaiId;
  }
  
  return null;
}

/**
 * Extract base ID from an anime ID (remove season/episode suffixes)
 */
function extractBaseId(id) {
  // Match patterns like "anime-name-123" from "anime-name-123-season-2"
  const match = id.match(/^(.+?-\d+)(?:-|$)/);
  return match ? match[1] : null;
}

/**
 * Clean title for better search results
 */
function cleanTitleForSearch(title) {
  return title
    .replace(/\s*\(TV\)\s*/gi, ' ')
    .replace(/\s*Season\s*\d+\s*/gi, ' ')
    .replace(/\s*Part\s*\d+\s*/gi, ' ')
    .replace(/\s*-\s*Official\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 5) // Use first 5 words for search
    .join(' ');
}

/**
 * Search kaido.to for an anime by title
 */
async function searchKaidoForTitle(searchQuery, originalTitle) {
  try {
    // Try multiple search approaches
    const searchQueries = [
      searchQuery,
      originalTitle?.split(' ').slice(0, 3).join(' '),
      originalTitle?.replace(/\s*\(.*?\)\s*/g, '').split(' ').slice(0, 4).join(' '),
    ].filter(Boolean);

    for (const query of searchQueries) {
      const kaidoId = await searchWithQuery(query, originalTitle);
      if (kaidoId) return kaidoId;
    }
    
    return null;
  } catch (error) {
    console.error('Search error:', error.message);
    return null;
  }
}

/**
 * Execute a single search query and find best match
 */
async function searchWithQuery(query, originalTitle) {
  try {
    const searchUrl = `${KAIDO_BASE_URL}/search?keyword=${encodeURIComponent(query)}`;
    const response = await fetchWithTimeout(searchUrl, {
      headers: { ...FETCH_HEADERS, 'Referer': KAIDO_BASE_URL + '/' }
    });
    
    if (!response.ok) return null;
    
    const html = await response.text();
    const $ = load(html);
    
    // Try multiple selectors for search results
    const results = [];
    
    // Modern selector
    $('.film_list-wrap .flw-item').each((_, el) => {
      const titleEl = $(el).find('.film-name a, .dynamic-name');
      const href = titleEl.attr('href') || $(el).find('a[href*="/watch/"]').first().attr('href');
      const title = titleEl.text().trim() || titleEl.attr('title');
      if (href && title) {
        results.push({ href, title });
      }
    });
    
    // Alternative selector
    if (results.length === 0) {
      $('.nav-item').each((_, el) => {
        const titleEl = $(el).find('.film-name, .dynamic-name');
        const href = $(el).attr('href') || titleEl.find('a').attr('href');
        const title = titleEl.text().trim();
        if (href && title) {
          results.push({ href, title });
        }
      });
    }
    
    if (results.length === 0) return null;
    
    // Find best match
    const normalizedOriginal = normalizeTitle(originalTitle || query);
    
    for (const result of results) {
      const normalizedResult = normalizeTitle(result.title);
      
      // Check for exact or near match
      if (normalizedResult.includes(normalizedOriginal) || 
          normalizedOriginal.includes(normalizedResult) ||
          similarity(normalizedResult, normalizedOriginal) > 0.7) {
        const id = result.href?.split('/watch/').at(-1)?.split('?').at(0);
        return id || null;
      }
    }
    
    // Return first result if no good match
    const firstResult = results[0];
    return firstResult.href?.split('/watch/').at(-1)?.split('?').at(0) || null;
  } catch {
    return null;
  }
}

/**
 * Normalize title for comparison
 */
function normalizeTitle(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate string similarity (simple Jaccard-like)
 */
function similarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(a.split(' '));
  const wordsB = new Set(b.split(' '));
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.size / union.size;
}

/**
 * Get anime title from anikai.to
 */
async function getAnikaiTitle(anikaiId) {
  try {
    const response = await fetchWithTimeout(`${ANIKAI_BASE_URL}/watch/${anikaiId}`, {
      headers: { ...FETCH_HEADERS, 'Referer': ANIKAI_BASE_URL + '/' }
    });
    if (!response.ok) return null;
    
    const html = await response.text();
    const $ = load(html);
    
    // Try multiple selectors
    return $('.ani_watch-detail .film-name').first().text().trim() ||
           $('.film-name').first().text().trim() ||
           $('h1.film-name').first().text().trim() ||
           $('title').text().replace(/[-|].*$/, '').trim() ||
           null;
  } catch {
    return null;
  }
}

/**
 * Get anime title from kaido.to
 */
async function getKaidoTitle(kaidoId) {
  try {
    const response = await fetchWithTimeout(`${KAIDO_BASE_URL}/watch/${kaidoId}`, {
      headers: { ...FETCH_HEADERS, 'Referer': KAIDO_BASE_URL + '/' }
    });
    if (!response.ok) return null;
    
    const html = await response.text();
    const $ = load(html);
    
    return $('.ani_watch-detail .film-name').first().text().trim() ||
           $('.film-name').first().text().trim() ||
           $('h1.film-name').first().text().trim() ||
           $('title').text().replace(/[-|].*$/, '').trim() ||
           null;
  } catch {
    return null;
  }
}

/**
 * Validate if an ID exists on kaido.to
 */
async function validateKaidoId(id) {
  try {
    const response = await fetchWithTimeout(`${KAIDO_BASE_URL}/watch/${id}`, {
      headers: { ...FETCH_HEADERS, 'Referer': KAIDO_BASE_URL + '/' },
      method: 'HEAD'
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Validate if an ID exists on anikai.to
 */
async function validateAnikaiId(id) {
  try {
    const response = await fetchWithTimeout(`${ANIKAI_BASE_URL}/watch/${id}`, {
      headers: { ...FETCH_HEADERS, 'Referer': ANIKAI_BASE_URL + '/' },
      method: 'HEAD'
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Clear the ID cache
 */
export function clearIdCache() {
  idCache.clear();
}

/**
 * Get cache size
 */
export function getCacheSize() {
  return idCache.size;
}
