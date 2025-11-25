// script.js - Full weather app script (FINAL FIX)
// Asset path (uploaded favicon) - dev tool will transform this to a URL if needed
const ASSET_PATH = 'C:\\Users\\thera\\OneDrive\\Desktop\\weather-app\\assets\\images\\favicon.png';

// ===================================
// WEATHER APP - MAIN JAVASCRIPT
// ===================================

// Configuration
const CONFIG = {
  apiKey: "7ceb42d3bc1f4f7a82d62114252411",
  defaultCity: 'Kolkata',
  debounceDelay: 300,
  cacheExpiry: 600000, // 10 minutes
  batchSize: 5,
  batchDelay: 2000, // 2 seconds between batches
  autoRefreshInterval: 600000 // Auto-refresh every 10 minutes (600000ms)
};

// Major cities to display in the table
const MAJOR_CITIES = [
  'Kolkata', 'New Delhi', 'Mumbai', 'Chennai', 'Bengaluru',
  'Hyderabad', 'Lucknow', 'Ahmedabad', 'Varanasi'
];

// State management
const state = {
  currentCity: CONFIG.defaultCity,
  citiesData: new Map(),
  sortColumn: null,
  sortDirection: 'asc',
  focusedIndex: -1,
  isLoadingCities: false,
  weatherDataTimestamp: null, // SIMPLE: Just store when we GOT the data
  timestampInterval: null,
  autoRefreshInterval: null
};

// DOM elements (populated on DOMContentLoaded)
let DOM = {};

// ===================================
// UTILITY FUNCTIONS
// ===================================

function debounce(fn, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(this, args), wait);
  };
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

function formatDate(dateStr) {
  try {
    const date = new Date(dateStr);
    
    // Format: 25 November 2025, 14:30:45
    const day = date.getDate();
    const month = date.toLocaleString('en-US', { month: 'long' });
    const year = date.getFullYear();
    
    // 24-hour format time
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${day} ${month} ${year}, ${hours}:${minutes}:${seconds}`;
  } catch {
    return '-';
  }
}

function getCurrentTimestampIST() {
  const now = new Date();
  
  // Convert to IST (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  
  const dayName = istTime.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }).toUpperCase();
  const day = istTime.getUTCDate();
  const month = istTime.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }).toUpperCase();
  const year = istTime.getUTCFullYear();
  
  const hours = String(istTime.getUTCHours()).padStart(2, '0');
  const minutes = String(istTime.getUTCMinutes()).padStart(2, '0');
  const seconds = String(istTime.getUTCSeconds()).padStart(2, '0');
  
  return `${dayName}, ${day} ${month} ${year}, ${hours}:${minutes}:${seconds} IST`;
}

// SIMPLE VERSION - Just calculate time since we got the data
function getTimeSinceUpdate() {
  if (!state.weatherDataTimestamp) {
    return 'UNKNOWN';
  }
  
  const now = Date.now();
  const diffMs = now - state.weatherDataTimestamp;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  
  if (diffSeconds < 30) {
    return 'JUST NOW';
  } else if (diffSeconds < 60) {
    return `${diffSeconds} SECONDS AGO`;
  } else if (diffMinutes === 1) {
    return '1 MINUTE AGO';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} MINUTES AGO`;
  } else {
    const hours = Math.floor(diffMinutes / 60);
    if (hours === 1) {
      return '1 HOUR AGO';
    } else {
      return `${hours} HOURS AGO`;
    }
  }
}

function calculateDewPoint(temp, humidity) {
  return temp - ((100 - humidity) / 5);
}

function getTemperatureClass(temp) {
  if (temp >= 35) return 'temp-hot';
  if (temp >= 25) return 'temp-warm';
  if (temp >= 15) return 'temp-mild';
  return 'temp-cold';
}

function getConditionClass(condition) {
  const lower = (condition || '').toLowerCase();
  if (lower.includes('sun') || lower.includes('clear')) return 'condition-clear';
  if (lower.includes('cloud')) return 'condition-cloudy';
  if (lower.includes('rain') || lower.includes('drizzle') || lower.includes('storm')) return 'condition-rainy';
  return 'condition-cloudy';
}

function getUVClass(uv) {
  if (uv == null) return '';
  if (uv <= 2) return 'uv-low';
  if (uv <= 7) return 'uv-moderate';
  return 'uv-high';
}

// ===================================
// API FUNCTIONS
// ===================================

async function fetchCurrentWeather(city) {
  const url = `https://api.weatherapi.com/v1/current.json?key=${CONFIG.apiKey}&q=${encodeURIComponent(city)}&aqi=yes`;
  return fetchJson(url);
}

async function fetchForecast(city) {
  const url = `https://api.weatherapi.com/v1/forecast.json?key=${CONFIG.apiKey}&q=${encodeURIComponent(city)}&days=7&aqi=no`;
  return fetchJson(url);
}

async function searchCities(query) {
  const url = `https://api.weatherapi.com/v1/search.json?key=${CONFIG.apiKey}&q=${encodeURIComponent(query)}`;
  return fetchJson(url);
}

// ===================================
// AUTOCOMPLETE FUNCTIONALITY
// ===================================

let fetchSuggestions = null;

fetchSuggestions = debounce(async (query) => {
  const term = query.trim();
  if (!term) {
    hideSuggestions();
    return;
  }

  DOM.suggestionsBox.style.display = 'block';
  DOM.suggestionsBox.innerHTML = '<div class="list-group-item">Searching...</div>';

  try {
    const searchResults = await searchCities(term);

    if (!Array.isArray(searchResults) || searchResults.length === 0) {
      DOM.suggestionsBox.innerHTML = '<div class="list-group-item text-muted">No results found</div>';
      return;
    }

    const limited = searchResults.slice(0, 7);

    const withTemps = await Promise.all(
      limited.map(async (loc) => {
        try {
          const locQuery = `${loc.lat},${loc.lon}`;
          const data = await fetchCurrentWeather(locQuery);
          return { loc, temp: data.current?.temp_c ?? null, raw: data };
        } catch {
          return { loc, temp: null, raw: null };
        }
      })
    );

    renderSuggestions(withTemps);

  } catch (err) {
    console.error('Autocomplete error:', err);
    DOM.suggestionsBox.innerHTML = '<div class="list-group-item text-danger">Failed to search</div>';
  }
}, CONFIG.debounceDelay);

function renderSuggestions(suggestions) {
  DOM.suggestionsBox.innerHTML = '';

  suggestions.forEach((item) => {
    const { loc, temp, raw } = item;
    const displayName = `${loc.name}${loc.region ? ', ' + loc.region : ''}${loc.country ? ', ' + loc.country : ''}`;
    const tempText = temp != null ? `${Math.round(temp)}°C` : '—';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center';
    button.innerHTML = `
      <div class="small text-start">${displayName}</div>
      <div class="fw-bold">${tempText}</div>
    `;

    button.addEventListener('click', () => {
      if (raw && raw.location) {
        renderCurrentWeather(raw);
        loadForecast(raw.location.name).catch(() => {});
        DOM.cityInput.value = `${raw.location.name}${raw.location.region ? ', ' + raw.location.region : ''}`;
        state.currentCity = raw.location.name;
        renderCitiesTable(DOM.tableSearch.value);
      } else {
        loadWeatherForCity(displayName);
      }
      hideSuggestions();
    });

    DOM.suggestionsBox.appendChild(button);
  });

  state.focusedIndex = -1;
  const items = DOM.suggestionsBox.querySelectorAll('.list-group-item');
  items.forEach((it, i) => {
    it.addEventListener('mouseover', () => {
      items.forEach(x => x.classList.remove('active'));
      it.classList.add('active');
      state.focusedIndex = i;
    });
  });
}

function hideSuggestions() {
  if (DOM && DOM.suggestionsBox) {
    DOM.suggestionsBox.style.display = 'none';
    DOM.suggestionsBox.innerHTML = '';
  }
  state.focusedIndex = -1;
}

// ===================================
// TIMESTAMP UPDATE - SIMPLE VERSION
// ===================================

function updateTimestampDisplay() {
  if (!DOM.lastUpdated) return;
  
  const timestamp = getCurrentTimestampIST();
  const timeSince = getTimeSinceUpdate();
  
  DOM.lastUpdated.innerHTML = `
    <div class="fw-bold">TIMESTAMP: ${timestamp}</div>
    <div class="text-muted">LAST UPDATED: ${timeSince}</div>
  `;
}

function startTimestampUpdates() {
  // Clear any existing interval
  if (state.timestampInterval) {
    clearInterval(state.timestampInterval);
  }
  
  // Update immediately
  updateTimestampDisplay();
  
  // Update every second
  state.timestampInterval = setInterval(updateTimestampDisplay, 1000);
}

function stopTimestampUpdates() {
  if (state.timestampInterval) {
    clearInterval(state.timestampInterval);
    state.timestampInterval = null;
  }
}

function startAutoRefresh() {
  if (state.autoRefreshInterval) {
    clearInterval(state.autoRefreshInterval);
  }
  
  state.autoRefreshInterval = setInterval(() => {
    console.log('Auto-refreshing weather...');
    if (state.currentCity) {
      loadWeatherForCity(state.currentCity);
    }
  }, CONFIG.autoRefreshInterval);
}

function stopAutoRefresh() {
  if (state.autoRefreshInterval) {
    clearInterval(state.autoRefreshInterval);
    state.autoRefreshInterval = null;
  }
}

// ===================================
// WEATHER DATA RENDERING
// ===================================

function renderCurrentWeather(data) {
  if (!data || !data.location || !data.current) {
    console.error('Invalid weather data');
    return;
  }

  const { location: loc, current: cur } = data;

  // SIMPLE: Just mark when we received the data
  state.weatherDataTimestamp = Date.now();

  // Update page title
  DOM.pageTitle.textContent = `Weather for ${loc.name}${loc.region ? ', ' + loc.region : ''}`;

  // Current weather card
  DOM.currentTemp.textContent = `${Math.round(cur.temp_c)}°C`;
  DOM.currentDesc.textContent = cur.condition?.text || '—';
  DOM.feelsLike.textContent = cur.feelslike_c != null ? `${Math.round(cur.feelslike_c)}°C` : '--';
  DOM.weatherMain.textContent = cur.condition?.text || '—';

  // Stats
  DOM.humidity.textContent = cur.humidity != null ? `${cur.humidity}%` : '--';
  DOM.wind.textContent = cur.wind_kph != null ? `${Math.round(cur.wind_kph)} km/h` : '--';
  DOM.visibility.textContent = cur.vis_km != null ? `${cur.vis_km} km` : '--';
  DOM.pressure.textContent = cur.pressure_mb != null ? `${cur.pressure_mb} hPa` : '--';
  DOM.uvi.textContent = cur.uv != null ? cur.uv : '--';

  const dewPoint = calculateDewPoint(cur.temp_c, cur.humidity);
  DOM.dewPoint.textContent = `${Math.round(dewPoint)}°C`;

  // AQI
  if (cur.air_quality && (cur.air_quality['us-epa-index'] != null || cur.air_quality['us-epa'] != null )) {
    DOM.aqiValue.textContent = cur.air_quality['us-epa-index'] ?? cur.air_quality['us-epa'] ?? '—';
  } else {
    DOM.aqiValue.textContent = '—';
  }

  state.currentCity = loc.name;

  // Start updates
  startTimestampUpdates();
  startAutoRefresh();
}

function renderForecast(forecastDays) {
  DOM.forecastRow.innerHTML = '';

  if (!forecastDays || !forecastDays.length) {
    DOM.forecastRow.innerHTML = '<div class="col-12">No forecast available</div>';
    return;
  }

  forecastDays.forEach((day) => {
    const date = new Date(day.date);
    const dayName = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const condition = day.day.condition?.text || '';

    const card = document.createElement('div');
    card.className = 'col-6 col-md-4 col-lg-3';
    card.innerHTML = `
      <div class="border rounded p-2 forecast-day h-100 text-center glass">
        <div class="small text-muted">${dayName}</div>
        <div class="fw-bold">${Math.round(day.day.avgtemp_c)}°C</div>
        <div class="small">${condition}</div>
        <div class="small text-muted">H ${Math.round(day.day.maxtemp_c)}° / L ${Math.round(day.day.mintemp_c)}°</div>
      </div>
    `;
    DOM.forecastRow.appendChild(card);
  });
}

// ===================================
// CITIES TABLE MANAGEMENT
// ===================================

async function loadAllCitiesWeather() {
  if (state.isLoadingCities) return;

  state.isLoadingCities = true;
  setLoadingState(true);

  try {
    const batches = [];
    for (let i = 0; i < MAJOR_CITIES.length; i += CONFIG.batchSize) {
      batches.push(MAJOR_CITIES.slice(i, i + CONFIG.batchSize));
    }

    let loadedCount = 0;

    for (const [batchIndex, batch] of batches.entries()) {
      const promises = batch.map(async (city) => {
        try {
          const data = await fetchCurrentWeather(city);
          state.citiesData.set(city, {
            data,
            timestamp: new Date().getTime()
          });
          loadedCount++;
          DOM.citiesCount.textContent = loadedCount;
          return { city, data, error: null };
        } catch (error) {
          console.error(`Failed to fetch ${city}:`, error);
          return { city, data: null, error };
        }
      });

      await Promise.all(promises);
      renderCitiesTable();

      if (batchIndex < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.batchDelay));
      }
    }

    renderCitiesTable();

  } catch (error) {
    console.error('Error loading cities:', error);
    showTableError('Failed to load weather data. Please try again.');
  } finally {
    state.isLoadingCities = false;
    setLoadingState(false);
  }
}

function renderCitiesTable(filterText = '') {
  const tbody = DOM.citiesTableBody;
  tbody.innerHTML = '';

  if (state.citiesData.size === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="text-center py-4 text-muted">
          No weather data available. Click "Refresh All" to load data.
        </td>
      </tr>
    `;
    return;
  }

  let citiesArray = Array.from(state.citiesData.entries())
    .map(([city, cached]) => ({ city, ...cached }))
    .filter(item => item.data);

  if (filterText) {
    const lower = filterText.toLowerCase();
    citiesArray = citiesArray.filter(item =>
      item.city.toLowerCase().includes(lower)
    );
  }

  if (state.sortColumn) {
    citiesArray.sort((a, b) => {
      let aVal, bVal;

      switch (state.sortColumn) {
        case 'city':
          aVal = a.city.toLowerCase();
          bVal = b.city.toLowerCase();
          break;
        case 'temp':
          aVal = a.data.current.temp_c;
          bVal = b.data.current.temp_c;
          break;
        case 'humidity':
          aVal = a.data.current.humidity;
          bVal = b.data.current.humidity;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return state.sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return state.sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }

  citiesArray.forEach(({ city, data }) => {
    const row = createCityRow(city, data);
    tbody.appendChild(row);
  });

  DOM.citiesCount.textContent = citiesArray.length;
}

function createCityRow(city, data) {
  const { location: loc, current: cur } = data;
  const dewPoint = calculateDewPoint(cur.temp_c, cur.humidity);
  const isCurrentCity = city === state.currentCity;

  const row = document.createElement('tr');
  if (isCurrentCity) row.classList.add('highlighted');

  const tempClass = getTemperatureClass(cur.temp_c);
  const conditionClass = getConditionClass(cur.condition?.text || '');
  const uvClass = getUVClass(cur.uv);

  row.innerHTML = `
    <th class="text-start">${loc.name}</th>
    <td class="${tempClass}">${Math.round(cur.temp_c)}°C</td>
    <td><span class="condition-badge ${conditionClass}">${cur.condition?.text || '—'}</span></td>
    <td>${cur.humidity != null ? cur.humidity + '%' : '--'}</td>
    <td>${cur.wind_kph != null ? Math.round(cur.wind_kph) + ' km/h' : '--'}</td>
    <td>${cur.vis_km != null ? cur.vis_km + ' km' : '--'}</td>
    <td>${cur.pressure_mb != null ? cur.pressure_mb + ' hPa' : '--'}</td>
    <td class="${uvClass}">${cur.uv != null ? cur.uv : '--'}</td>
    <td>${Math.round(dewPoint)}°C</td>
    <td class="small">${formatDate(cur.last_updated)}</td>
    <td>${cur.gust_kph ? Math.round(cur.gust_kph) + ' km/h' : '--'}</td>
  `;

  row.style.cursor = 'pointer';
  row.addEventListener('click', () => {
    loadWeatherForCity(city);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  return row;
}

function setLoadingState(isLoading) {
  if (!DOM.refreshCitiesBtn || !DOM.refreshCitiesSpinner || !DOM.refreshCitiesText) return;
  DOM.refreshCitiesBtn.disabled = isLoading;
  DOM.refreshCitiesSpinner.classList.toggle('d-none', !isLoading);
  DOM.refreshCitiesText.textContent = isLoading ? 'Loading...' : 'Refresh All';
}

function showTableError(message) {
  DOM.citiesTableBody.innerHTML = `
    <tr>
      <td colspan="11" class="text-center py-4 text-danger">
        <strong>Error:</strong> ${message}
      </td>
    </tr>
  `;
}

// ===================================
// SORTING & FILTERING
// ===================================

function setupTableSorting() {
  document.querySelectorAll('.sortable').forEach(header => {
    header.addEventListener('click', () => {
      const column = header.dataset.sort;

      if (state.sortColumn === column) {
        state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortColumn = column;
        state.sortDirection = 'asc';
      }

      document.querySelectorAll('.sortable').forEach(h => {
        h.classList.remove('sort-asc', 'sort-desc');
      });
      header.classList.add(`sort-${state.sortDirection}`);

      renderCitiesTable(DOM.tableSearch.value);
    });
  });
}

// ===================================
// HEADER NAVIGATION / FOOTER SCROLL
// ===================================

function scrollToSectionByElement(sectionEl) {
  if (!sectionEl) return;
  
  const headerHeight = document.querySelector('.header-glass')?.offsetHeight || 80;
  const elementPosition = sectionEl.getBoundingClientRect().top;
  const offsetPosition = elementPosition + window.pageYOffset - headerHeight - 20;
  
  window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
  
  sectionEl.style.transition = 'box-shadow 0.35s, transform 0.35s';
  sectionEl.style.boxShadow = '0 10px 40px rgba(0,229,255,0.12)';
  sectionEl.style.transform = 'translateY(-3px)';
  
  setTimeout(() => {
    sectionEl.style.boxShadow = '';
    sectionEl.style.transform = '';
  }, 900);
}

function attachFooterScrollToLinks() {
  document.querySelectorAll('a.nav-link[href^="#"], a[data-scroll-to]').forEach(link => {
    link.addEventListener('click', e => {
      const href = link.getAttribute('href');
      const dataScrollTo = link.getAttribute('data-scroll-to');
      let targetId = null;

      if (href && href.startsWith('#')) targetId = href.slice(1);
      if (dataScrollTo) targetId = dataScrollTo;

      if (targetId) {
        const section = document.getElementById(targetId);
        if (section) {
          e.preventDefault();
          const navbarCollapse = document.getElementById('navbarSupportedContent');
          if (navbarCollapse?.classList.contains('show')) {
            const bsCollapse = bootstrap.Collapse.getInstance(navbarCollapse) ||
              new bootstrap.Collapse(navbarCollapse, { toggle: false });
            bsCollapse.hide();
          }
          scrollToSectionByElement(section);
        }
      }
    });
  });
}

// ===================================
// MAIN WEATHER LOADING
// ===================================

async function loadWeatherForCity(city) {
  try {
    DOM.currentTemp.textContent = 'Loading...';

    const currentData = await fetchCurrentWeather(city);
    renderCurrentWeather(currentData);
    await loadForecast(currentData.location.name);

    DOM.cityInput.value = `${currentData.location.name}${currentData.location.region ? ', ' + currentData.location.region : ''}`;
    state.currentCity = currentData.location.name;

    renderCitiesTable(DOM.tableSearch.value);

  } catch (error) {
    console.error('Error loading weather:', error);
    alert('Failed to load weather for that location.');
    DOM.currentTemp.textContent = '--°C';
  }
}

async function loadForecast(city) {
  try {
    const forecastData = await fetchForecast(city);

    if (forecastData?.forecast?.forecastday) {
      renderForecast(forecastData.forecast.forecastday);

      if (forecastData.location?.tz_id) {
        DOM.timezoneLabel.textContent = forecastData.location.tz_id;
      }
    }
  } catch (error) {
    console.error('Forecast error:', error);
    DOM.forecastRow.innerHTML = '<div class="col-12 text-danger">Failed to load forecast</div>';
  }
}

function searchCity() {
  const query = DOM.cityInput.value.trim() || CONFIG.defaultCity;
  loadWeatherForCity(query);
  hideSuggestions();
}

// ===================================
// EVENT LISTENERS SETUP
// ===================================

function setupEventListeners() {
  DOM.searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    searchCity();
  });

  DOM.cityInput.addEventListener('input', (e) => {
    const value = e.target.value;
    if (!value) {
      hideSuggestions();
      return;
    }
    fetchSuggestions(value);
  });

  DOM.cityInput.addEventListener('keydown', (e) => {
    const items = DOM.suggestionsBox.querySelectorAll('.list-group-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.focusedIndex = Math.min(state.focusedIndex + 1, items.length - 1);
      items.forEach((item, i) => item.classList.toggle('active', i === state.focusedIndex));
      items[state.focusedIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.focusedIndex = Math.max(state.focusedIndex - 1, 0);
      items.forEach((item, i) => item.classList.toggle('active', i === state.focusedIndex));
      items[state.focusedIndex]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (state.focusedIndex >= 0 && items[state.focusedIndex]) {
        items[state.focusedIndex].click();
      } else {
        searchCity();
      }
    } else if (e.key === 'Escape') {
      hideSuggestions();
    } else {
      state.focusedIndex = -1;
    }
  });

  document.addEventListener('click', (e) => {
    if (!DOM.suggestionsBox.contains(e.target) && e.target !== DOM.cityInput) {
      hideSuggestions();
    }
  });

  DOM.locBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude: lat, longitude: lon } = position.coords;
        await loadWeatherForCity(`${lat},${lon}`);
      },
      (error) => {
        alert(`Location error: ${error.message || 'Access denied'}`);
      }
    );
  });

  DOM.refreshBtn.addEventListener('click', () => {
    loadWeatherForCity(state.currentCity);
  });

  DOM.tableSearch.addEventListener('input', (e) => {
    renderCitiesTable(e.target.value);
  });

  DOM.refreshCitiesBtn.addEventListener('click', () => {
    state.citiesData.clear();
    loadAllCitiesWeather();
  });

  setupTableSorting();
}

// ===================================
// CLEANUP
// ===================================

window.addEventListener('beforeunload', () => {
  stopTimestampUpdates();
  stopAutoRefresh();
});

// ===================================
// INITIALIZATION
// ===================================

async function init() {
  DOM = {
    cityInput: document.getElementById('cityInput'),
    suggestionsBox: document.getElementById('suggestions'),
    pageTitle: document.getElementById('pageTitle'),
    lastUpdated: document.getElementById('lastUpdated'),
    locBtn: document.getElementById('locBtn'),
    refreshBtn: document.getElementById('refreshBtn'),
    forecastRow: document.getElementById('forecastRow'),
    timezoneLabel: document.getElementById('timezoneLabel'),
    aqiValue: document.getElementById('aqiValue'),
    citiesTableBody: document.getElementById('citiesTableBody'),
    searchForm: document.getElementById('searchForm'),
    tableSearch: document.getElementById('tableSearch'),
    refreshCitiesBtn: document.getElementById('refreshCitiesBtn'),
    refreshCitiesSpinner: document.getElementById('refreshCitiesSpinner'),
    refreshCitiesText: document.getElementById('refreshCitiesText'),
    citiesCount: document.getElementById('citiesCount'),
    currentTemp: document.getElementById('currentTemp'),
    currentDesc: document.getElementById('currentDesc'),
    feelsLike: document.getElementById('feelsLike'),
    weatherMain: document.getElementById('weatherMain'),
    humidity: document.getElementById('humidity'),
    wind: document.getElementById('wind'),
    visibility: document.getElementById('visibility'),
    pressure: document.getElementById('pressure'),
    uvi: document.getElementById('uvi'),
    dewPoint: document.getElementById('dewPoint')
  };

  if (!DOM.cityInput || !DOM.suggestionsBox || !DOM.citiesTableBody) {
    console.error('Required DOM elements missing. Check IDs in HTML.');
    return;
  }

  hideSuggestions();
  setupEventListeners();
  attachFooterScrollToLinks();

  DOM.cityInput.value = CONFIG.defaultCity;
  try {
    await loadWeatherForCity(CONFIG.defaultCity);
  } catch (e) {
    console.warn('Initial city load failed:', e);
  }

  loadAllCitiesWeather().catch(e => console.warn('loadAllCitiesWeather failed', e));
  console.log('Weather App initialized');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
