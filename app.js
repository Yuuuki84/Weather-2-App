// ===================================================
//  Luna & Elma 天気 & ニュースアプリ  —  app.js
//  天気: OpenWeatherMap  |  ニュース: Yahoo Japan RSS + rss2json  |  犬の写真: Dog CEO API
// ===================================================

// ===== APIキー =====
// キーは config.js で定義されています（.gitignore により非公開）
// WEATHER_API_KEY / GEMINI_API_KEY

// ===== 保存キー =====
const LS = {
  theme:     'sora_theme',
  unit:      'sora_unit',
  history:   'sora_history',
  favorites: 'sora_favorites',
  category:  'sora_news_category',
  chat:      'sora_chat_history',
  volume:    'sora_volume',
  newsRead:  'sora_news_read',
  bookmarks: 'sora_bookmarks',
  notif:     'sora_notif',
  fontSize:  'sora_font_size',
};

// ===== 人気都市（オートコンプリート候補） =====
const POPULAR_CITIES = [
  '東京', '大阪', '京都', '福岡', '札幌', '名古屋', '仙台', '広島', '神戸', '横浜',
  '和歌山', '奈良', '金沢', '那覇', '長崎', '熊本', '新潟', '静岡',
  'Tokyo', 'Osaka', 'London', 'New York', 'Paris', 'Sydney', 'Seoul', 'Beijing',
  'Bangkok', 'Singapore', 'Dubai', 'Los Angeles', 'Berlin', 'Toronto',
];

// ===== DOM要素 =====
const cityInput       = document.getElementById('city-input');
const searchBtn       = document.getElementById('search-btn');
const geoBtn          = document.getElementById('geo-btn');
const unitSelect      = document.getElementById('unit-select');
const themeBtn        = document.getElementById('theme-btn');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const historyBox      = document.getElementById('history');
const statusBar       = document.getElementById('status');
const statusText      = document.getElementById('status-text');
const errorBar        = document.getElementById('error-msg');
const errorText       = document.getElementById('error-text');
const weatherResult   = document.getElementById('weather-result');
const acBox           = document.getElementById('ac-box');
const newsContainer   = document.getElementById('news-container');
const newsTabs        = document.getElementById('news-tabs');
const particleCanvas  = document.getElementById('particle-canvas');

// ===== 状態 =====
let currentCategory = 'general';
let particles       = [];
let particleAnim    = null;
let pCtx            = null;
let lastCoords        = null; // { lat, lon }
let _cachedGeo        = null; // オートコンプリートで選択した lat/lon キャッシュ
let currentWeatherData = null;
let currentCity       = '';
let chartInstance     = null;
let leafletMap        = null;
let mapOverlayLayer   = null;
let mapMarker         = null;
let notificationsEnabled = false;
let lastNotifiedKey   = '';
let autoRefreshTimer  = null;
const AUTO_REFRESH_MS = 10 * 60 * 1000; // 10分

// ===== ユーティリティ =====
// iOS 15 以前では AbortSignal.timeout() 未対応のため互換ラッパーを使用
function timeoutSignal(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

function setLoading(on, text = '読み込み中...') {
  statusBar.classList.toggle('show', on);
  statusText.textContent = text;
  searchBtn.disabled = on;
  geoBtn.disabled    = on;
}
function showError(msg, retryable = true) {
  errorBar.classList.add('show');
  errorText.textContent = msg;
  const retryBtn = document.getElementById('error-retry-btn');
  if (retryBtn) retryBtn.style.display = retryable ? '' : 'none';
}
function clearError() {
  errorBar.classList.remove('show');
  const retryBtn = document.getElementById('error-retry-btn');
  if (retryBtn) retryBtn.style.display = 'none';
}
let _countdownTimer = null;
function showError429(seconds) {
  if (_countdownTimer) clearInterval(_countdownTimer);
  clearError();
  errorBar.classList.add('show');
  let remaining = seconds;
  const update = () => {
    errorText.innerHTML = 'APIリクエスト制限中です。<span class="countdown">' + remaining + '秒</span>後に再試行できます。';
    if (remaining-- <= 0) {
      clearInterval(_countdownTimer);
      _countdownTimer = null;
      errorBar.classList.remove('show');
    }
  };
  update();
  _countdownTimer = setInterval(update, 1000);
}
function showResult(on) {
  weatherResult.classList.toggle('show', on);
  weatherResult.style.display = on ? 'block' : 'none';
}
function showWeatherSkeleton() {
  weatherResult.classList.add('show', 'skeleton-loading');
}
function hideWeatherSkeleton() {
  weatherResult.classList.remove('skeleton-loading');
}
function safeText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function safeHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}
function unixToTime(unix, offset = 0) {
  const d = new Date((unix + offset) * 1000);
  return String(d.getUTCHours()).padStart(2,'0') + ':' + String(d.getUTCMinutes()).padStart(2,'0');
}
function degToDir(deg) {
  const d = ['北','北北東','北東','東北東','東','東南東','南東','南南東','南','南南西','南西','西南西','西','西北西','北西','北北西'];
  return d[Math.round(deg / 22.5) % 16];
}
function fmtTemp(v, unit) {
  if (v == null || isNaN(v)) return '—';
  return Math.round(v) + (unit === 'imperial' ? '℉' : '℃');
}
function fmtWind(v, unit) {
  if (v == null) return '—';
  return v + ' ' + (unit === 'imperial' ? 'mph' : 'm/s');
}
function fmtVis(m) {
  if (m == null) return '—';
  return m >= 1000 ? (m/1000).toFixed(1) + ' km' : m + ' m';
}
function fmtPct(p)  { return p == null ? '—' : p + '%'; }
function fmtHpa(h)  { return h == null ? '—' : h + ' hPa'; }
function tempColorStyle(tempVal, unit) {
  if (tempVal == null) return '';
  const c = unit === 'imperial' ? (tempVal - 32) * 5/9 : tempVal;
  const col = c <= 10 ? '#60a5fa' : c >= 20 ? '#fb923c' : '';
  return col ? ' style="color:' + col + ';"' : '';
}

async function fetchJson(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res  = await fetch(url, { signal: ctrl.signal });
    if (res.status === 429) {
      return { ok: false, status: 429, data: null };
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(t);
  }
}

// ===== テーマ =====
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(LS.theme, theme);
  themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  sbSaveSettings({ theme: next });
}

// ===== 単位 =====
function applyUnit(u) {
  unitSelect.value = u;
  localStorage.setItem(LS.unit, u);
}

// ===== 履歴 =====
function loadHistory() {
  try { const r = JSON.parse(localStorage.getItem(LS.history)||'[]'); return Array.isArray(r)?r:[]; }
  catch { return []; }
}
function saveHistory(city) {
  const c = city.trim(); if (!c) return;
  const next = [c, ...loadHistory().filter(x=>x!==c)].slice(0,8);
  localStorage.setItem(LS.history, JSON.stringify(next));
  renderHistory();
  // クラウド同期（ログイン中のみ）
  if (sbCurrentUser()) sbSaveSettings({ search_history: next });
}
function clearHistory() { localStorage.removeItem(LS.history); renderHistory(); }
function deleteHistoryItem(city) {
  const next = loadHistory().filter(x => x !== city);
  localStorage.setItem(LS.history, JSON.stringify(next));
  renderHistory();
}
function renderHistory() {
  historyBox.innerHTML = '';
  loadHistory().forEach(name => {
    const wrap = document.createElement('span');
    wrap.className = 'chip-wrap';
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = name;
    b.addEventListener('click', () => { cityInput.value = name; getWeatherByCity(name); });
    const del = document.createElement('button');
    del.className = 'chip-del'; del.textContent = '×'; del.title = '履歴から削除';
    del.addEventListener('click', e => { e.stopPropagation(); deleteHistoryItem(name); });
    wrap.appendChild(b); wrap.appendChild(del);
    historyBox.appendChild(wrap);
  });
}

// ===== お気に入り =====
function loadFavorites() {
  try { const r = JSON.parse(localStorage.getItem(LS.favorites)||'[]'); return Array.isArray(r)?r:[]; }
  catch { return []; }
}
function toggleFavorite(city) {
  const favs = loadFavorites();
  const idx  = favs.indexOf(city);
  if (idx >= 0) favs.splice(idx, 1);
  else { favs.unshift(city); if (favs.length > 10) favs.pop(); }
  localStorage.setItem(LS.favorites, JSON.stringify(favs));
  sbSaveSettings({ favorites: favs });
  renderFavorites();
  updateFavBtn(city);
}

// ===== ニュースブックマーク =====
function loadBookmarks() {
  try { const r = JSON.parse(localStorage.getItem(LS.bookmarks) || '[]'); return Array.isArray(r) ? r : []; }
  catch { return []; }
}
function isBookmarked(url) {
  return loadBookmarks().some(b => b.url === url);
}
function toggleBookmark(article) {
  const bmarks = loadBookmarks();
  const idx = bmarks.findIndex(b => b.url === article.url);
  if (idx >= 0) bmarks.splice(idx, 1);
  else { bmarks.unshift({ url: article.url, title: article.title, source: article.source || '', publishedAt: article.publishedAt || '', image: article.image || '' }); if (bmarks.length > 50) bmarks.pop(); }
  localStorage.setItem(LS.bookmarks, JSON.stringify(bmarks));
  sbSaveSettings({ news_bookmarks: bmarks });
}
function renderFavorites() {
  const section = document.getElementById('favorites-section');
  const box     = document.getElementById('favorites-box');
  if (!section || !box) return;
  const favs = loadFavorites();
  if (!favs.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  box.innerHTML = '';
  favs.forEach(name => {
    const b = document.createElement('button');
    b.className = 'chip fav-chip';
    b.textContent = '⭐ ' + name;
    b.addEventListener('click', () => { cityInput.value = name; getWeatherByCity(name); });
    box.appendChild(b);
  });
  renderFavWeatherDashboard();
}

async function renderFavWeatherDashboard() {
  const favs    = loadFavorites();
  const section = document.getElementById('fav-weather-section');
  const grid    = document.getElementById('fav-weather-grid');
  if (!section || !grid) return;
  if (!favs.length || typeof WEATHER_API_KEY === 'undefined' || !WEATHER_API_KEY) {
    section.style.display = 'none';
    return;
  }
  section.style.display = '';
  // スケルトン表示
  grid.innerHTML = favs.map(() => '<div class="fav-weather-card skeleton"></div>').join('');

  const results = await Promise.all(favs.map(city =>
    fetchJson(
      'https://api.openweathermap.org/data/2.5/weather?q=' + encodeURIComponent(buildGeoQuery(city)) +
      '&appid=' + WEATHER_API_KEY + '&units=metric&lang=ja'
    ).catch(() => ({ ok: false }))
  ));

  grid.innerHTML = '';
  results.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'fav-weather-card';
    if (!r.ok || !r.data) {
      card.innerHTML =
        '<div class="fwc-city">' + favs[i] + '</div>' +
        '<div class="fwc-err">取得失敗</div>';
    } else {
      const d    = r.data;
      const icon = d.weather?.[0]?.icon || '01d';
      const temp = Math.round(d.main?.temp ?? 0);
      const desc = d.weather?.[0]?.description ?? '';
      card.innerHTML =
        '<div class="fwc-city">' + (d.name || favs[i]) + '</div>' +
        '<img class="fwc-icon" src="https://openweathermap.org/img/wn/' + icon + '@2x.png" alt="' + desc + '" loading="lazy">' +
        '<div class="fwc-temp">' + temp + '°</div>' +
        '<div class="fwc-desc">' + desc + '</div>';
    }
    card.addEventListener('click', () => { cityInput.value = favs[i]; getWeatherByCity(favs[i]); });
    grid.appendChild(card);
  });
}
function updateFavBtn(city) {
  const btn = document.getElementById('fav-btn');
  if (!btn) return;
  const isFav = loadFavorites().includes(city);
  btn.textContent = isFav ? '⭐' : '☆';
  btn.title = isFav ? 'お気に入りから削除' : 'お気に入りに追加';
}

// ===== URL共有 =====
function setShareLink(city) {
  const u = new URL(location.href);
  u.searchParams.set('city', city);
  const el = document.getElementById('share-link');
  if (el) el.href = u.toString();
}

// ===== AQI 大気質指数 =====
const AQI_LABELS = ['', '良好', '良い', '普通', '悪い', '非常に悪い'];
const AQI_CLASSES = ['', 'aqi-1', 'aqi-2', 'aqi-3', 'aqi-4', 'aqi-5'];

async function fetchAndRenderAQI(lat, lon) {
  const card = document.getElementById('aqi-card');
  const valEl = document.getElementById('aqi-value');
  const lblEl = document.getElementById('aqi-label');
  if (!card) return;
  try {
    const r = await fetchJson(
      'https://api.openweathermap.org/data/2.5/air_pollution?lat=' + lat + '&lon=' + lon + '&appid=' + WEATHER_API_KEY,
      10000
    );
    if (!r.ok || !r.data?.list?.length) { card.style.display = 'none'; return; }
    const aqi = r.data.list[0].main.aqi; // 1-5
    const components = r.data.list[0].components;
    valEl.textContent = aqi;
    valEl.className = 'kv-value ' + (AQI_CLASSES[aqi] || '');
    lblEl.textContent = (AQI_LABELS[aqi] || '—') +
      (components?.pm2_5 != null ? '  PM2.5: ' + components.pm2_5.toFixed(1) + ' μg/m³' : '');
    card.style.display = '';
  } catch { card.style.display = 'none'; }
}

// ===== Open-Meteo フォールバック天気プロバイダー =====
const OM_WMO_MAP = {
  0:'晴れ',1:'おおむね晴れ',2:'一部曇り',3:'曇り',
  45:'霧',48:'着氷性の霧',51:'霧雨(弱)',53:'霧雨',55:'霧雨(強)',
  61:'雨(弱)',63:'雨',65:'雨(強)',71:'雪(弱)',73:'雪',75:'雪(強)',
  80:'にわか雨(弱)',81:'にわか雨',82:'にわか雨(強)',
  95:'雷雨',96:'雹を伴う雷雨',99:'強い雹を伴う雷雨'
};
const OM_WMO_ICON = {
  0:'01d',1:'01d',2:'02d',3:'04d',45:'50d',48:'50d',
  51:'09d',53:'09d',55:'09d',61:'10d',63:'10d',65:'10d',
  71:'13d',73:'13d',75:'13d',80:'09d',81:'09d',82:'09d',
  95:'11d',96:'11d',99:'11d'
};

async function fetchWeatherOpenMeteo(lat, lon, unit) {
  try {
    const tempUnit = unit === 'imperial' ? 'fahrenheit' : 'celsius';
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m' +
      '&temperature_unit=' + tempUnit + '&wind_speed_unit=ms&timezone=auto';
    const r = await fetchJson(url, 12000);
    if (!r.ok || !r.data?.current) return null;
    const c = r.data.current;
    const wmo = c.weather_code ?? 0;
    return {
      name: '(フォールバック)',
      sys: { country: '', sunrise: null, sunset: null },
      coord: { lat, lon },
      weather: [{ description: OM_WMO_MAP[wmo] || '—', icon: OM_WMO_ICON[wmo] || '01d' }],
      main: {
        temp: c.temperature_2m, feels_like: c.apparent_temperature,
        temp_min: c.temperature_2m, temp_max: c.temperature_2m,
        humidity: c.relative_humidity_2m, pressure: c.surface_pressure
      },
      wind: { speed: c.wind_speed_10m, deg: c.wind_direction_10m },
      rain: c.precipitation > 0 ? { '1h': c.precipitation } : undefined,
      snow: undefined,
      clouds: { all: 0 },
      dt: Math.floor(Date.now() / 1000),
      timezone: 0,
      _isFallback: true
    };
  } catch { return null; }
}

// ===== 予報（24h・週間） =====
async function fetchAndRenderForecast(lat, lon, unit) {
  try {
    const r = await fetchJson(
      'https://api.openweathermap.org/data/2.5/forecast?lat=' + lat + '&lon=' + lon +
      '&appid=' + WEATHER_API_KEY + '&units=' + unit + '&lang=ja&cnt=40'
    );
    if (!r.ok || !r.data?.list) return;
    renderHourlyForecast(r.data, unit);
    renderWeeklyForecast(r.data, unit);
    renderTempChart(r.data, unit);
    checkRainBanner(r.data);
  } catch { /* 予報取得失敗は無視（メイン天気は表示済み） */ }
}

// ===== 雨予報バナー =====
function checkRainBanner(fd) {
  const banner = document.getElementById('rain-banner');
  if (!banner) return;
  // セッション内で閉じられていたら出さない
  if (sessionStorage.getItem('rain_banner_dismissed')) return;
  const upcoming = fd.list.slice(0, 3); // 次 ~9h
  const rainItem = upcoming.find(item => {
    const pop  = item.pop ?? 0;
    const icon = item.weather?.[0]?.icon ?? '';
    return pop >= 0.40 || icon.startsWith('09') || icon.startsWith('10') || icon.startsWith('11');
  });
  if (!rainItem) { banner.classList.remove('show'); return; }
  const tz   = fd.city?.timezone ?? 0;
  const time = unixToTime(rainItem.dt, tz);
  const pop  = Math.round((rainItem.pop ?? 0) * 100);
  const desc = rainItem.weather?.[0]?.description ?? '雨';
  const icon = rainItem.weather?.[0]?.icon ?? '';
  const emoji = icon.startsWith('11') ? '⛈' : '🌂';
  const textEl = banner.querySelector('.rain-banner-text');
  if (textEl) textEl.innerHTML =
    '<strong>' + time + '頃から' + desc + 'の予報</strong>（降水確率 ' + pop + '%）。傘をお忘れなく！';
  const iconEl = banner.querySelector('.rain-banner-icon');
  if (iconEl) iconEl.textContent = emoji;
  banner.classList.add('show');
}

function renderHourlyForecast(fd, unit) {
  const section = document.getElementById('hourly-section');
  const strip   = document.getElementById('hourly-strip');
  if (!section || !strip) return;
  const tz = fd.city?.timezone ?? 0;
  strip.innerHTML = fd.list.slice(0, 8).map(item => {
    const icon = item.weather?.[0]?.icon ?? '01d';
    const desc = item.weather?.[0]?.description ?? '';
    const pop  = item.pop ? Math.round(item.pop * 100) : 0;
    return '<div class="hourly-item">' +
      '<div class="hourly-time">' + unixToTime(item.dt, tz) + '</div>' +
      '<img src="https://openweathermap.org/img/wn/' + icon + '.png" alt="' + escHtml(desc) + '" title="' + escHtml(desc) + '">' +
      '<div class="hourly-temp"' + tempColorStyle(item.main?.temp, unit) + '>' + fmtTemp(item.main?.temp, unit) + '</div>' +
      '<div class="hourly-pop">' + (pop > 0 ? '<span class="pop-pill" style="--p:' + pop + '%">' + pop + '%</span>' : '') + '</div>' +
    '</div>';
  }).join('');
  section.style.display = 'block';
}

function renderWeeklyForecast(fd, unit) {
  const section = document.getElementById('weekly-section');
  const grid    = document.getElementById('weekly-grid');
  if (!section || !grid) return;
  const tz   = fd.city?.timezone ?? 0;
  const days = {};
  const WDAY = ['日','月','火','水','木','金','土'];
  fd.list.forEach(item => {
    const d   = new Date((item.dt + tz) * 1000);
    const key = d.getUTCFullYear() + '-' + d.getUTCMonth() + '-' + d.getUTCDate();
    if (!days[key]) {
      const label = (d.getUTCMonth()+1) + '/' + d.getUTCDate() + '（' + WDAY[d.getUTCDay()] + '）';
      days[key] = { label, temps: [], icons: [], pop: [] };
    }
    days[key].temps.push(item.main?.temp ?? 0);
    days[key].icons.push(item.weather?.[0]?.icon ?? '01d');
    days[key].pop.push(item.pop ?? 0);
  });
  const dayValues = Object.values(days).slice(0, 6);
  grid.innerHTML = dayValues.map((d, i) => {
    const maxT  = Math.max(...d.temps);
    const minT  = Math.min(...d.temps);
    const avgT  = d.temps.reduce((s, v) => s + v, 0) / d.temps.length;
    const icon  = d.icons[Math.floor(d.icons.length / 2)] || d.icons[0];
    const maxPop = Math.round(Math.max(...d.pop) * 100);
    const tUnit = unit === 'imperial' ? '℉' : '℃';
    // 前日比トレンド矢印
    let trend = '';
    if (i > 0) {
      const prevAvg = dayValues[i-1].temps.reduce((s, v) => s + v, 0) / dayValues[i-1].temps.length;
      const diff = avgT - prevAvg;
      if (diff > 1.5)       trend = '<span class="weekly-trend up">▲</span>';
      else if (diff < -1.5) trend = '<span class="weekly-trend down">▼</span>';
      else                  trend = '<span class="weekly-trend flat">→</span>';
    }
    return '<div class="weekly-card">' +
      '<div class="weekly-day">' + d.label + '</div>' +
      '<img src="https://openweathermap.org/img/wn/' + icon + '.png" alt="">' +
      '<div class="weekly-temps">' +
        '<span class="weekly-max"' + tempColorStyle(maxT, unit) + '>' + Math.round(maxT) + tUnit + '</span>' +
        trend +
        '<span class="weekly-min"' + tempColorStyle(minT, unit) + '>' + Math.round(minT) + tUnit + '</span>' +
      '</div>' +
      (maxPop > 0 ? '<div class="weekly-pop"><span class="pop-pill" style="--p:' + maxPop + '%">' + maxPop + '%</span></div>' : '') +
    '</div>';
  }).join('');
  section.style.display = 'block';
}

// ===== 気温グラフ（Chart.js） =====
function renderTempChart(fd, unit) {
  const section = document.getElementById('chart-section');
  const canvas  = document.getElementById('temp-chart');
  if (!section || !canvas || typeof Chart === 'undefined') return;
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  const items   = fd.list.slice(0, 16); // 48h
  const tz      = fd.city?.timezone ?? 0;
  const labels  = items.map(item => unixToTime(item.dt, tz));
  const temps   = items.map(item => +(item.main?.temp ?? 0).toFixed(1));
  const pops    = items.map(item => Math.round((item.pop ?? 0) * 100));
  const tUnit   = unit === 'imperial' ? '℉' : '℃';
  const isDark  = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridClr = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const txtClr  = isDark ? 'rgba(238,242,255,0.55)' : 'rgba(15,23,42,0.5)';

  chartInstance = new Chart(canvas.getContext('2d'), {
    data: {
      labels,
      datasets: [
        {
          type: 'line',
          label: '気温',
          data: temps,
          borderColor: '#818cf8',
          backgroundColor: 'rgba(99,102,241,0.12)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#818cf8',
          tension: 0.4,
          fill: true,
          yAxisID: 'yTemp',
        },
        {
          type: 'bar',
          label: '降水確率',
          data: pops,
          backgroundColor: 'rgba(59,130,246,0.22)',
          borderColor: 'rgba(59,130,246,0.45)',
          borderWidth: 1,
          yAxisID: 'yPop',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: txtClr, boxWidth: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.label === '気温'
              ? '  気温: ' + ctx.parsed.y + tUnit
              : '  降水確率: ' + ctx.parsed.y + '%',
          },
        },
      },
      scales: {
        x: {
          ticks: { color: txtClr, maxRotation: 0, maxTicksLimit: 8, font: { size: 11 } },
          grid:  { color: gridClr },
        },
        yTemp: {
          type: 'linear', position: 'left',
          ticks: { color: txtClr, callback: v => v + tUnit, font: { size: 11 } },
          grid:  { color: gridClr },
        },
        yPop: {
          type: 'linear', position: 'right',
          min: 0, max: 100,
          ticks: { color: '#60a5fa', callback: v => v + '%', font: { size: 11 } },
          grid:  { drawOnChartArea: false },
        },
      },
    },
  });
  section.style.display = 'block';
}

// ===== 雨雲レーダーマップ（Leaflet） =====
function initOrUpdateMap(lat, lon) {
  const section = document.getElementById('map-section');
  if (!section || typeof L === 'undefined') return;
  section.style.display = 'block';

  if (!leafletMap) {
    leafletMap = L.map('weather-map', { zoomControl: true }).setView([lat, lon], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(leafletMap);
    mapOverlayLayer = L.tileLayer(
      'https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=' + WEATHER_API_KEY,
      { opacity: 0.65, attribution: '© OpenWeatherMap' }
    ).addTo(leafletMap);
  } else {
    leafletMap.setView([lat, lon], 8);
  }

  if (mapMarker) { leafletMap.removeLayer(mapMarker); }
  mapMarker = L.marker([lat, lon]).addTo(leafletMap);

  setTimeout(() => leafletMap.invalidateSize(), 150);
}

function setMapLayer(layerName) {
  if (!leafletMap || !mapOverlayLayer) return;
  leafletMap.removeLayer(mapOverlayLayer);
  mapOverlayLayer = L.tileLayer(
    'https://tile.openweathermap.org/map/' + layerName + '/{z}/{x}/{y}.png?appid=' + WEATHER_API_KEY,
    { opacity: 0.65, attribution: '© OpenWeatherMap' }
  ).addTo(leafletMap);
  const legend = document.getElementById('map-temp-legend');
  if (legend) legend.style.display = layerName === 'temp_new' ? 'block' : 'none';
}

// ===== 天気アラート通知 =====
async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const p = await Notification.requestPermission();
  return p === 'granted';
}

function checkWeatherAlert(data, unit) {
  if (!notificationsEnabled || Notification.permission !== 'granted') return;
  const city  = data.name ?? '';
  const temp  = data.main?.temp;
  const tempC = unit === 'imperial' && temp != null ? (temp - 32) * 5/9 : temp;
  const icon  = data.weather?.[0]?.icon ?? '';
  const desc  = data.weather?.[0]?.description ?? '';
  const wind  = data.wind?.speed ?? 0;

  let alertTitle = '', alertBody = '';
  if (icon.startsWith('11')) {
    alertTitle = '⚡ 雷雨警報';
    alertBody  = city + 'で雷雨が発生中です。外出を控えてください。';
  } else if (tempC != null && tempC >= 35) {
    alertTitle = '🔥 高温注意報';
    alertBody  = city + 'の気温は ' + Math.round(tempC) + '℃ です。熱中症に注意！';
  } else if (tempC != null && tempC <= 0) {
    alertTitle = '❄️ 凍結注意報';
    alertBody  = city + 'の気温は ' + Math.round(tempC) + '℃ 。路面凍結に注意！';
  } else if (wind > 10) {
    alertTitle = '💨 強風注意報';
    alertBody  = city + ' で風速 ' + wind + ' m/s の強風が吹いています。';
  } else if (icon.startsWith('09') || icon.startsWith('10')) {
    alertTitle = '🌧 雨の情報';
    alertBody  = city + ' は現在 ' + desc + ' です。傘をお忘れなく！';
  }
  if (!alertTitle) return;

  const key = city + '|' + icon + '|' + Math.round(tempC ?? 0);
  if (key === lastNotifiedKey) return;
  lastNotifiedKey = key;

  new Notification(alertTitle, {
    body: alertBody,
    icon: 'https://openweathermap.org/img/wn/' + (data.weather?.[0]?.icon ?? '01d') + '@2x.png',
  });
}

// ===== 音声読み上げ（Google Cloud Text-to-Speech） =====
let ttsAudio = null; // 再生中の Audio インスタンス

function getVolume() {
  const v = parseFloat(localStorage.getItem(LS.volume));
  return isNaN(v) ? 0.8 : Math.min(1, Math.max(0, v));
}

// 音声キャッシュ（テキストをキーに base64 音声データを sessionStorage に保存）
function getTtsCache(text) {
  try { return sessionStorage.getItem('tts_' + text) || null; }
  catch { return null; }
}
function setTtsCache(text, base64) {
  try {
    // 古いキャッシュを削除して容量を節約
    Object.keys(sessionStorage)
      .filter(k => k.startsWith('tts_') && k !== 'tts_' + text)
      .forEach(k => sessionStorage.removeItem(k));
    sessionStorage.setItem('tts_' + text, base64);
  } catch { /* 容量不足時は無視 */ }
}

function buildWeatherText(data, unit) {
  const city     = data.name ?? '';
  const country  = data.sys?.country ?? '';
  const desc     = data.weather?.[0]?.description ?? '';
  const temp     = Math.round(data.main?.temp ?? 0);
  const tUnit    = unit === 'imperial' ? '華氏' : '度';
  const humid    = data.main?.humidity ?? '—';
  const wind     = data.wind?.speed ?? 0;
  const windUnit = unit === 'imperial' ? 'マイル毎時' : 'メートル毎秒';
  return city + '、' + country + 'の天気をお知らせします。' +
    '現在の天気は' + desc + 'です。' +
    '気温は' + temp + tUnit + '。' +
    '湿度' + humid + 'パーセント。' +
    '風速' + wind + windUnit + 'です。';
}

async function speakWeather() {
  const btn = document.getElementById('voice-btn');

  // 再生中なら停止（Google TTS / Web Speech API どちらも対応）
  if (ttsAudio && !ttsAudio.paused) {
    ttsAudio.pause();
    ttsAudio.currentTime = 0;
    ttsAudio = null;
    if (btn) btn.textContent = '🔊';
    return;
  }
  if (window.speechSynthesis?.speaking) {
    window.speechSynthesis.cancel();
    if (btn) btn.textContent = '🔊';
    return;
  }

  if (!currentWeatherData) return;
  if (!GOOGLE_TTS_KEY || GOOGLE_TTS_KEY === 'YOUR_GOOGLE_CLOUD_TTS_API_KEY') {
    // APIキー未設定時は Web Speech API にフォールバック
    _speakFallback();
    return;
  }

  if (btn) { btn.textContent = '🔇'; btn.disabled = true; }

  const { data, unit } = currentWeatherData;
  const text = buildWeatherText(data, unit);

  try {
    // キャッシュ確認（同一テキストなら API を叩かない）
    let audioBase64 = getTtsCache(text);
    if (audioBase64) {
      console.log('[TTS] キャッシュ使用');
    } else {
      const res = await fetch(
        'https://texttospeech.googleapis.com/v1/text:synthesize?key=' + GOOGLE_TTS_KEY,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: { text },
            voice: { languageCode: 'ja-JP', name: 'ja-JP-Neural2-B' },
            audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95 },
          }),
          signal: timeoutSignal(15000),
        }
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (!json.audioContent) throw new Error('音声データなし');
      audioBase64 = json.audioContent;
      setTtsCache(text, audioBase64);
    }

    ttsAudio = new Audio('data:audio/mp3;base64,' + audioBase64);
    ttsAudio.volume = getVolume();
    ttsAudio.onended = () => {
      ttsAudio = null;
      if (btn) { btn.textContent = '🔊'; btn.disabled = false; }
    };
    ttsAudio.onerror = () => {
      ttsAudio = null;
      if (btn) { btn.textContent = '🔊'; btn.disabled = false; }
    };
    if (btn) btn.disabled = false;
    ttsAudio.play();
  } catch(e) {
    console.error('[TTS]', e);
    if (btn) { btn.textContent = '🔊'; btn.disabled = false; }
    showError('音声の取得に失敗しました（HTTP ' + (e.message || '') + '）');
  }
}

function _speakFallback() {
  if (!window.speechSynthesis) { showError('音声読み上げに対応していません。'); return; }
  const btn = document.getElementById('voice-btn');
  if (!currentWeatherData) return;
  const { data, unit } = currentWeatherData;
  const text = buildWeatherText(data, unit);
  if (btn) btn.textContent = '🔇';
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'ja-JP';
  utt.rate = 0.9;
  utt.volume = getVolume();
  utt.onend = () => { if (btn) btn.textContent = '🔊'; };
  window.speechSynthesis.speak(utt);
}

// ===== オートコンプリート =====
// オートコンプリート用状態
let _acDebounceTimer = null;
let _acAbortCtrl = null;

function renderACItems(items, isFromApi) {
  if (!items.length) { acBox.classList.remove('show'); return; }
  acBox.innerHTML = items.map((item, i) =>
    '<div class="ac-item" data-idx="' + i + '">' +
    '<span class="ac-item-icon">' + (isFromApi ? '🔍' : '📍') + '</span>' +
    item.label + '</div>'
  ).join('');
  acBox.querySelectorAll('.ac-item').forEach((el, i) => {
    el.addEventListener('click', () => {
      acBox.classList.remove('show');
      if (items[i].lat != null) {
        // API候補: lat/lon キャッシュを使って直接天気取得
        cityInput.value = items[i].displayName;
        _cachedGeo = { lat: items[i].lat, lon: items[i].lon, name: items[i].displayName };
        getWeatherByCity(items[i].displayName);
      } else {
        cityInput.value = items[i].label;
        getWeatherByCity(items[i].label);
      }
    });
  });
  acBox.classList.add('show');
}

async function renderAC(q) {
  clearTimeout(_acDebounceTimer);
  if (!q || q.length < 1) { acBox.classList.remove('show'); return; }

  // ローカルリストで即時表示
  const localMatches = POPULAR_CITIES
    .filter(c => c.toLowerCase().startsWith(q.toLowerCase()))
    .slice(0, 5)
    .map(c => ({ label: c, displayName: c, lat: null, lon: null }));
  if (localMatches.length) renderACItems(localMatches, false);

  // 2文字以上でAPIも叩く（デバウンス300ms）
  if (q.length < 2) return;
  _acDebounceTimer = setTimeout(async () => {
    if (_acAbortCtrl) _acAbortCtrl.abort();
    _acAbortCtrl = new AbortController();
    try {
      const gq = buildGeoQuery(q);
      const url = 'https://api.openweathermap.org/geo/1.0/direct?q=' + encodeURIComponent(gq) + '&limit=5&appid=' + WEATHER_API_KEY;
      const res = await fetch(url, { signal: _acAbortCtrl.signal });
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) return;
      const apiItems = data.map(d => {
        const ja = d.local_names?.ja || d.name;
        const parts = [ja];
        if (d.state) parts.push(d.state);
        parts.push(d.country);
        return { label: parts.join(', '), displayName: ja, lat: d.lat, lon: d.lon };
      });
      renderACItems(apiItems, true);
    } catch (e) {
      if (e.name !== 'AbortError') console.warn('[AC]', e.message);
    }
  }, 300);
}

// ===== 動的背景 =====
const WX_CLASS_MAP = {
  '01': 'wx-clear',  '02': 'wx-cloudy', '03': 'wx-cloudy',
  '04': 'wx-cloudy', '09': 'wx-rain',   '10': 'wx-rain',
  '11': 'wx-thunder','13': 'wx-snow',   '50': 'wx-cloudy',
};
function setWeatherTheme(iconCode) {
  const key = iconCode ? iconCode.slice(0,2) : '';
  const cls = WX_CLASS_MAP[key] || 'wx-clear';
  Object.values(WX_CLASS_MAP).forEach(c => document.body.classList.remove(c));
  document.body.classList.add(cls);
  startParticles(cls);
}

// ===== パーティクル（雨・雪） =====
function startParticles(wxCls) {
  stopParticles();
  if (wxCls === 'wx-rain' || wxCls === 'wx-thunder') initParticles('rain');
  else if (wxCls === 'wx-snow') initParticles('snow');
}
function stopParticles() {
  if (particleAnim) { cancelAnimationFrame(particleAnim); particleAnim = null; }
  particleCanvas.style.opacity = '0';
  particles = [];
}
function initParticles(type) {
  const canvas = particleCanvas;
  pCtx = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.opacity = '0.45';
  const count = type === 'rain' ? 120 : 60;
  for (let i = 0; i < count; i++) {
    if (type === 'rain') {
      particles.push({ x: Math.random()*canvas.width, y: Math.random()*canvas.height,
        l: Math.random()*18+10, xs: Math.random()*2-1, ys: Math.random()*6+8, type:'rain' });
    } else {
      particles.push({ x: Math.random()*canvas.width, y: Math.random()*canvas.height,
        r: Math.random()*3+1, xs: Math.random()*1.5-0.75, ys: Math.random()*1.5+0.5,
        type:'snow', op: Math.random()*0.5+0.3 });
    }
  }
  animParticles();
}
function animParticles() {
  const c = particleCanvas;
  pCtx.clearRect(0, 0, c.width, c.height);
  particles.forEach(p => {
    if (p.type === 'rain') {
      pCtx.beginPath(); pCtx.moveTo(p.x, p.y); pCtx.lineTo(p.x+p.xs, p.y+p.l);
      pCtx.strokeStyle = 'rgba(174,214,255,0.45)'; pCtx.lineWidth = 1; pCtx.stroke();
      p.x += p.xs; p.y += p.ys;
      if (p.y > c.height) { p.y = -p.l; p.x = Math.random()*c.width; }
    } else {
      pCtx.beginPath(); pCtx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      pCtx.fillStyle = 'rgba(220,235,255,' + p.op + ')'; pCtx.fill();
      p.x += p.xs; p.y += p.ys;
      if (p.y > c.height) { p.y = -p.r; p.x = Math.random()*c.width; }
    }
  });
  particleAnim = requestAnimationFrame(animParticles);
}
window.addEventListener('resize', () => {
  particleCanvas.width  = window.innerWidth;
  particleCanvas.height = window.innerHeight;
});

// ===== 天気描画 =====
function renderWeather(data, unit) {
  const tz = typeof data.timezone === 'number' ? data.timezone : 0;

  safeText('city-name', data.name + '（' + (data.sys?.country ?? '—') + '）');
  safeText('observed-at', data.dt
    ? '観測：' + new Date(data.dt * 1000).toLocaleString('ja-JP') : '—');

  const icon = data.weather?.[0]?.icon;
  if (icon) {
    safeHTML('weather-icon', '<img src="https://openweathermap.org/img/wn/' + icon + '@2x.png" alt="天気" loading="lazy">');
    setWeatherTheme(icon);
  }

  const desc  = data.weather?.[0]?.description ?? '—';
  safeText('weather-desc', desc);
  const _tVal  = (data.main?.temp != null && !isNaN(data.main.temp)) ? Math.round(data.main.temp) : '—';
  const _tUnit = unit === 'imperial' ? '℉' : '℃';
  const _tempC = data.main?.temp != null ? (unit === 'imperial' ? (data.main.temp - 32) * 5/9 : data.main.temp) : null;
  const _tColor = _tempC == null ? '' : _tempC <= 10 ? '#60a5fa' : _tempC >= 20 ? '#fb923c' : '';
  const _tStyle = _tColor ? ' style="-webkit-text-fill-color:' + _tColor + ';background:none;color:' + _tColor + ';"' : '';
  safeHTML('temperature', '<span class="temp-num"' + _tStyle + '>' + _tVal + '</span><span class="temp-unit">' + _tUnit + '</span>');
  safeText('feels-like',  '体感温度 ' + fmtTemp(data.main?.feels_like, unit));
  safeText('temp-min-max','最低 ' + fmtTemp(data.main?.temp_min, unit) + ' / 最高 ' + fmtTemp(data.main?.temp_max, unit));

  safeText('humidity',   fmtPct(data.main?.humidity));
  safeText('wind-speed', fmtWind(data.wind?.speed, unit));
  const deg = data.wind?.deg;
  safeText('wind-deg', deg != null ? degToDir(deg) + ' (' + deg + '°)' : '—');
  safeText('pressure',   fmtHpa(data.main?.pressure));
  safeText('visibility', fmtVis(data.visibility));
  safeText('clouds',     fmtPct(data.clouds?.all));

  const rain = data.rain?.['1h']; const snow = data.snow?.['1h'];
  safeText('rain', rain != null ? rain + ' mm' : 'データなし');
  safeText('snow', snow != null ? snow + ' mm' : 'データなし');
  safeText('sunrise', data.sys?.sunrise ? unixToTime(data.sys.sunrise, tz) : '—');
  safeText('sunset',  data.sys?.sunset  ? unixToTime(data.sys.sunset,  tz) : '—');
  safeText('coordinates', (data.coord?.lat ?? '—') + ' / ' + (data.coord?.lon ?? '—'));

  const wind  = data.wind?.speed ?? 0;
  const humid = data.main?.humidity ?? 0;
  safeText('weather-summary-detail',
    desc + '。湿度' + humid + '%、風速' + wind + (unit==='imperial'?'mph':'m/s') + '。' +
    (rain ? '雨が降っています（' + rain + 'mm/h）。' : '') +
    (snow ? '雪が降っています（' + snow + 'mm/h）。' : '')
  );

  generateAdvice(data, unit);
  hideWeatherSkeleton();
  showResult(true);

  currentWeatherData = { data, unit };
  currentCity = data.name || '';
  updateFavBtn(currentCity);
  checkWeatherAlert(data, unit);
  _jmaWarningDismissed = false;
  fetchJMAWarnings(currentCity);

  // AI チャット
  initChatSection(data, unit);

  // Luna & Elma カード（天気連動）
  const wxKey = (icon ? icon.slice(0,2) : '');
  const wxCls = WX_CLASS_MAP[wxKey] || 'wx-cloudy';
  fetchPoodleCard(wxCls);

  // 気象庁 天気予報（日本の都市のみ）
  if (data.sys?.country === 'JP' && data.name) {
    fetchJMAForecast(data.name).then(renderJMAForecast);
  } else {
    const panel = document.getElementById('jma-panel');
    if (panel) panel.style.display = 'none';
  }

  // Supabase ログ・設定保存
  sbLog('weather_search', { city: data.name, country: data.sys?.country, unit });
  sbSaveSettings({ city: data.name });
}

// ===== 天気アドバイス =====
function generateAdvice(data, unit) {
  const temp     = data.main?.temp ?? null;
  const humidity = data.main?.humidity ?? null;
  const wind     = data.wind?.speed ?? 0;
  const clouds   = data.clouds?.all ?? 0;
  const rain1h   = data.rain?.['1h'] ?? 0;
  const snow1h   = data.snow?.['1h'] ?? 0;
  const icon     = data.weather?.[0]?.icon ?? '';
  const month    = new Date().getMonth() + 1;
  const tempC    = unit === 'imperial' && temp !== null ? (temp - 32) * 5 / 9 : temp;
  const advices  = [];

  const isRaining = rain1h > 0 || icon.startsWith('09') || icon.startsWith('10');
  const isSnowing = snow1h > 0 || icon.startsWith('13');
  const isThunder = icon.startsWith('11');
  const isClear   = icon.startsWith('01') || icon.startsWith('02');
  const isWindy   = wind > 7;

  // 1. お出かけ
  let outLabel, outText, outColor;
  if (isThunder)      { outLabel='⚠ 注意'; outColor='#ef4444'; outText='雷雨の予報です。外出は控えましょう。'; }
  else if (isSnowing) { outLabel='注意';   outColor='#60a5fa'; outText='積雪・路面凍結に注意。防寒・滑り止めを。'; }
  else if (isRaining) { outLabel='雨天';   outColor='#3b82f6'; outText='傘が必要です。足元に気をつけて。'; }
  else if (isWindy)   { outLabel='強風';   outColor='#f59e0b'; outText='風速 ' + wind + 'm/s。帽子・荷物に注意。'; }
  else if (isClear && tempC !== null && tempC >= 15 && tempC <= 28)
                       { outLabel='絶好調'; outColor='#34d399'; outText='晴れて気持ちの良い一日！お出かけ日和です。'; }
  else if (isClear)   { outLabel='晴れ';   outColor='#f59e0b'; outText='晴天ですが、気温に合わせた服装で。'; }
  else                 { outLabel='普通';   outColor='#94a3b8'; outText='特に大きな天気の崩れはありません。'; }
  advices.push({ emoji:'🚶', label:'お出かけ', badge:outLabel, text:outText, color:outColor });

  // 2. 洗濯
  let washLabel, washText, washColor;
  if (isRaining||isSnowing||isThunder) { washLabel='NG';     washColor='#ef4444'; washText='雨・雪のため外干しは避けましょう。室内干しを。'; }
  else if (clouds>70||humidity>80)     { washLabel='△ 注意'; washColor='#f59e0b'; washText='湿度' + humidity + '%・雲量' + clouds + '%。乾きにくいかも。'; }
  else if (isWindy&&isClear)           { washLabel='◎ 最適'; washColor='#34d399'; washText='風もあり乾きやすい！洗濯日和です。'; }
  else if (isClear)                    { washLabel='○ 良い'; washColor='#34d399'; washText='晴れで洗濯物がよく乾きます。'; }
  else                                 { washLabel='△ 普通'; washColor='#94a3b8'; washText='曇りがちですが外干しは可能です。'; }
  advices.push({ emoji:'👔', label:'洗濯', badge:washLabel, text:washText, color:washColor });

  // 3. 花粉
  const isPollenSeason = (month>=2&&month<=5)||(month>=8&&month<=10);
  const isPollenHigh   = isPollenSeason && isClear && isWindy;
  const isPollenMed    = isPollenSeason && (isClear || isWindy);
  let pollenLabel, pollenText, pollenColor;
  if (isRaining||isSnowing) { pollenLabel='低';     pollenColor='#34d399'; pollenText='雨・雪で花粉が少ない状態です。'; }
  else if (isPollenHigh)    { pollenLabel='多い';   pollenColor='#ef4444'; pollenText='花粉シーズン中。晴れ＋風で飛散多め。マスク推奨。'; }
  else if (isPollenMed)     { pollenLabel='やや多'; pollenColor='#f59e0b'; pollenText='花粉シーズン中。念のためマスクを。'; }
  else if (isPollenSeason)  { pollenLabel='普通';   pollenColor='#94a3b8'; pollenText='花粉シーズン中ですが飛散は少なめ。'; }
  else                      { pollenLabel='少ない'; pollenColor='#34d399'; pollenText='花粉シーズン外です。大気は良好。'; }
  advices.push({ emoji:'🌸', label:'花粉・大気', badge:pollenLabel, text:pollenText, color:pollenColor });

  // 4. 服装
  let clothLabel, clothText, clothColor;
  if (tempC===null)    { clothLabel='—';    clothColor='#94a3b8'; clothText='気温データなし。'; }
  else if (tempC>=30)  { clothLabel='猛暑'; clothColor='#ef4444'; clothText='真夏日。ノースリーブ・冷感素材推奨。熱中症に注意。'; }
  else if (tempC>=25)  { clothLabel='夏';   clothColor='#f97316'; clothText='半袖・薄着で。日焼け止めもお忘れなく。'; }
  else if (tempC>=20)  { clothLabel='快適'; clothColor='#34d399'; clothText='長袖シャツや薄手のジャケットが快適。'; }
  else if (tempC>=15)  { clothLabel='涼しめ'; clothColor='#60a5fa'; clothText='軽い上着があると安心。重ね着がおすすめ。'; }
  else if (tempC>=8)   { clothLabel='寒い'; clothColor='#818cf8'; clothText='コートやセーターが必要。しっかり防寒を。'; }
  else                  { clothLabel='極寒'; clothColor='#c084fc'; clothText='防寒必須。手袋・マフラー・厚手のコートで。'; }
  advices.push({ emoji:'👗', label:'服装', badge:clothLabel, text:clothText, color:clothColor });

  // 5. UV
  let uvLabel, uvText, uvColor;
  if (!isClear||(tempC!==null&&tempC<5)) { uvLabel='低';    uvColor='#34d399'; uvText='曇り・雨天のためUVは低め。日焼けリスク小。'; }
  else if (month>=4&&month<=9)           { uvLabel='強い';  uvColor='#ef4444'; uvText='日差しが強い季節。日焼け止め・帽子必須。'; }
  else if (isClear)                      { uvLabel='中程度'; uvColor='#f59e0b'; uvText='晴れているためUVあり。日焼け止め推奨。'; }
  else                                   { uvLabel='低';    uvColor='#34d399'; uvText='UV指数は低め。外出時は念のため対策を。'; }
  advices.push({ emoji:'☀️', label:'UV・日焼け', badge:uvLabel, text:uvText, color:uvColor });

  // 6. 体調
  let healthLabel, healthText, healthColor;
  if (tempC!==null&&tempC>=35)                    { healthLabel='危険';    healthColor='#ef4444'; healthText='危険な暑さ。水分補給を頻繁に。屋外活動は控えて。'; }
  else if (tempC!==null&&tempC>=30&&humidity>60)  { healthLabel='警戒';    healthColor='#f97316'; healthText='気温' + Math.round(tempC) + '℃・湿度' + humidity + '%。熱中症に注意。'; }
  else if (tempC!==null&&tempC<=0)                { healthLabel='凍結注意'; healthColor='#60a5fa'; healthText='氷点下。路面凍結・低体温症に注意。'; }
  else if (tempC!==null&&tempC<=5)                { healthLabel='防寒を';  healthColor='#818cf8'; healthText='気温が低いです。体を冷やさないよう注意。'; }
  else                                            { healthLabel='良好';    healthColor='#34d399'; healthText='体調管理に大きなリスクはありません。水分補給を忘れずに。'; }
  advices.push({ emoji:'💪', label:'体調・健康', badge:healthLabel, text:healthText, color:healthColor });

  renderAdvice(advices);
}

function renderAdvice(advices) {
  const section = document.getElementById('advice-section');
  const grid    = document.getElementById('advice-grid');
  if (!section || !grid) return;
  grid.innerHTML = advices.map(a =>
    '<div class="advice-card" style="--advice-color: ' + a.color + ';">' +
      '<div class="advice-icon-row">' +
        '<span class="advice-emoji">' + a.emoji + '</span>' +
        '<span class="advice-badge">' + a.badge + '</span>' +
      '</div>' +
      '<div class="advice-label">' + a.label + '</div>' +
      '<div class="advice-text">' + a.text + '</div>' +
    '</div>'
  ).join('');
  section.style.display = 'block';
}

// ===== AI チャット =====
let chatHistory = [];
let chatWeatherCtx = null;
let chatListenersAttached = false;

function saveChatHistory() {
  try { localStorage.setItem(LS.chat, JSON.stringify(chatHistory.slice(-20))); } catch {}
}
function loadChatHistory() {
  try { const s = JSON.parse(localStorage.getItem(LS.chat) || '[]'); return Array.isArray(s) ? s : []; }
  catch { return []; }
}
function clearChatHistory() {
  chatHistory = [];
  try { localStorage.removeItem(LS.chat); } catch {}
  const c = document.getElementById('chat-messages');
  if (c) c.innerHTML = '';
}

function initChatSection(data, unit) {
  const section = document.getElementById('ai-section');
  if (!section) return;

  // 天気コンテキストを保存
  const toC = v => unit === 'imperial' && v != null ? Math.round((v - 32) * 5 / 9) : Math.round(v ?? 0);
  chatWeatherCtx = {
    city: data.name ?? '',
    weather: {
      desc:   data.weather?.[0]?.description ?? '',
      temp:   toC(data.main?.temp),
      feels:  toC(data.main?.feels_like),
      humid:  data.main?.humidity ?? 0,
      wind:   data.wind?.speed ?? 0,
    },
  };

  section.style.display = 'block';

  if (!chatListenersAttached) {
    chatListenersAttached = true;
    const sendBtn  = document.getElementById('chat-send-btn');
    const input    = document.getElementById('chat-input');
    const clearBtn = document.getElementById('chat-clear-btn');
    if (sendBtn)  sendBtn.addEventListener('click', sendChatMessage);
    if (input)    input.addEventListener('keydown', e => { if (e.key === 'Enter') sendChatMessage(); });
    if (clearBtn) clearBtn.addEventListener('click', clearChatHistory);
  }

  // 保存済み履歴を復元（初回のみ）
  if (chatHistory.length === 0) {
    chatHistory = loadChatHistory();
    const container = document.getElementById('chat-messages');
    if (container && container.children.length === 0 && chatHistory.length > 0) {
      chatHistory.forEach(t => appendChatBubble(t.role === 'user' ? 'user' : 'ai', t.content));
    }
  }
}

function appendChatBubble(role, text, loading = false) {
  const container = document.getElementById('chat-messages');
  if (!container) return null;
  const div = document.createElement('div');
  div.className = 'chat-bubble ' + role + (loading ? ' loading' : '');
  if (loading) {
    div.innerHTML = '<span></span><span></span><span></span>';
  } else {
    div.textContent = text;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

async function sendChatMessage() {
  const input   = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  if (!input) return;
  const message = input.value.trim();
  if (!message) return;

  if (!CHAT_API_URL || CHAT_API_URL === 'YOUR_CHAT_WORKER_URL') {
    appendChatBubble('ai', 'チャット機能はまだ設定されていません。CHAT_API_URL を config.js に設定してください。');
    return;
  }

  input.value = '';
  if (sendBtn) sendBtn.disabled = true;
  appendChatBubble('user', message);
  const loadingBubble = appendChatBubble('ai', '', true);

  try {
    const res = await fetch(CHAT_API_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history: chatHistory.slice(-10),
        city:    chatWeatherCtx?.city,
        weather: chatWeatherCtx?.weather,
      }),
      signal: timeoutSignal(45000),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'HTTP ' + res.status);

    const reply = json.reply;
    chatHistory.push({ role: 'user',  content: message });
    chatHistory.push({ role: 'model', content: reply });
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
    saveChatHistory();

    if (loadingBubble) {
      loadingBubble.classList.remove('loading');
      loadingBubble.textContent = reply;
      const container = document.getElementById('chat-messages');
      if (container) container.scrollTop = container.scrollHeight;
    }
  } catch(e) {
    console.error('[Chat]', e);
    if (loadingBubble) {
      loadingBubble.classList.remove('loading');
      loadingBubble.classList.add('error');
      loadingBubble.textContent = '送信に失敗しました。しばらくしてから再試行してください。';
    }
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    if (input) input.focus();
  }
}

// ===== Luna & Elma 🐩 ローカル写真ランダム表示 =====
const LUNA_ELMA_PHOTOS = [
  'images/luna-elma-01.jpeg',
  'images/luna-elma-02.jpeg',
  'images/luna-elma-03.jpeg',
  'images/luna-elma-04.jpeg',
  'images/luna-elma-05.jpeg',
  'images/luna-elma-06.jpeg',
  'images/luna-elma-07.jpeg',
  'images/luna-elma-08.jpeg',
  'images/luna-elma-09.jpeg',
  'images/luna-elma-10.jpeg',
  'images/luna-elma-11.jpeg',
  'images/luna-elma-12.jpeg',
  'images/luna-elma-13.jpeg',
  'images/luna-elma-14.jpeg',
  'images/luna-elma-15.jpeg',
  'images/luna-elma-16.jpeg',
  'images/luna-elma-17.jpeg',
  'images/luna-elma-18.jpeg',
];

// 前回と違う写真をランダムに選ぶ
let lastPhotoIndex = -1;
function pickPhoto() {
  let idx;
  do { idx = Math.floor(Math.random() * LUNA_ELMA_PHOTOS.length); }
  while (idx === lastPhotoIndex && LUNA_ELMA_PHOTOS.length > 1);
  lastPhotoIndex = idx;
  return LUNA_ELMA_PHOTOS[idx];
}

// 天気に連動したメッセージ
const POODLE_MESSAGES = {
  'wx-clear':   ['お散歩日和だよ！今日も一緒に出かけよう 🌞', '晴れてるね！公園に行こうよ〜 🎾', 'いい天気！フリスビーしようよ！'],
  'wx-rain':    ['雨だから今日はおうちで一緒にまったりしよう ☔', '外は雨…室内でおもちゃ遊びにしようか 🧸', 'びしょぬれになっちゃうから今日はおうちでゴロゴロ 🛋'],
  'wx-snow':    ['雪だ！！はしゃいじゃう〜！⛄', '雪の日のお散歩もたのしいね、でも足が冷たいよ〜 🐾', 'ふわふわ雪！においが変わってる！'],
  'wx-cloudy':  ['曇ってるね、涼しくてちょうどいいかも！', '今日は散歩しやすい気温かも 🐾', 'どんよりしてるけど一緒にいるから大丈夫！'],
  'wx-thunder': ['雷こわい！そばにいてね…⚡', 'ゴロゴロって聞こえる…だっこして 🫂', '外はこわいから今日はずっとおうちにいよう'],
};

function fetchPoodleCard(wxClass) {
  const wrap = document.getElementById('poodle-card');
  if (!wrap) return;

  const msgs = POODLE_MESSAGES[wxClass] || POODLE_MESSAGES['wx-cloudy'];
  const msg  = msgs[Math.floor(Math.random() * msgs.length)];
  const photo = pickPhoto();

  wrap.style.display = 'flex';
  wrap.innerHTML =
    '<div class="poodle-img-wrap">' +
      '<img src="' + photo + '" alt="Luna & Elma" loading="lazy">' +
    '</div>' +
    '<div class="poodle-body">' +
      '<div class="poodle-names">Luna <span>&</span> Elma</div>' +
      '<div class="poodle-msg">' + msg + '</div>' +
    '</div>';
}

// 日本語都市名 → ローマ字変換テーブル（OWM は漢字クエリが不安定なため）
const JP_CITY_ROMAJI = {
  // 北海道・東北
  '札幌':'Sapporo','函館':'Hakodate','旭川':'Asahikawa','釧路':'Kushiro','帯広':'Obihiro',
  '青森':'Aomori','弘前':'Hirosaki','八戸':'Hachinohe',
  '盛岡':'Morioka','一関':'Ichinoseki',
  '仙台':'Sendai','石巻':'Ishinomaki',
  '秋田':'Akita','大館':'Odate',
  '山形':'Yamagata','鶴岡':'Tsuruoka','米沢':'Yonezawa',
  '福島':'Fukushima-shi','郡山':'Koriyama','いわき':'Iwaki',
  // 関東
  '水戸':'Mito','つくば':'Tsukuba','日立':'Hitachi',
  '宇都宮':'Utsunomiya','栃木':'Tochigi','小山':'Oyama',
  '前橋':'Maebashi','高崎':'Takasaki','太田':'Ota',
  'さいたま':'Saitama','川越':'Kawagoe','越谷':'Koshigaya','熊谷':'Kumagaya',
  '千葉':'Chiba','船橋':'Funabashi','松戸':'Matsudo','市川':'Ichikawa','柏':'Kashiwa',
  '東京':'Tokyo','新宿':'Shinjuku','渋谷':'Shibuya','池袋':'Ikebukuro',
  '横浜':'Yokohama','川崎':'Kawasaki','相模原':'Sagamihara','藤沢':'Fujisawa','横須賀':'Yokosuka',
  // 中部
  '新潟':'Niigata','長岡':'Nagaoka','上越':'Joetsu',
  '富山':'Toyama','高岡':'Takaoka',
  '金沢':'Kanazawa','小松':'Komatsu',
  '福井':'Fukui','敦賀':'Tsuruga',
  '甲府':'Kofu','富士吉田':'Fujiyoshida',
  '長野':'Nagano','松本':'Matsumoto','上田':'Ueda',
  '岐阜':'Gifu','大垣':'Ogaki','高山':'Takayama',
  '静岡':'Shizuoka','浜松':'Hamamatsu','沼津':'Numazu','富士':'Fuji',
  '名古屋':'Nagoya','豊橋':'Toyohashi','岡崎':'Okazaki','豊田':'Toyota',
  // 近畿
  '津':'Tsu','四日市':'Yokkaichi','松阪':'Matsusaka',
  '大津':'Otsu','草津':'Kusatsu','彦根':'Hikone',
  '京都':'Kyoto','宇治':'Uji','舞鶴':'Maizuru',
  '大阪':'Osaka','堺':'Sakai','東大阪':'Higashiosaka','枚方':'Hirakata',
  // 大阪市内（区名・繁華街）→ Osaka にマッピング
  '梅田':'Osaka','なんば':'Osaka','難波':'Osaka','心斎橋':'Osaka','天王寺':'Osaka',
  '難波':'Osaka','新世界':'Osaka','上本町':'Osaka','本町':'Osaka','肥後橋':'Osaka',
  '住之江区':'Osaka','阿倍野区':'Osaka','西成区':'Osaka','生野区':'Osaka',
  '東住吉区':'Osaka','平野区':'Osaka','住吉区':'Osaka','東淀川区':'Osaka',
  '淀川区':'Osaka','西淀川区':'Osaka','此花区':'Osaka','港区':'Osaka',
  '大正区':'Osaka','浪速区':'Osaka','西区':'Osaka','福島区':'Osaka',
  '都島区':'Osaka','旭区':'Osaka','城東区':'Osaka','鶴見区':'Osaka',
  '神戸':'Kobe','姫路':'Himeji','西宮':'Nishinomiya','尼崎':'Amagasaki','明石':'Akashi',
  '奈良':'Nara','橿原':'Kashihara',
  '和歌山':'Wakayama',
  // 中国・四国
  '鳥取':'Tottori','米子':'Yonago',
  '松江':'Matsue','出雲':'Izumo',
  '岡山':'Okayama','倉敷':'Kurashiki',
  '広島':'Hiroshima','福山':'Fukuyama','呉':'Kure',
  '山口':'Yamaguchi','下関':'Shimonoseki','宇部':'Ube',
  '徳島':'Tokushima',
  '高松':'Takamatsu','丸亀':'Marugame',
  '松山':'Matsuyama','今治':'Imabari',
  '高知':'Kochi',
  // 九州・沖縄
  '福岡':'Fukuoka','北九州':'Kitakyushu','久留米':'Kurume',
  '佐賀':'Saga','唐津':'Karatsu',
  '長崎':'Nagasaki','佐世保':'Sasebo',
  '熊本':'Kumamoto','八代':'Yatsushiro',
  '大分':'Oita','別府':'Beppu',
  '宮崎':'Miyazaki','都城':'Miyakonojo',
  '鹿児島':'Kagoshima','霧島':'Kirishima',
  '那覇':'Naha','沖縄市':'Okinawa City',
};

// ===== JMA 警報・注意報 =====
// OWM英語都市名 → JMA都道府県コード
const JMA_PREF_CODE = {
  'Sapporo':'011000','Asahikawa':'012000','Hakodate':'017000','Kushiro':'014100','Obihiro':'014030',
  'Aomori':'020000','Hachinohe':'020000','Hirosaki':'020000',
  'Morioka':'030000',
  'Sendai':'040000','Ishinomaki':'040000',
  'Akita':'050000',
  'Yamagata':'060000',
  'Fukushima-shi':'070000','Koriyama':'070000','Iwaki':'070000',
  'Mito':'080000',
  'Utsunomiya':'090000',
  'Maebashi':'100000',
  'Saitama':'110000',
  'Chiba':'120000',
  'Tokyo':'130000','Shinjuku':'130000','Shibuya':'130000',
  'Yokohama':'140000','Kawasaki':'140000',
  'Niigata':'150000',
  'Toyama':'160000',
  'Kanazawa':'170000',
  'Fukui':'180000',
  'Kofu':'190000',
  'Nagano':'200000','Matsumoto':'200000',
  'Gifu':'210000',
  'Shizuoka':'220000','Hamamatsu':'220000',
  'Nagoya':'230000',
  'Tsu':'240000',
  'Otsu':'250000',
  'Kyoto':'260000',
  'Osaka':'270000',
  'Kobe':'280000','Himeji':'280000',
  'Nara':'290000',
  'Wakayama':'300000',
  'Tottori':'310000',
  'Matsue':'320000',
  'Okayama':'330000',
  'Hiroshima':'340000',
  'Yamaguchi':'350000',
  'Tokushima':'360000',
  'Takamatsu':'370000',
  'Matsuyama':'380000',
  'Kochi':'390000',
  'Fukuoka':'400000','Kitakyushu':'400000',
  'Saga':'410000',
  'Nagasaki':'420000',
  'Kumamoto':'430000',
  'Oita':'440000',
  'Miyazaki':'450000',
  'Kagoshima':'460100',
  'Naha':'471000',
};

let _jmaWarningDismissed = false;

async function fetchJMAWarnings(owmCityName) {
  const prefCode = JMA_PREF_CODE[owmCityName];
  if (!prefCode) { hideWarningBanner(); return; }
  try {
    const res = await fetch(
      `https://www.jma.go.jp/bosai/warning/data/warning/${prefCode}.json`,
      { signal: timeoutSignal(8000) }
    );
    if (!res.ok) return;
    const data = await res.json();
    const warnings = parseJMAWarnings(data);
    renderWarningBanner(warnings);
  } catch {
    // 警報取得失敗は無視（非クリティカル）
  }
}

function parseJMAWarnings(data) {
  const active = [];
  const seen = new Set();
  // areaTypes → areas → warnings
  for (const at of (data.areaTypes || [])) {
    for (const area of (at.areas || [])) {
      for (const w of (area.warnings || [])) {
        const status = w.status || '';
        if (status !== '発表' && status !== '継続') continue;
        const name = w.type?.name || w.typeName || w.name || '';
        if (!name || seen.has(name)) continue;
        seen.add(name);
        // 特別警報 / 警報 / 注意報 の分類
        const level = name.includes('特別警報') ? 3 : name.includes('警報') ? 2 : 1;
        active.push({ name, level, area: area.name || '' });
      }
    }
  }
  return active.sort((a, b) => b.level - a.level);
}

function renderWarningBanner(warnings) {
  const banner = document.getElementById('jma-warning-banner');
  if (!banner) return;
  if (!warnings.length || _jmaWarningDismissed) { hideWarningBanner(); return; }
  const maxLevel = warnings[0].level;
  const cls = maxLevel === 3 ? 'warn-tokubetsu' : maxLevel === 2 ? 'warn-keiho' : 'warn-chuiho';
  const icon = maxLevel === 3 ? '🚨' : maxLevel === 2 ? '⚠️' : 'ℹ️';
  const names = [...new Set(warnings.map(w => w.name))].join('・');
  const area = warnings[0].area;
  banner.className = cls;
  banner.innerHTML =
    '<span class="warn-icon">' + icon + '</span>' +
    '<span class="warn-body">' + escHtml(area ? area + '：' : '') + escHtml(names) + 'が発令中です</span>' +
    '<button class="warn-close" aria-label="閉じる" onclick="dismissWarningBanner()">✕</button>';
  banner.style.display = 'flex';
}

function hideWarningBanner() {
  const banner = document.getElementById('jma-warning-banner');
  if (banner) banner.style.display = 'none';
}

function dismissWarningBanner() {
  _jmaWarningDismissed = true;
  hideWarningBanner();
}

// 日本語都市名を OWM Geocoding 用クエリに変換
// - テーブル登録済み → ローマ字 + ",JP"
// - 未登録の日本語 → 漢字 + ",JP"（フォールバック）
// - 英語/カンマ含む → そのまま
function buildGeoQuery(city) {
  if (city.includes(',')) return city;
  if (/[\u3000-\u9fff\uff00-\uffef\u3040-\u30ff]/.test(city)) {
    return (JP_CITY_ROMAJI[city] || city) + ',JP';
  }
  return city;
}

// ===== 都市名で天気取得 =====
async function getWeatherByCity(cityRaw) {
  const city = (cityRaw ?? cityInput.value).trim();
  const unit = unitSelect.value;
  clearError(); showResult(false); acBox.classList.remove('show');
  if (!city) { showError('都市名を入力してください。'); return; }

  // スケルトン表示
  showWeatherSkeleton();
  setLoading(true, '都市を検索しています...');
  try {
    let lat, lon;

    // オートコンプリートで lat/lon がキャッシュされている場合はスキップ
    if (_cachedGeo && _cachedGeo.name === city) {
      ({ lat, lon } = _cachedGeo);
      _cachedGeo = null;
    } else {
      _cachedGeo = null;
      const geo = await fetchJson(
        'https://api.openweathermap.org/geo/1.0/direct?q=' + encodeURIComponent(buildGeoQuery(city)) + '&limit=1&appid=' + WEATHER_API_KEY
      );
      if (geo.status === 429) { showError429(60); return; }
      if (!geo.ok) { showError('都市検索に失敗しました（HTTP ' + geo.status + '）'); return; }
      if (!Array.isArray(geo.data) || !geo.data.length) {
        showError('「' + city + '」は見つかりませんでした。別の都市名をお試しください。'); return;
      }
      ({ lat, lon } = geo.data[0]);
    }

    lastCoords = { lat, lon };
    setLoading(true, '天気データを取得しています...');
    const w = await fetchJson(
      'https://api.openweathermap.org/data/2.5/weather?lat=' + lat + '&lon=' + lon + '&appid=' + WEATHER_API_KEY + '&units=' + unit + '&lang=ja'
    );
    if (w.status === 429) { showError429(60); return; }
    if (!w.ok || w.data?.cod !== 200) {
      // OWMが失敗した場合 Open-Meteo にフォールバック
      const fb = await fetchWeatherOpenMeteo(lat, lon, unit);
      if (fb) { renderWeather(fb, unit); }
      else { showError('天気情報の取得に失敗しました。'); return; }
    } else {
      renderWeather(w.data, unit);
    }
    startAutoRefresh();
    saveHistory(city);
    setShareLink(city);
    fetchAndRenderForecast(lat, lon, unit);
    fetchAndRenderAQI(lat, lon);
    setTimeout(() => initOrUpdateMap(lat, lon), 500);
    fetchAndRenderNews(currentCategory);
  } catch(e) {
    if (String(e).includes('Abort') || String(e).includes('abort')) showError('通信がタイムアウトしました。ネットワークをご確認ください。');
    else showError('通信エラーが発生しました。ネットワークをご確認ください。');
  } finally { setLoading(false); }
}

// ===== 現在地で天気取得 =====
async function getWeatherByGeo() {
  clearError(); showResult(false);
  if (!navigator.geolocation) { showError('このブラウザは位置情報に対応していません。'); return; }
  setLoading(true, '現在地を取得しています...');
  showWeatherSkeleton();
  navigator.geolocation.getCurrentPosition(async pos => {
    try {
      const unit = unitSelect.value;
      const { latitude: lat, longitude: lon } = pos.coords;
      lastCoords = { lat, lon };
      setLoading(true, '天気データを取得しています...');
      const w = await fetchJson(
        'https://api.openweathermap.org/data/2.5/weather?lat=' + lat + '&lon=' + lon + '&appid=' + WEATHER_API_KEY + '&units=' + unit + '&lang=ja'
      );
      if (w.status === 429) { showError429(60); return; }
      if (!w.ok || w.data?.cod !== 200) {
        // OWMが失敗した場合 Open-Meteo にフォールバック
        const fb = await fetchWeatherOpenMeteo(lat, lon, unit);
        if (fb) { renderWeather(fb, unit); }
        else { showError('現在地の天気取得に失敗しました。'); return; }
      } else {
        renderWeather(w.data, unit);
      }
      startAutoRefresh();
      if (w.data?.name) { saveHistory(w.data.name); setShareLink(w.data.name); }
      fetchAndRenderForecast(lat, lon, unit);
      fetchAndRenderAQI(lat, lon);
      setTimeout(() => initOrUpdateMap(lat, lon), 500);
      fetchAndRenderNews(currentCategory);
    } catch(e) {
      if (String(e).includes('Abort') || String(e).includes('abort')) showError('通信がタイムアウトしました。ネットワークをご確認ください。');
      else showError('通信エラーが発生しました。');
    }
    finally  { setLoading(false); }
  }, () => {
    setLoading(false);
    showError('位置情報の取得が許可されませんでした。ブラウザの設定をご確認ください。');
  }, { enableHighAccuracy: false, timeout: 8000 });
}

// ===== ニュース（GNews API） =====

const CATEGORY_LABEL = {
  general:'トップ', domestic:'国内', world:'国際', politics:'政治', economy:'経済',
  technology:'テクノロジー', science:'サイエンス', sports:'スポーツ',
  entertainment:'エンタメ', health:'健康', business:'ビジネス',
  gourmet:'グルメ', travel:'旅行', local:'地域', disaster:'🚨 災害',
};

const newsCache = {};
const CACHE_TTL = 15 * 60 * 1000;

// ニュースソース切り替え（yahoo / google）
let newsSource = localStorage.getItem('sora_news_source') || 'yahoo';

async function fetchGNews(category) {
  const now = Date.now();
  if (newsCache[category] && (now - newsCache[category].ts) < CACHE_TTL) return newsCache[category].articles;

  if (!CHAT_API_URL || CHAT_API_URL === 'YOUR_CHAT_WORKER_URL') throw new Error('Worker URL未設定');

  const res = await fetch(CHAT_API_URL + '/api/news?category=' + category, {
    signal: timeoutSignal(20000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  if (!Array.isArray(data.articles)) throw new Error(data.errors?.[0] || 'データ取得失敗');

  const articles = data.articles.map(item => ({
    title:       item.title?.trim() || '',
    description: item.description?.trim() || '',
    url:         item.url || '',
    image:       item.image || '',
    source:      item.source?.name || 'GNews',
    sourceIcon:  '',
    publishedAt: item.publishedAt || '',
    lang:        'ja',
  }));

  newsCache[category] = { ts: now, articles };
  try { localStorage.setItem('sora_news_offline_' + category, JSON.stringify({ ts: now, articles })); } catch {}
  return articles;
}

// 1次: Yahoo Japan RSS（カテゴリ別・30〜60分更新）
const RSS_FEEDS = {
  general:       'https://news.yahoo.co.jp/rss/topics/top-picks.xml',
  domestic:      'https://news.yahoo.co.jp/rss/topics/domestic.xml',
  world:         'https://news.yahoo.co.jp/rss/topics/world.xml',
  politics:      'https://news.yahoo.co.jp/rss/topics/politics.xml',
  economy:       'https://news.yahoo.co.jp/rss/topics/economy.xml',
  technology:    'https://news.yahoo.co.jp/rss/topics/it.xml',
  science:       'https://news.yahoo.co.jp/rss/topics/science.xml',
  sports:        'https://news.yahoo.co.jp/rss/topics/sports.xml',
  entertainment: 'https://news.yahoo.co.jp/rss/topics/entertainment.xml',
  health:        'https://news.yahoo.co.jp/rss/topics/health.xml',
  business:      'https://news.yahoo.co.jp/rss/topics/business.xml',
  gourmet:       'https://news.yahoo.co.jp/rss/topics/gourmet.xml',
  travel:        'https://news.yahoo.co.jp/rss/topics/travel.xml',
  local:         'https://news.yahoo.co.jp/rss/topics/local.xml',
  disaster:      'https://news.yahoo.co.jp/rss/topics/disaster.xml',
};
// 2次フォールバック: Google News RSS
const RSS_FEEDS_FALLBACK = {
  general:       'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja',
  domestic:      'https://news.google.com/rss/headlines/section/topic/NATION?hl=ja&gl=JP&ceid=JP:ja',
  world:         'https://news.google.com/rss/headlines/section/topic/WORLD?hl=ja&gl=JP&ceid=JP:ja',
  politics:      'https://news.google.com/rss/search?q=%E6%94%BF%E6%B2%BB+OR+%E5%9B%BD%E4%BC%9A&hl=ja&gl=JP&ceid=JP:ja',
  economy:       'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=ja&gl=JP&ceid=JP:ja',
  technology:    'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=ja&gl=JP&ceid=JP:ja',
  science:       'https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=ja&gl=JP&ceid=JP:ja',
  sports:        'https://news.google.com/rss/headlines/section/topic/SPORTS?hl=ja&gl=JP&ceid=JP:ja',
  entertainment: 'https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=ja&gl=JP&ceid=JP:ja',
  health:        'https://news.google.com/rss/headlines/section/topic/HEALTH?hl=ja&gl=JP&ceid=JP:ja',
  business:      'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=ja&gl=JP&ceid=JP:ja',
  gourmet:       'https://news.google.com/rss/search?q=%E3%82%B0%E3%83%AB%E3%83%A1+OR+%E9%A3%B2%E9%A3%9F%E5%BA%97&hl=ja&gl=JP&ceid=JP:ja',
  travel:        'https://news.google.com/rss/search?q=%E6%97%85%E8%A1%8C+OR+%E8%A6%B3%E5%85%89&hl=ja&gl=JP&ceid=JP:ja',
  local:         'https://news.google.com/rss/headlines/section/topic/NATION?hl=ja&gl=JP&ceid=JP:ja',
  disaster:      'https://news.google.com/rss/search?q=%E7%81%BD%E5%AE%B3+OR+%E5%9C%B0%E9%9C%87+OR+%E5%8F%B0%E9%A2%A8+OR+%E6%B4%AA%E6%B0%B4&hl=ja&gl=JP&ceid=JP%3Aja',
};

// rss2json.com 経由で RSS を JSON に変換（CORS フリー）
async function tryRss2json(url) {
  const apiUrl = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(url);
  const res = await fetch(apiUrl, { signal: timeoutSignal(12000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (data.status !== 'ok' || !data.items?.length) throw new Error('記事なし');
  return data.items.map(item => ({
    title:       item.title || '',
    description: (item.description || '').replace(/<[^>]*>/g, '').trim(),
    url:         item.link || '',
    image:       item.thumbnail || item.enclosure?.link || '',
    source:      item.author || data.feed?.title || '',
    sourceIcon:  data.feed?.favicon || '',
    publishedAt: item.pubDate || '',
    lang:        'ja',
  }));
}

// Yahoo / Google ソース切り替え対応フェッチ
async function fetchRSSNews(category) {
  const feeds = newsSource === 'google' ? RSS_FEEDS_FALLBACK : RSS_FEEDS;
  const url = feeds[category];
  if (!url) throw new Error('RSS未設定');
  return await tryRss2json(url);
}

async function fetchAndRenderNews(category) {
  const label = CATEGORY_LABEL[category] || category;
  const cached = newsCache[category];
  if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
    renderNewsCards(cached.articles, label);
    updateNewsBadges();
    return;
  }
  renderNewsSkeleton();
  try {
    // フェッチチェーン: 1次 Yahoo RSS → 2次 Google RSS
    const articles = await fetchRSSNews(category);

    if (articles.length > 0) {
      newsCache[category] = { ts: Date.now(), articles };
      try { localStorage.setItem('sora_news_offline_' + category, JSON.stringify({ ts: Date.now(), articles })); } catch {}
      renderNewsCards(articles, label); updateNewsBadges(); return;
    }
    showNewsMessage('📭', '「' + label + '」の記事が見つかりませんでした', 'しばらく後にお試しください。');
  } catch(e) {
    // オフラインキャッシュを確認
    try {
      const offline = JSON.parse(localStorage.getItem('sora_news_offline_' + category) || 'null');
      if (offline?.articles?.length) {
        renderNewsCards(offline.articles, label);
        const age = Math.round((Date.now() - offline.ts) / 60000);
        const offlineBar = document.createElement('div');
        offlineBar.style.cssText = 'text-align:center;font-size:11px;color:var(--text2);padding:6px 0 2px;';
        offlineBar.textContent = '📴 オフラインキャッシュ（' + age + '分前のデータ）';
        newsContainer.prepend(offlineBar);
        return;
      }
    } catch {}
    showNewsMessage('⚠️', 'ニュースの取得に失敗しました',
      String(e.message || e) + '<br><small style="opacity:.7">ニュース API</small>');
  }
}

function showNewsMessage(icon, title, body) {
  newsContainer.innerHTML =
    '<div style="padding:48px 20px;text-align:center;color:var(--text2);line-height:2;">' +
      '<div style="font-size:36px;margin-bottom:12px;">' + icon + '</div>' +
      '<div style="font-weight:700;font-size:16px;color:var(--text);margin-bottom:8px;">' + title + '</div>' +
      '<div style="font-size:13px;">' + body + '</div>' +
    '</div>';
}

function renderNewsSkeleton() {
  const skCard =
    '<div class="news-skeleton"><div class="sk-img"></div>' +
    '<div class="sk-body"><div class="sk-line s"></div><div class="sk-line"></div>' +
    '<div class="sk-line"></div><div class="sk-line s"></div></div></div>';
  newsContainer.innerHTML =
    '<div class="featured-news">' + skCard + skCard + '</div>' +
    '<div class="news-grid">' + Array(9).fill(skCard).join('') + '</div>';
}

function renderNewsCards(articles, categoryLabel) {
  categoryLabel = categoryLabel || '';
  const readSet = loadReadUrls();
  let filtered = articles;
  if (newsShowUnreadOnly) filtered = articles.filter(a => !readSet.has(a.url));
  if (!filtered.length) {
    newsContainer.innerHTML =
      '<div style="padding:40px;text-align:center;color:var(--text2);">' +
      (newsShowUnreadOnly ? '📭 未読の記事はありません。<br><small style="opacity:.7;margin-top:8px;display:block">「すべて」に切り替えると既読も表示されます</small>'
        : 'ニュースが見つかりませんでした。') +
      '</div>';
    return;
  }
  const displayed = filtered.slice(0, 20);
  const featured  = displayed.slice(0, 2);
  const rest      = displayed.slice(2);

  // 最初の6件（featured 2 + rest 4）を即時描画、残りは遅延ロード
  const immediateRest = rest.slice(0, 4);
  const deferredRest  = rest.slice(4);

  newsContainer.innerHTML =
    '<div class="featured-news">' + featured.map(a => newsCardHTML(a, true, categoryLabel, readSet)).join('') + '</div>' +
    (immediateRest.length || deferredRest.length
      ? '<div class="news-grid" id="news-grid-main">' +
          immediateRest.map(a => newsCardHTML(a, false, categoryLabel, readSet)).join('') +
        '</div>'
      : '');

  attachNewsListeners(newsContainer);

  // 残りを IntersectionObserver で遅延レンダリング
  if (deferredRest.length > 0) {
    const BATCH = 6;
    let queue = deferredRest.slice();
    const sentinel = document.createElement('div');
    sentinel.style.height = '4px';
    newsContainer.appendChild(sentinel);

    const observer = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting) return;
      const batch = queue.splice(0, BATCH);
      if (!batch.length) { observer.disconnect(); sentinel.remove(); return; }
      const grid = document.getElementById('news-grid-main');
      if (grid) {
        const frag = document.createDocumentFragment();
        batch.forEach(a => {
          const tmp = document.createElement('div');
          tmp.innerHTML = newsCardHTML(a, false, categoryLabel, readSet);
          const card = tmp.firstElementChild;
          if (card) frag.appendChild(card);
        });
        grid.appendChild(frag);
        attachNewsListeners(grid);
      }
      if (!queue.length) { observer.disconnect(); sentinel.remove(); }
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
  }
}

function attachSwipeToCard(card) {
  let startX = 0, startY = 0, moved = false;
  card.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    moved = false;
  }, { passive: true });
  card.addEventListener('touchmove', e => {
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
      moved = true;
      card.style.transform = 'translateX(' + (dx * 0.3) + 'px)';
      card.classList.toggle('swipe-left',  dx < -20);
      card.classList.toggle('swipe-right', dx > 20);
    }
  }, { passive: true });
  card.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    card.style.transform = '';
    card.classList.remove('swipe-left', 'swipe-right');
    if (!moved || Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 60) return;
    const url = card.dataset.url;
    if (!url) return;
    if (dx < 0) {
      // 左スワイプ → 既読
      markAsRead(url);
      card.classList.add('is-read');
    } else {
      // 右スワイプ → ブックマーク
      const articleData = {
        url,
        title: card.querySelector('.news-title')?.textContent || '',
        source: card.querySelector('.news-source')?.textContent || '',
        pubDate: '',
        thumbnail: card.querySelector('img')?.src || ''
      };
      toggleBookmark(articleData);
      card.querySelector('.news-bmark-btn')?.classList.toggle('bookmarked');
    }
  }, { passive: true });
}

function attachNewsListeners(container) {
  container.querySelectorAll('.news-card').forEach(el => {
    const open = () => {
      const h = el.dataset.url;
      if (!h) return;
      markAsRead(h);
      el.classList.add('is-read');
      window.open(h, '_blank', 'noopener');
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
  });
  container.querySelectorAll('.news-bmark-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleBookmark({ url: btn.dataset.url, title: btn.dataset.title, source: btn.dataset.source, publishedAt: btn.dataset.pub, image: btn.dataset.img });
      const bmarked = isBookmarked(btn.dataset.url);
      btn.textContent = bmarked ? '★' : '☆';
      btn.classList.toggle('bookmarked', bmarked);
    });
  });
  container.querySelectorAll('.news-summary-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const box = btn.closest('.news-body')?.querySelector('.news-summary-box');
      if (!box) return;
      if (box.classList.contains('visible') && !btn.dataset.isError) {
        box.classList.remove('visible');
        btn.textContent = '✨ 要約';
        delete btn.dataset.isError;
        return;
      }
      btn.disabled = true;
      btn.textContent = '…';
      delete btn.dataset.isError;
      const summary = await summarizeArticle(btn.dataset.url, btn.dataset.title, btn.dataset.desc);
      box.textContent = summary;
      box.classList.add('visible');
      btn.disabled = false;
      if (summary.startsWith('⚠️')) {
        btn.dataset.isError = '1';
        btn.textContent = '↺ 再試行';
      } else {
        btn.textContent = '✕ 閉じる';
      }
    });
  });
  // スワイプ操作をすべてのニュースカードに適用
  container.querySelectorAll('.news-card').forEach(attachSwipeToCard);
}

function renderBookmarkCards() {
  const bmarks = loadBookmarks();
  if (!bmarks.length) {
    newsContainer.innerHTML =
      '<div style="padding:48px 20px;text-align:center;color:var(--text2);">' +
      '<div style="font-size:40px;margin-bottom:12px;">🔖</div>' +
      '<div style="font-weight:700;font-size:16px;color:var(--text);margin-bottom:8px;">ブックマークはありません</div>' +
      '<div style="font-size:13px;">記事カードの ☆ をクリックして保存できます</div>' +
      '</div>';
    return;
  }
  const readSet = loadReadUrls();
  newsContainer.innerHTML = '<div class="news-grid">' + bmarks.map(a => newsCardHTML(a, false, 'ブックマーク', readSet)).join('') + '</div>';
  attachNewsListeners(newsContainer);
  // ブックマーク表示時はブックマーク削除でカードを除去
  newsContainer.querySelectorAll('.news-bmark-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!isBookmarked(btn.dataset.url)) {
        btn.closest('.news-card')?.remove();
        if (!newsContainer.querySelector('.news-card')) renderBookmarkCards();
      }
    }, { capture: false });
  });
}

function newsCardHTML(a, featured, categoryLabel, readSet) {
  const hasImage = !!a.image;
  const isRead   = readSet && readSet.has(a.url);
  const imgSection = hasImage
    ? '<div class="news-img"><img src="' + escHtml(a.image) + '" alt="" loading="lazy" onerror="this.parentElement.style.display=\'none\'"></div>'
    : '';
  const timeStr  = relativeTime(a.publishedAt);
  const readBadge = isRead ? '<span class="news-read-badge">既読</span>' : '';
  return '<div class="news-card' + (featured ? ' featured' : '') + (hasImage ? '' : ' no-img') + (isRead ? ' is-read' : '') +
    '" data-url="' + escHtml(a.url) + '" tabindex="0" role="link" aria-label="' + escHtml(a.title) + '">' +
    imgSection +
    '<div class="news-body">' +
      '<div class="news-category">' + escHtml(categoryLabel || a.category || '') + '</div>' +
      '<div class="news-title">' + escHtml(a.title) + '</div>' +
      '<div class="news-meta">' +
        '<span class="news-source">📡 ' + escHtml(a.source) + '</span>' +
        '<span style="display:flex;gap:6px;align-items:center;">' +
          (timeStr ? '<span class="news-time">' + timeStr + '</span>' : '') +
          readBadge +
          '<button class="news-summary-btn"' +
            ' data-url="' + escHtml(a.url) + '"' +
            ' data-title="' + escHtml(a.title) + '"' +
            ' data-desc="' + escHtml(a.description || '') + '"' +
            ' title="AIで要約" aria-label="AIで要約">✨ 要約</button>' +
          '<button class="news-bmark-btn' + (isBookmarked(a.url) ? ' bookmarked' : '') + '"' +
            ' data-url="' + escHtml(a.url) + '"' +
            ' data-title="' + escHtml(a.title) + '"' +
            ' data-source="' + escHtml(a.source || '') + '"' +
            ' data-pub="' + escHtml(a.publishedAt || '') + '"' +
            ' data-img="' + escHtml(a.image || '') + '"' +
            ' title="ブックマーク" aria-label="ブックマーク">' +
            (isBookmarked(a.url) ? '★' : '☆') +
          '</button>' +
        '</span>' +
      '</div>' +
      '<div class="news-summary-box"></div>' +
    '</div></div>';
}

// ===== Workers AI 要約 =====
function cleanSummaryText(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^[-•*#>]+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const SUMMARY_TTL = 7 * 24 * 60 * 60 * 1000; // 7日

async function summarizeArticle(url, title, description) {
  const cacheKey = 'sora_summary_' + url;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const { text: t, ts } = JSON.parse(raw);
      if (Date.now() - ts < SUMMARY_TTL) return t;
      localStorage.removeItem(cacheKey);
    }
  } catch {}
  if (!CHAT_API_URL || CHAT_API_URL === 'YOUR_CHAT_WORKER_URL') return '⚠️ Worker URLが未設定です。';
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(CHAT_API_URL + '/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description }),
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return `⚠️ 要約の取得に失敗しました（${res.status}）`;
    const data = await res.json();
    if (data.error) return `⚠️ ${data.error}`;
    const text = cleanSummaryText(data.summary || '');
    if (!text) return '⚠️ 要約を取得できませんでした。';
    try { localStorage.setItem(cacheKey, JSON.stringify({ text, ts: Date.now() })); } catch {}
    return text;
  } catch (e) {
    clearTimeout(tid);
    if (e.name === 'AbortError') return '⚠️ タイムアウトしました。';
    return '⚠️ 要約の取得中にエラーが発生しました。';
  }
}

function cleanSummaryCache() {
  const now = Date.now();
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('sora_summary_')) continue;
    try {
      const { ts } = JSON.parse(localStorage.getItem(key));
      if (now - ts >= SUMMARY_TTL) localStorage.removeItem(key);
    } catch { localStorage.removeItem(key); }
  }
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== 相対時刻 =====
function relativeTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'たった今';
  if (m < 60) return m + '分前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + '時間前';
  const day = Math.floor(h / 24);
  if (day < 7) return day + '日前';
  return (d.getMonth() + 1) + '/' + d.getDate();
}

// ===== ニュース既読管理 =====
function loadReadUrls() {
  try { return new Set(JSON.parse(localStorage.getItem(LS.newsRead) || '[]')); }
  catch { return new Set(); }
}
let _syncReadTimer = null;
function markAsRead(url) {
  if (!url) return;
  const set = loadReadUrls();
  set.add(url);
  const arr = [...set].slice(-300);
  try { localStorage.setItem(LS.newsRead, JSON.stringify(arr)); } catch {}
  updateNewsBadges();
  // クラウドへの書き込みはデバウンスして過剰なAPIコールを防ぐ
  clearTimeout(_syncReadTimer);
  _syncReadTimer = setTimeout(() => sbSaveSettings({ news_read: arr.slice(-100) }), 3000);
}
function clearReadUrls() {
  try { localStorage.removeItem(LS.newsRead); } catch {}
  sbSaveSettings({ news_read: [] });
  updateNewsBadges();
}

let newsShowUnreadOnly = false;

// ===== スクロールトップボタン =====
(function initScrollTop() {
  const btn = document.createElement('button');
  btn.className = 'scroll-top-btn';
  btn.innerHTML = '↑';
  btn.title = 'トップへ戻る';
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  document.body.appendChild(btn);
  window.addEventListener('scroll', () => {
    btn.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });
})();

// ===== イベントリスナー =====
document.getElementById('fav-btn').addEventListener('click', () => { if (currentCity) toggleFavorite(currentCity); });
document.getElementById('voice-btn').addEventListener('click', speakWeather);

// ===== 音量スライダー =====
let _volSyncTimer = null;
(function initVolumeSlider() {
  const slider = document.getElementById('volume-slider');
  const label  = document.getElementById('volume-label');
  if (!slider || !label) return;
  const saved = localStorage.getItem(LS.volume);
  const pct   = saved != null ? Math.round(parseFloat(saved) * 100) : 80;
  slider.value = pct;
  label.textContent = pct + '%';
  // ボリュームアイコンを音量に合わせる
  const updateIcon = v => {
    const icon = document.querySelector('.volume-icon');
    if (icon) icon.textContent = v === 0 ? '🔇' : v < 40 ? '🔈' : v < 70 ? '🔉' : '🔊';
  };
  updateIcon(pct);
  slider.addEventListener('input', () => {
    const v = parseInt(slider.value, 10);
    label.textContent = v + '%';
    updateIcon(v);
    localStorage.setItem(LS.volume, (v / 100).toFixed(2));
    // 再生中なら即時反映
    if (ttsAudio && !ttsAudio.paused) ttsAudio.volume = v / 100;
    // クラウド同期（debounce 1.5s）
    clearTimeout(_volSyncTimer);
    _volSyncTimer = setTimeout(() => {
      if (sbCurrentUser()) sbSaveSettings({ volume: (v / 100).toFixed(2) });
    }, 1500);
  });
})();
searchBtn.addEventListener('click', () => getWeatherByCity());
cityInput.addEventListener('keydown', e => { if (e.key === 'Enter') getWeatherByCity(); });
cityInput.addEventListener('input',  e => renderAC(e.target.value));
cityInput.addEventListener('blur',   () => setTimeout(() => acBox.classList.remove('show'), 180));
geoBtn.addEventListener('click', getWeatherByGeo);
themeBtn.addEventListener('click', toggleTheme);
clearHistoryBtn.addEventListener('click', clearHistory);
unitSelect.addEventListener('change', () => {
  localStorage.setItem(LS.unit, unitSelect.value);
  sbSaveSettings({ unit: unitSelect.value });
  const mobileSelect = document.getElementById('unit-select-mobile');
  if (mobileSelect) mobileSelect.value = unitSelect.value;
  const c = cityInput.value.trim();
  if (c) getWeatherByCity(c);
});

// モバイル設定メニュー
const settingsMenuBtn = document.getElementById('settings-menu-btn');
const settingsDropdown = document.getElementById('settings-dropdown');
if (settingsMenuBtn && settingsDropdown) {
  settingsMenuBtn.addEventListener('click', e => {
    e.stopPropagation();
    settingsDropdown.classList.toggle('open');
  });
  document.addEventListener('click', () => settingsDropdown.classList.remove('open'));
}
const unitSelectMobile = document.getElementById('unit-select-mobile');
if (unitSelectMobile) {
  unitSelectMobile.value = unitSelect.value;
  unitSelectMobile.addEventListener('change', () => {
    unitSelect.value = unitSelectMobile.value;
    localStorage.setItem(LS.unit, unitSelectMobile.value);
    sbSaveSettings({ unit: unitSelectMobile.value });
    const c = cityInput.value.trim();
    if (c) getWeatherByCity(c);
  });
}
document.getElementById('clear-history-btn-mobile')?.addEventListener('click', () => {
  clearHistory();
  settingsDropdown?.classList.remove('open');
});
newsTabs.querySelectorAll('.news-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    newsTabs.querySelectorAll('.news-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentCategory = tab.dataset.cat;
    localStorage.setItem(LS.category, currentCategory);
    sbSaveSettings({ news_category: currentCategory });
    sbLog('news_category', { category: currentCategory });
    fetchAndRenderNews(currentCategory);
  });
});

// ニュースソーストグル（Yahoo / Google）
function applyNewsSource(src) {
  newsSource = src;
  localStorage.setItem('sora_news_source', src);
  document.getElementById('source-yahoo')?.classList.toggle('active', src === 'yahoo');
  document.getElementById('source-google')?.classList.toggle('active', src === 'google');
  // キャッシュクリアして再取得
  Object.keys(newsCache).forEach(k => delete newsCache[k]);
  fetchAndRenderNews(currentCategory);
}
document.getElementById('source-yahoo')?.addEventListener('click', () => applyNewsSource('yahoo'));
document.getElementById('source-google')?.addEventListener('click', () => applyNewsSource('google'));
// 初期状態をUIのみ反映（fetchは初回ロード時に別途行うため重複させない）
document.getElementById('source-yahoo')?.classList.toggle('active', newsSource === 'yahoo');
document.getElementById('source-google')?.classList.toggle('active', newsSource === 'google');

// 雨バナー閉じるボタン
document.getElementById('rain-banner-close')?.addEventListener('click', () => {
  const banner = document.getElementById('rain-banner');
  if (banner) banner.classList.remove('show');
  sessionStorage.setItem('rain_banner_dismissed', '1');
});

// エラー再試行ボタン
document.getElementById('error-retry-btn')?.addEventListener('click', () => {
  clearError();
  const city = cityInput.value.trim() || currentCity;
  if (city) getWeatherByCity(city);
  else if (lastCoords) getWeatherByGeo();
});

// ニュースフィルター
function setFilterActive(id) {
  ['news-filter-all','news-filter-unread','news-filter-bookmark'].forEach(i =>
    document.getElementById(i)?.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}
document.getElementById('news-filter-all')?.addEventListener('click', () => {
  newsShowUnreadOnly = false;
  setFilterActive('news-filter-all');
  fetchAndRenderNews(currentCategory);
});
document.getElementById('news-filter-unread')?.addEventListener('click', () => {
  newsShowUnreadOnly = true;
  setFilterActive('news-filter-unread');
  fetchAndRenderNews(currentCategory);
});
document.getElementById('news-filter-bookmark')?.addEventListener('click', () => {
  newsShowUnreadOnly = false;
  setFilterActive('news-filter-bookmark');
  renderBookmarkCards();
});
document.getElementById('news-filter-clear-read')?.addEventListener('click', () => {
  clearReadUrls();
  newsShowUnreadOnly = false;
  setFilterActive('news-filter-all');
  fetchAndRenderNews(currentCategory);
});

// 通知ボタン
document.getElementById('notif-btn').addEventListener('click', async () => {
  const btn = document.getElementById('notif-btn');
  if (!notificationsEnabled) {
    const granted = await requestNotificationPermission();
    if (granted) {
      notificationsEnabled = true;
      localStorage.setItem(LS.notif, '1');
      btn.classList.remove('notif-btn-off');
      btn.title = '通知ON（クリックでOFF）';
      if (sbCurrentUser()) sbSaveSettings({ notifications_enabled: 1 });
    } else {
      showError('ブラウザの通知が許可されていません。アドレスバー左のアイコンから通知を許可してください。');
    }
  } else {
    notificationsEnabled = false;
    localStorage.removeItem(LS.notif);
    btn.classList.add('notif-btn-off');
    btn.title = '天気アラート通知をONにする';
    if (sbCurrentUser()) sbSaveSettings({ notifications_enabled: 0 });
  }
});
// マップレイヤーボタン
document.getElementById('map-layer-btns')?.querySelectorAll('.map-layer-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('map-layer-btns').querySelectorAll('.map-layer-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    setMapLayer(btn.dataset.layer);
  });
});

// ===== 自動リロード =====
async function autoRefreshWeather() {
  if (!lastCoords) return;
  const unit = unitSelect.value;
  try {
    const w = await fetchJson(
      'https://api.openweathermap.org/data/2.5/weather?lat=' + lastCoords.lat + '&lon=' + lastCoords.lon +
      '&appid=' + WEATHER_API_KEY + '&units=' + unit + '&lang=ja'
    );
    if (!w.ok || w.data?.cod !== 200) return;
    renderWeather(w.data, unit);
    fetchAndRenderForecast(lastCoords.lat, lastCoords.lon, unit);
  } catch { /* 自動更新失敗は無視 */ }
}

function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(autoRefreshWeather, AUTO_REFRESH_MS);
}

// ===== 気象庁 API =====
const JMA_AREA_CODE = {
  'Tokyo':'130000','東京':'130000','Osaka':'270000','大阪':'270000',
  'Kyoto':'260000','京都':'260000','Nagoya':'230000','名古屋':'230000',
  'Fukuoka':'400000','福岡':'400000','Sapporo':'016000','札幌':'016000',
  'Sendai':'040000','仙台':'040000','Hiroshima':'340000','広島':'340000',
  'Kobe':'280000','神戸':'280000','Yokohama':'140000','横浜':'140000',
  'Wakayama':'300000','和歌山':'300000','Nara':'290000','奈良':'290000',
  'Kanazawa':'170000','金沢':'170000','Naha':'471000','那覇':'471000',
  'Nagasaki':'420000','長崎':'420000','Kumamoto':'430000','熊本':'430000',
  'Niigata':'150000','新潟':'150000','Shizuoka':'220000','静岡':'220000',
  'Okayama':'330000','岡山':'330000','Saitama':'110000','埼玉':'110000',
  'Chiba':'120000','千葉':'120000','Nagano':'200000','長野':'200000',
  'Kagoshima':'460100','鹿児島':'460100','Miyazaki':'450000','宮崎':'450000',
  'Oita':'440000','大分':'440000','Saga':'410000','佐賀':'410000',
  'Gifu':'210000','岐阜':'210000','Kawasaki':'140000','川崎':'140000',
};

async function fetchJMAForecast(cityName) {
  const code = JMA_AREA_CODE[cityName];
  if (!code) return null;
  try {
    const result = await fetchJson('https://www.jma.go.jp/bosai/forecast/data/forecast/' + code + '.json', 10000);
    if (!result.ok || !Array.isArray(result.data)) return null;
    const overview = result.data[0];
    const ts0 = overview.timeSeries[0];
    const ts1 = overview.timeSeries[1];
    const area = ts0.areas[0];
    const days = ts0.timeDefines.slice(0, 3).map((d, i) => {
      const dt = new Date(d);
      return {
        label: i === 0 ? '今日' : i === 1 ? '明日' : '明後日',
        date: (dt.getMonth() + 1) + '/' + dt.getDate(),
        weather: (area.weathers?.[i] || '').replace(/\s+/g, ' '),
        weatherCode: area.weatherCodes?.[i] || '',
      };
    });
    const pops = ts1?.areas[0]?.pops || [];
    return { days, pops, areaName: area.area.name };
  } catch { return null; }
}

function renderJMAForecast(jmaData) {
  const panel = document.getElementById('jma-panel');
  if (!panel) return;
  if (!jmaData || !jmaData.days.length) { panel.style.display = 'none'; return; }
  const dayCards = jmaData.days.map((d, i) => {
    const pop = jmaData.pops[i * 2] != null ? jmaData.pops[i * 2] + '%' : '-';
    const iconUrl = d.weatherCode
      ? 'https://www.jma.go.jp/bosai/forecast/img/' + d.weatherCode + '.png'
      : '';
    return '<div class="jma-day">' +
      '<div class="jma-day-label">' + d.label + ' ' + d.date + '</div>' +
      (iconUrl ? '<img class="jma-day-icon" src="' + iconUrl + '" onerror="this.style.display=\'none\'" alt="">' : '') +
      '<div class="jma-day-weather">' + d.weather + '</div>' +
      '<div class="jma-day-pop">☂ ' + pop + '</div>' +
      '</div>';
  }).join('');
  panel.innerHTML =
    '<div class="jma-header">' +
      '<span class="jma-title">📡 気象庁 天気予報</span>' +
      '<span class="jma-area">' + jmaData.areaName + '</span>' +
    '</div>' +
    '<div class="jma-days">' + dayCards + '</div>';
  panel.style.display = 'block';
}

// ===== Supabase 認証 UI =====
function updateAuthUI(user) {
  const area = document.getElementById('auth-area');
  if (!area) return;
  if (!user) {
    area.innerHTML = '<button class="btn" id="login-btn" style="font-size:13px;">ログイン</button>';
    document.getElementById('login-btn')?.addEventListener('click', () => {
      document.getElementById('auth-backdrop')?.classList.add('show');
    });
  } else {
    // Google OAuth は full_name、メール登録は email のプレフィックスを表示
    const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || '?';
    const initial = displayName[0].toUpperCase();
    area.innerHTML =
      '<div class="user-badge" id="user-badge">' +
        '<div class="user-avatar">' + initial + '</div>' +
        '<span class="user-email">' + displayName + '</span>' +
        '<div class="user-dropdown">' +
          '<div class="user-dd-item" id="user-email-dd" style="font-size:11px;color:var(--text2);padding-bottom:4px;border-bottom:1px solid var(--border);">' + (user.email || '') + '</div>' +
          '<div class="user-dd-item danger" id="signout-btn">ログアウト</div>' +
        '</div>' +
      '</div>';
    document.getElementById('user-badge')?.addEventListener('click', function(e) {
      e.stopPropagation();
      this.classList.toggle('open');
    });
    document.addEventListener('click', () => {
      document.getElementById('user-badge')?.classList.remove('open');
    }, { once: false });
    document.getElementById('signout-btn')?.addEventListener('click', async () => {
      await sbSignOut();
    });
  }
}

function initAuthModal() {
  // タブ切替
  document.querySelectorAll('[data-auth-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-auth-tab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const pane = tab.dataset.authTab;
      document.getElementById('auth-google-pane').style.display = pane === 'google' ? '' : 'none';
      document.getElementById('auth-email-pane').style.display  = pane === 'email'  ? '' : 'none';
    });
  });

  // モーダルを閉じる
  document.getElementById('auth-close')?.addEventListener('click', () => {
    document.getElementById('auth-backdrop')?.classList.remove('show');
  });
  document.getElementById('auth-backdrop')?.addEventListener('click', e => {
    if (e.target === document.getElementById('auth-backdrop'))
      document.getElementById('auth-backdrop').classList.remove('show');
  });

  // Google サインイン
  document.getElementById('auth-google-btn')?.addEventListener('click', async () => {
    try { await sbSignInGoogle(); }
    catch(e) { setAuthMsg('error', 'Googleログインに失敗しました'); }
  });

  // メール サインイン / サインアップ
  let authMode = 'signin';
  document.getElementById('auth-toggle-mode')?.addEventListener('click', () => {
    authMode = authMode === 'signin' ? 'signup' : 'signin';
    document.getElementById('auth-submit-btn').textContent = authMode === 'signin' ? 'ログイン' : '新規登録';
    document.getElementById('auth-toggle-mode').textContent = authMode === 'signin' ? '新規登録' : 'ログインへ戻る';
    setAuthMsg('', '');
  });

  document.getElementById('auth-submit-btn')?.addEventListener('click', async () => {
    const email    = document.getElementById('auth-email')?.value.trim();
    const password = document.getElementById('auth-password')?.value;
    if (!email || !password) { setAuthMsg('error', 'メールとパスワードを入力してください'); return; }
    setAuthMsg('', '処理中...');
    const fn = authMode === 'signin' ? sbSignInEmail : sbSignUpEmail;
    const { error } = await fn(email, password);
    if (error) {
      setAuthMsg('error', error.message || 'エラーが発生しました');
    } else if (authMode === 'signup') {
      setAuthMsg('success', '確認メールを送信しました。メールを確認してください。');
    } else {
      document.getElementById('auth-backdrop')?.classList.remove('show');
    }
  });
}

function setAuthMsg(type, msg) {
  const el = document.getElementById('auth-msg');
  if (!el) return;
  el.className = 'auth-msg' + (type ? ' ' + type : '');
  el.textContent = msg;
}

// ===== プルトゥリフレッシュ =====
(function initPullToRefresh() {
  const indicator = document.getElementById('ptr-indicator');
  const ptrIcon   = document.getElementById('ptr-icon');
  const ptrLabel  = document.getElementById('ptr-label');
  if (!indicator) return;

  let startY = 0;
  let pulling = false;
  const THRESHOLD = 80;

  document.addEventListener('touchstart', e => {
    if (window.scrollY === 0) { startY = e.touches[0].clientY; pulling = true; }
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 10) {
      indicator.classList.add('ptr-pulling');
      ptrIcon.textContent  = dy >= THRESHOLD ? '↺' : '↓';
      ptrLabel.textContent = dy >= THRESHOLD ? '放して更新' : '引いて更新';
    }
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (!pulling) return;
    const dy = e.changedTouches[0].clientY - startY;
    pulling = false;
    if (dy >= THRESHOLD) {
      ptrIcon.textContent  = '';
      ptrLabel.textContent = '更新中...';
      indicator.classList.remove('ptr-pulling');
      indicator.classList.add('ptr-refreshing');
      indicator.querySelector('.ptr-spinner')?.remove();
      const spinner = document.createElement('span');
      spinner.className = 'ptr-spinner';
      indicator.insertBefore(spinner, ptrIcon);
      const done = () => {
        indicator.classList.remove('ptr-refreshing');
        spinner.remove();
        ptrIcon.textContent  = '↓';
        ptrLabel.textContent = '引いて更新';
      };
      const tasks = [fetchAndRenderNews(currentCategory)];
      if (lastCoords) tasks.push(getWeatherByGeo());
      else if (currentCity) tasks.push(getWeatherByCity(currentCity));
      Promise.allSettled(tasks).then(done);
    } else {
      indicator.classList.remove('ptr-pulling');
      ptrIcon.textContent  = '↓';
      ptrLabel.textContent = '引いて更新';
    }
  }, { passive: true });
})();

// ===== ニュース未読バッジ =====
function updateNewsBadges() {
  const readSet = loadReadUrls();
  newsTabs.querySelectorAll('.news-tab').forEach(tab => {
    const cat = tab.dataset.cat;
    const cached = newsCache[cat];
    let existing = tab.querySelector('.tab-badge');
    if (!cached?.articles?.length) { existing?.remove(); return; }
    const count = cached.articles.filter(a => a.url && !readSet.has(a.url)).length;
    if (count <= 0) { existing?.remove(); return; }
    if (!existing) { existing = document.createElement('span'); existing.className = 'tab-badge'; tab.appendChild(existing); }
    existing.textContent = count > 99 ? '99+' : String(count);
  });
}

// ===== プライバシーポリシー =====
(function initPrivacyModal() {
  const modal = document.getElementById('privacy-modal');
  const closeBtn = document.getElementById('privacy-modal-close');
  const link = document.getElementById('privacy-link');
  if (!modal) return;
  link?.addEventListener('click', () => modal.classList.add('show'));
  closeBtn?.addEventListener('click', () => modal.classList.remove('show'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
})();

// ===== オンボーディング =====
function initOnboarding() {
  const ONBOARDING_KEY = 'sora_onboarding_v1';
  if (localStorage.getItem(ONBOARDING_KEY)) return;
  const modal   = document.getElementById('onboarding-modal');
  const nextBtn = document.getElementById('ob-next');
  const prevBtn = document.getElementById('ob-prev');
  const dots    = modal?.querySelectorAll('.ob-dot');
  const steps   = modal?.querySelectorAll('.ob-step');
  if (!modal || !steps?.length) return;
  let current = 0;
  const total = steps.length;

  const show = idx => {
    steps.forEach((s, i) => s.classList.toggle('active', i === idx));
    dots.forEach((d, i) => d.classList.toggle('active', i === idx));
    prevBtn.style.display = idx === 0 ? 'none' : '';
    nextBtn.textContent = idx === total - 1 ? 'はじめる ✓' : '次へ →';
    current = idx;
  };

  nextBtn?.addEventListener('click', () => {
    if (current < total - 1) { show(current + 1); }
    else {
      modal.classList.remove('show');
      localStorage.setItem(ONBOARDING_KEY, '1');
    }
  });
  prevBtn?.addEventListener('click', () => { if (current > 0) show(current - 1); });

  show(0);
  modal.classList.add('show');
}

// ===== 初期化 =====
(function init() {
  cleanSummaryCache();
  initOnboarding();
  const savedTheme = localStorage.getItem(LS.theme);
  if (savedTheme === 'dark' || savedTheme === 'light') applyTheme(savedTheme);
  else applyTheme(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const savedUnit = localStorage.getItem(LS.unit);
  if (savedUnit === 'metric' || savedUnit === 'imperial') applyUnit(savedUnit);
  renderHistory();
  renderFavorites();
  // 前回選択したニュースカテゴリを復元
  const validCategories = Object.keys(CATEGORY_LABEL);
  const savedCategory = localStorage.getItem(LS.category);
  if (savedCategory && validCategories.includes(savedCategory)) {
    currentCategory = savedCategory;
  }
  const activeTab = newsTabs.querySelector('.news-tab[data-cat="' + currentCategory + '"]');
  if (activeTab) {
    newsTabs.querySelectorAll('.news-tab').forEach(t => t.classList.remove('active'));
    activeTab.classList.add('active');
  }
  fetchAndRenderNews(currentCategory);
  const urlCity = new URL(location.href).searchParams.get('city');
  if (urlCity) { cityInput.value = urlCity; getWeatherByCity(urlCity); }

  // Supabase 認証初期化
  // onAuthStateChange のみで管理（getSession との競合を防ぐ）
  initAuthModal();
  document.getElementById('login-btn')?.addEventListener('click', () => {
    document.getElementById('auth-backdrop')?.classList.add('show');
  });
  // 通知状態を復元
  if (localStorage.getItem(LS.notif) === '1' && Notification.permission === 'granted') {
    notificationsEnabled = true;
    const nb = document.getElementById('notif-btn');
    if (nb) { nb.classList.remove('notif-btn-off'); nb.title = '通知ON（クリックでOFF）'; }
  }

  // フォントサイズ調整
  const fontSizes = ['font-sm', 'font-md', 'font-lg'];
  let fontSizeIdx = parseInt(localStorage.getItem(LS.fontSize) || '1');
  function applyFontSize(idx) {
    fontSizes.forEach(c => document.body.classList.remove(c));
    document.body.classList.add(fontSizes[idx]);
    const labels = ['ａ', 'Ａ', '𝐀'];
    const titles = ['小', '中', '大'];
    ['font-size-btn', 'font-size-btn-mobile'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) { btn.textContent = labels[idx] || 'Ａ'; btn.title = titles[idx] + ' フォントサイズ'; }
    });
  }
  applyFontSize(fontSizeIdx);
  ['font-size-btn', 'font-size-btn-mobile'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      fontSizeIdx = (fontSizeIdx + 1) % 3;
      applyFontSize(fontSizeIdx);
      localStorage.setItem(LS.fontSize, fontSizeIdx);
      // zoom変更でドロップダウンがずれるため閉じる
      document.getElementById('settings-dropdown')?.classList.remove('open');
    });
  });

  // manifest の ?action=geo / ?tab=news 対応
  const urlAction = new URL(location.href).searchParams.get('action');
  const urlTab    = new URL(location.href).searchParams.get('tab');
  if (urlAction === 'geo') getWeatherByGeo();
  if (urlTab === 'news') {
    document.querySelector('.news-tab[data-cat="general"]')?.scrollIntoView({ behavior: 'smooth' });
  }

  sbOnAuthChange((event, user) => {
    updateAuthUI(user);
    // INITIAL_SESSION: ページ読み込み時の既存セッション検出
    // SIGNED_IN: 新規ログイン完了
    if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && user) {
      sbLoadSettings().then(settings => {
        // settings が null = DB行未作成。ローカルデータをクラウドへ初期アップロード
        const s = settings || {};
        if (s.theme && (s.theme === 'dark' || s.theme === 'light')) applyTheme(s.theme);
        if (s.unit  && (s.unit  === 'metric' || s.unit === 'imperial')) applyUnit(s.unit);
        if (s.news_category && validCategories.includes(s.news_category)) {
          currentCategory = s.news_category;
          newsTabs.querySelectorAll('.news-tab').forEach(t => t.classList.remove('active'));
          newsTabs.querySelector('.news-tab[data-cat="' + currentCategory + '"]')?.classList.add('active');
          fetchAndRenderNews(currentCategory);
        }
        if (s.city) { cityInput.value = s.city; getWeatherByCity(s.city); }

        // お気に入り: クラウド ↔ ローカル 双方向マージ
        // ローカルにあってクラウドにないものも含めて統合し、クラウドへ書き戻す
        const cloudFavs  = Array.isArray(s.favorites) ? s.favorites : [];
        const localFavs  = loadFavorites();
        const mergedFavs = [...cloudFavs, ...localFavs.filter(c => !cloudFavs.includes(c))].slice(0, 10);
        if (mergedFavs.length) {
          localStorage.setItem(LS.favorites, JSON.stringify(mergedFavs));
          renderFavorites();
          // ローカルのみにあった項目があればクラウドを更新
          if (localFavs.some(c => !cloudFavs.includes(c))) sbSaveSettings({ favorites: mergedFavs });
        }

        // ニュース既読クラウド同期（ローカルとマージ）
        if (Array.isArray(s.news_read) && s.news_read.length) {
          const local = loadReadUrls();
          s.news_read.forEach(u => local.add(u));
          try { localStorage.setItem(LS.newsRead, JSON.stringify([...local].slice(-300))); } catch {}
        }
        // ニュースブックマーク復元（双方向マージ）
        const cloudBmarks = Array.isArray(s.news_bookmarks) ? s.news_bookmarks : [];
        const localBmarks = loadBookmarks();
        const localBUrls  = new Set(localBmarks.map(b => b.url));
        const mergedBmarks = [...localBmarks, ...cloudBmarks.filter(b => !localBUrls.has(b.url))].slice(0, 50);
        if (mergedBmarks.length) {
          localStorage.setItem(LS.bookmarks, JSON.stringify(mergedBmarks));
          if (cloudBmarks.some(b => !localBUrls.has(b.url))) sbSaveSettings({ news_bookmarks: mergedBmarks });
        }

        // 検索履歴クラウド同期
        if (Array.isArray(s.search_history) && s.search_history.length) {
          const local = loadHistory();
          const merged = [...s.search_history, ...local.filter(c => !s.search_history.includes(c))].slice(0, 8);
          localStorage.setItem(LS.history, JSON.stringify(merged));
          renderHistory();
          if (local.some(c => !s.search_history.includes(c))) sbSaveSettings({ search_history: merged });
        }

        // 音量設定復元
        if (s.volume != null) {
          const pct = Math.round(parseFloat(s.volume) * 100);
          const sl = document.getElementById('volume-slider');
          const lb = document.getElementById('volume-label');
          if (sl) { sl.value = pct; localStorage.setItem(LS.volume, s.volume); }
          if (lb) lb.textContent = pct + '%';
        }
        // 通知設定復元（既存の notif 復元と統合）
        if (s.notifications_enabled === 1 && Notification.permission === 'granted') {
          notificationsEnabled = true;
          const nb = document.getElementById('notif-btn');
          if (nb) { nb.classList.remove('notif-btn-off'); nb.title = '通知ON（クリックでOFF）'; }
          localStorage.setItem(LS.notif, '1');
        }
      });
      document.getElementById('auth-backdrop')?.classList.remove('show');
    }
  });
})();
