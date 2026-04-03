const preferredBaseUrl = process.env.HIANIME_BASE_URL?.trim();
const fallbackBaseUrls = ['https://anikai.to', 'https://kaido.to', 'https://hianimez.to', 'https://hianime.to'];

const baseurls = [...new Set([preferredBaseUrl, ...fallbackBaseUrls].filter(Boolean))];

const config = {
  baseurl: baseurls[0],
  baseurls,
  headers: {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0',
  },
};
export default config;
