import { commonAnimeObj, episodeObj } from '@/utils/commonAnimeObj';
import { load } from 'cheerio';

export default function exploreExtract(html) {
  const $ = load(html);

  const response = [];
  const legacyItems = $('.flw-item');
  const anikaiItems = $('.aitem-wrapper .aitem');
  const hasData = legacyItems.length ? legacyItems : anikaiItems;
  if (hasData.length < 1) {
    return {
      pageInfo: {
        currentPage: 1,
        hasNextPage: false,
        totalPages: 1,
      },
      response: [],
    };
  }

  const extractLegacyCard = (el) => {
    const obj = {
      ...commonAnimeObj(),
      ...episodeObj(),
      type: null,
      duration: null,
    };

    obj.poster = $(el).find('.film-poster .film-poster-img').attr('data-src');
    obj.episodes.sub = Number($(el).find('.film-poster .tick .tick-sub').text());
    obj.episodes.dub = Number($(el).find('.film-poster .tick .tick-dub').text());

    const epsEl = $(el).find('.film-poster .tick .tick-eps').length
      ? $(el).find('.film-poster .tick .tick-eps').text()
      : $(el).find('.film-poster .tick .tick-sub').text();
    obj.episodes.eps = Number(epsEl);

    const titleEL = $(el).find('.film-detail .film-name .dynamic-name');

    obj.title = titleEL.text();
    obj.alternativeTitle = titleEL.attr('data-jname');
    const idEl = titleEL.attr('href').split('/').at(-1);
    obj.id = idEl.includes('?ref=') ? idEl.split('?')[0] : idEl;

    obj.type = $(el).find('.fd-infor .fdi-item').first().text();
    obj.duration = $(el).find('.fd-infor .fdi-duration').text();

    response.push(obj);
  };

  const extractAnikaiCard = (el) => {
    const obj = {
      ...commonAnimeObj(),
      ...episodeObj(),
      type: null,
      duration: null,
    };

    obj.poster = $(el).find('.poster img').attr('data-src') || $(el).find('.poster img').attr('src');
    obj.episodes.sub = Number($(el).find('.info .sub').text().trim()) || 0;
    obj.episodes.dub = Number($(el).find('.info .dub').text().trim()) || 0;

    const infoValues = $(el)
      .find('.info span b')
      .map((_, item) => $(item).text().trim())
      .get()
      .filter(Boolean);

    obj.episodes.eps = Number(infoValues[0]) || obj.episodes.sub || obj.episodes.dub || 0;
    obj.type = infoValues.at(-1) || null;

    const titleEl = $(el).find('.title');
    obj.title = titleEl.text().trim();
    obj.alternativeTitle = titleEl.attr('data-jp') || obj.title;

    const href =
      $(el).find('a.poster').attr('href') ||
      $(el).find('a.title').attr('href') ||
      '';

    obj.id = href.split('/').at(-1) || null;

    response.push(obj);
  };

  if (legacyItems.length) {
    $('.block_area-content.block_area-list.film_list .film_list-wrap .flw-item').each((i, el) =>
      extractLegacyCard(el)
    );
  } else {
    anikaiItems.each((i, el) => extractAnikaiCard(el));
  }

  const paginationEl = $('.pre-pagination .pagination .page-item, nav.navigation .pagination .page-item');

  let currentPage, hasNextPage, totalPages;
  if (!paginationEl.length) {
    currentPage = 1;
    hasNextPage = false;
    totalPages = 1;
  } else {
    currentPage =
      Number($('.pagination .page-item.active .page-link').text()) ||
      Number($('.pagination .page-item.active').text()) ||
      1;

    const pageNumbers = paginationEl
      .map((_, el) => {
        const href = $(el).find('.page-link').attr('href');
        const text = $(el).text().trim();
        const fromHref = href ? Number(new URL(href).searchParams.get('page')) : NaN;
        const fromText = Number(text);
        return Number.isFinite(fromHref) && fromHref > 0 ? fromHref : fromText;
      })
      .get()
      .filter((value) => Number.isFinite(value) && value > 0);

    totalPages = pageNumbers.length ? Math.max(...pageNumbers) : currentPage;
    hasNextPage = paginationEl.find('[rel="next"]').length > 0 || currentPage < totalPages;
  }

  const pageInfo = {
    totalPages,
    currentPage,
    hasNextPage,
  };
  return { pageInfo, response };
}
