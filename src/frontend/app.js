const API_BASE = '/api/v1';

const els = {
  requestUrl: document.querySelector('#request-url'),
  requestStatus: document.querySelector('#request-status'),
  responseViewer: document.querySelector('#response-viewer'),
  searchForm: document.querySelector('#search-form'),
  searchKeyword: document.querySelector('#search-keyword'),
  searchPage: document.querySelector('#search-page'),
  searchResults: document.querySelector('#search-results'),
  animeForm: document.querySelector('#anime-form'),
  animeId: document.querySelector('#anime-id'),
  animeSummary: document.querySelector('#anime-summary'),
  episodeResults: document.querySelector('#episode-results'),
  streamForm: document.querySelector('#stream-form'),
  episodeId: document.querySelector('#episode-id'),
  serverName: document.querySelector('#server-name'),
  streamType: document.querySelector('#stream-type'),
  loadServers: document.querySelector('#load-servers'),
  serverResults: document.querySelector('#server-results'),
  streamPreview: document.querySelector('#stream-preview'),
  streamEmbed: document.querySelector('#stream-embed'),
  streamLinks: document.querySelector('#stream-links'),
};

let activeEpisodeId = '';
let activeServerKey = '';
let activeHls = null;

function setStatus(label, tone = '') {
  els.requestStatus.textContent = label;
  els.requestStatus.className = `status-pill ${tone}`.trim();
}

function setResponse(url, payload) {
  els.requestUrl.textContent = url;
  els.responseViewer.textContent = JSON.stringify(payload, null, 2);
}

function extractArray(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.animes)) return payload.data.animes;
  return [];
}

function readTitle(item) {
  return (
    item?.name ||
    item?.title ||
    item?.jname ||
    item?.englishTitle ||
    item?.alternativeTitle ||
    'Untitled'
  );
}

function readImage(item) {
  return item?.poster || item?.image || item?.img || item?.cover || '';
}

function readId(item) {
  return item?.id || item?.animeId || item?.episodeId || '';
}

function clearVideoPreview() {
  if (activeHls) {
    activeHls.destroy();
    activeHls = null;
  }

  els.streamPreview.pause();
  els.streamPreview.removeAttribute('src');
  els.streamPreview.load();
}

function attachVideoSource(url, type) {
  clearVideoPreview();

  if (type === 'm3u8' && window.Hls?.isSupported()) {
    activeHls = new window.Hls();
    activeHls.loadSource(url);
    activeHls.attachMedia(els.streamPreview);
    activeHls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      els.streamPreview.play().catch(() => {});
    });
    return;
  }

  els.streamPreview.src = url;
  els.streamPreview.load();
}

async function apiGet(path) {
  const url = `${API_BASE}${path}`;
  setStatus('Loading');
  try {
    const response = await fetch(url);
    const payload = await response.json();
    setResponse(url, payload);
    setStatus(
      `${response.status} ${response.ok ? 'OK' : 'Error'}`,
      response.ok ? 'status-ok' : 'status-error'
    );
    if (!response.ok) {
      throw new Error(payload?.message || 'Request failed');
    }
    return payload;
  } catch (error) {
    setStatus('Request failed', 'status-error');
    throw error;
  }
}

function renderSearchResults(items) {
  if (!items.length) {
    els.searchResults.innerHTML = '<p class="empty-state">No results returned.</p>';
    return;
  }

  els.searchResults.innerHTML = items
    .map((item) => {
      const image = readImage(item);
      const id = readId(item);
      const title = readTitle(item);
      const subtitle = [
        item?.type,
        item?.episodes?.sub ? `${item.episodes.sub} eps` : '',
        item?.duration,
      ]
        .filter(Boolean)
        .join(' | ');

      return `
        <button class="result-card" data-anime-id="${id}" type="button">
          ${
            image
              ? `<img src="${image}" alt="${title}" loading="lazy" />`
              : '<div class="poster-fallback">No image</div>'
          }
          <h3>${title}</h3>
          <p class="anime-subtext">${subtitle || id}</p>
        </button>
      `;
    })
    .join('');

  els.searchResults.querySelectorAll('[data-anime-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const id = button.getAttribute('data-anime-id');
      els.animeId.value = id;
      await loadAnime(id);
    });
  });
}

function renderAnimeSummary(item) {
  if (!item) {
    els.animeSummary.className = 'summary-card is-empty';
    els.animeSummary.textContent = 'No anime details available.';
    return;
  }

  const genres = Array.isArray(item.genres)
    ? item.genres
        .map((genre) => genre?.name || genre?.id || genre)
        .filter(Boolean)
        .slice(0, 6)
        .join(', ')
    : '';

  els.animeSummary.className = 'summary-card';
  els.animeSummary.innerHTML = `
    <h3>${readTitle(item)}</h3>
    <p class="summary-meta">${[item.type, item.status, item.rating, item.duration]
      .filter(Boolean)
      .join(' | ')}</p>
    <p>${item.synopsis || 'No synopsis returned.'}</p>
    <p class="anime-subtext"><strong>ID:</strong> ${item.id || 'n/a'}</p>
    <p class="anime-subtext"><strong>Genres:</strong> ${genres || 'n/a'}</p>
  `;
}

function renderEpisodes(episodes) {
  if (!episodes.length) {
    els.episodeResults.className = 'episode-list empty-state';
    els.episodeResults.textContent = 'No episodes returned.';
    return;
  }

  els.episodeResults.className = 'episode-list';
  els.episodeResults.innerHTML = episodes
    .map((episode) => {
      const episodeNumber = episode?.episodeNumber || '?';
      const activeClass = episode.id === activeEpisodeId ? 'is-active' : '';
      return `<button class="episode-chip ${activeClass}" data-episode-id="${episode.id}" type="button">Episode ${episodeNumber}</button>`;
    })
    .join('');

  els.episodeResults.querySelectorAll('[data-episode-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      activeEpisodeId = button.getAttribute('data-episode-id');
      els.episodeId.value = activeEpisodeId;
      renderEpisodes(episodes);
      await loadServers(activeEpisodeId);
    });
  });
}

function renderServers(payload) {
  const sub = payload?.data?.sub || [];
  const dub = payload?.data?.dub || [];
  const servers = [...sub, ...dub];

  if (!servers.length) {
    els.serverResults.className = 'server-list empty-state';
    els.serverResults.textContent = 'No servers returned.';
    return;
  }

  els.serverResults.className = 'server-list';
  els.serverResults.innerHTML = servers
    .map((server) => {
      const activeClass =
        server.name === activeServerKey && server.type === els.streamType.value
          ? 'is-active'
          : '';
      return `
        <button
          class="server-chip ${activeClass}"
          data-server-name="${server.name}"
          data-server-type="${server.type}"
          type="button"
        >
          ${server.name}<small>${server.type}</small>
        </button>
      `;
    })
    .join('');

  els.serverResults.querySelectorAll('[data-server-name]').forEach((button) => {
    button.addEventListener('click', async () => {
      activeServerKey = button.getAttribute('data-server-name');
      els.serverName.value = activeServerKey;
      els.streamType.value = button.getAttribute('data-server-type');
      await loadStream();
    });
  });
}

function renderStream(payload) {
  const streams = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : [];
  const primary = streams[0]?.link?.file || '';
  const primaryType = streams[0]?.link?.type || '';

  if (primary && primaryType !== 'embed') {
    els.streamEmbed.classList.add('is-hidden');
    els.streamEmbed.removeAttribute('src');
    els.streamPreview.classList.remove('is-hidden');
    attachVideoSource(primary, primaryType);
  } else if (primary) {
    clearVideoPreview();
    els.streamPreview.classList.add('is-hidden');
    els.streamEmbed.classList.remove('is-hidden');
    els.streamEmbed.src = primary;
  } else {
    clearVideoPreview();
    els.streamPreview.classList.remove('is-hidden');
    els.streamEmbed.classList.add('is-hidden');
    els.streamEmbed.removeAttribute('src');
  }

  els.streamLinks.innerHTML = streams.length
    ? streams
        .map(
          (item) =>
            `<a class="stream-link" href="${item.link.file}" target="_blank" rel="noreferrer">${item.server} ${item.type}${item.link.type === 'embed' ? ' embed' : ''}</a>`
        )
        .join('')
    : '<p class="empty-state">No stream links returned.</p>';
}

async function loadSearch(keyword = els.searchKeyword.value.trim(), page = els.searchPage.value) {
  const encodedKeyword = encodeURIComponent(keyword).replace(/%20/g, '+');
  const payload = await apiGet(`/search?keyword=${encodedKeyword}&page=${page || 1}`);
  renderSearchResults(extractArray(payload));
}

async function loadAnime(id = els.animeId.value.trim()) {
  const payload = await apiGet(`/anime/${id}`);
  renderAnimeSummary(payload?.data);

  try {
    const episodesPayload = await apiGet(`/episodes/${id}`);
    renderEpisodes(extractArray(episodesPayload));
  } catch {
    renderEpisodes([]);
  }
}

async function loadServers(episodeId = els.episodeId.value.trim()) {
  if (!episodeId) return;
  const payload = await apiGet(`/servers/${episodeId}`);
  renderServers(payload);
}

async function loadStream() {
  const episodeId = els.episodeId.value.trim();
  const server = els.serverName.value;
  const type = els.streamType.value;

  if (!episodeId) return;

  activeServerKey = server;
  const payload = await apiGet(
    `/stream?id=${encodeURIComponent(episodeId)}&server=${encodeURIComponent(server)}&type=${encodeURIComponent(type)}`
  );
  renderStream(payload);
}

document.querySelectorAll('[data-path]').forEach((button) => {
  button.addEventListener('click', async () => {
    const path = button.getAttribute('data-path');
    const payload = await apiGet(path);
    if (path.startsWith('/search')) {
      renderSearchResults(extractArray(payload));
    }
  });
});

els.searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await loadSearch();
});

els.animeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await loadAnime();
});

els.loadServers.addEventListener('click', async () => {
  await loadServers();
});

els.streamForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await loadStream();
});

loadSearch().catch(() => {});
apiGet('/home').catch(() => {});
