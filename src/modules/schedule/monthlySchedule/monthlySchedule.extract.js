import { load } from 'cheerio';

export default function monthlyScheduleExtract(html) {
  const $ = load(html);

  const response = [];
  $('a').each((i, element) => {
    const obj = {
      title: null,
      alternativeTitle: null,
      id: null,
      time: null,
      episode: null,
    };

    const el = $(element);
    const href = el.attr('href');
    const filmName = el.find('.film-name');
    const title = filmName.text().trim();
    const altTitle = filmName.attr('data-jname');
    const playText = el.find('.btn-play').text().trim();

    if (!href || !title) {
      return;
    }

    obj.id = href.replace(/^\//, '') || null;
    obj.time = el.find('.time').text() || null;
    obj.title = title || null;
    obj.alternativeTitle = altTitle ? altTitle.trim() : null;

    const episodeValue = playText.split('Episode ').pop();
    obj.episode = Number(episodeValue) || null;

    response.push(obj);
  });
  return response;
}
