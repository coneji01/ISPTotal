(function () {
  var STORAGE_KEY = 'smartolt-night';
  // Per-device theme preference set ONLY by the header button (3-way:
  // light/night/system). Independent of the account/DB pref and never synced to
  // the server — it wins locally. STORAGE_KEY above only caches the resolved
  // night boolean for a flash-free initial paint.
  var STORAGE_LOCAL = 'smartolt-theme-local';
  var VALID_PREFS = ['light', 'night', 'system'];
  var COOKIE_KEY = 'smartolt-night';
  // Only the content placeholders have _night variants; RRD graphs
  // (/graphs_olt//traffic//signal//uplink/) are theme-identical, so we must NOT
  // cache-bust them on toggle or we needlessly re-trigger expensive PNG renders.
  var PLACEHOLDER_IMG_RE = /\/content\/img\/(?:no_img(?:_(?:small|big|dashboard))?(?:_night)?|acl_diagram_small(?:_night)?)\.png(?:\?|$)/i;
  // Only the no-data placeholders get the "no image" decoration (img hidden +
  // ::before SVG). The ACL diagram is a real content image — it must be theme
  // swapped (PLACEHOLDER_IMG_RE) but NOT decorated, or it renders as no-image.
  var NO_IMG_DECORATE_RE = /\/content\/img\/no_img(?:_(?:small|big|dashboard))?(?:_night)?\.png(?:\?|$)/i;
  // /graphs thumbnails: server 302s to no_img PNG but <img src> often keeps the RRD URL.
  var GRAPH_ENDPOINT_RE = /\/(?:traffic|signal)\/get_(?:hourly|daily|weekly|monthly|yearly)(?:_for_onu|_for_pon_port)?\/|\/graphs_olt\/|\/uplink\/|\/graphs\//i;
  var NO_IMG_BY_DIMENSIONS = [
    { w: 452, h: 147, size: 'small' },
    { w: 692, h: 251, size: 'dashboard' },
    { w: 482, h: 187, size: 'big' }
  ];
  // Set Secure only over TLS so a plaintext dev vhost can still persist the flag.
  var COOKIE_ATTRS = '; path=/; max-age=31536000; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');

  // /graphs listings can render hundreds of thumbnails; the default resource-timing
  // buffer (250) would evict the entries we rely on to detect the no-data 302 redirect.
  try {
    if (window.performance && performance.setResourceTimingBufferSize) {
      performance.setResourceTimingBufferSize(5000);
    }
  } catch (e) {}

  function imgSrcForCheck(img) {
    return img.currentSrc || img.src || img.getAttribute('src') || '';
  }

  function isPlaceholderImg(img) {
    return PLACEHOLDER_IMG_RE.test(imgSrcForCheck(img));
  }

  function placeholderSizeFromDimensions(img) {
    if (!img || !img.naturalWidth) {
      return null;
    }
    for (var i = 0; i < NO_IMG_BY_DIMENSIONS.length; i += 1) {
      var dim = NO_IMG_BY_DIMENSIONS[i];
      if (img.naturalWidth === dim.w && img.naturalHeight === dim.h) {
        return dim.size;
      }
    }
    return null;
  }

  function placeholderSizeFromSrc(src) {
    if (/no_img_small|acl_diagram_small|\/small(?:\/|$|\?|#)/i.test(src)) {
      return 'small';
    }
    if (/no_img_dashboard|\/dashboard(?:\/|$|\?|#)/i.test(src)) {
      return 'dashboard';
    }
    if (/no_img_big|\/big(?:\/|$|\?|#)/i.test(src)) {
      return 'big';
    }
    return 'big';
  }

  function isGraphsListingPage(el) {
    return !!(el && el.closest && el.closest('.content-wrap') && el.closest('.content-wrap').querySelector('form.graphs'));
  }

  function isGraphsModalImg(img) {
    return !!(img && img.closest && img.closest('#graphsModal'));
  }

  // On /graphs, a no-data thumbnail's RRD endpoint 302-redirects to the no_img PNG
  // while a real graph returns 200 directly. The <img src> stays the endpoint either
  // way and a real small graph has the exact pixel size of the placeholder, so neither
  // src nor dimensions can tell them apart — the same-origin redirect (exposed via
  // Resource Timing) is the only reliable discriminator.
  function imgWasRedirected(img) {
    try {
      if (!img || !img.src || !window.performance || !performance.getEntriesByName) {
        return false;
      }
      var entries = performance.getEntriesByName(img.src);
      if (!entries || !entries.length) {
        return false;
      }
      var entry = entries[entries.length - 1];
      return !!(entry && entry.redirectEnd - entry.redirectStart > 0);
    } catch (e) {
      return false;
    }
  }

  function isNoDataPlaceholderImg(img) {
    // /graphs listing + modal: only the no-data thumbnails (302 → no_img) get the
    // overlay; real data graphs return 200 and must be left untouched.
    if (isGraphsListingPage(img) || isGraphsModalImg(img)) {
      return imgWasRedirected(img);
    }
    var src = imgSrcForCheck(img);
    if (NO_IMG_DECORATE_RE.test(src)) {
      return true;
    }
    if (!img.complete || !img.naturalWidth) {
      return false;
    }
    if (!placeholderSizeFromDimensions(img)) {
      return false;
    }
    var rawSrc = img.getAttribute('src') || img.src || '';
    return GRAPH_ENDPOINT_RE.test(rawSrc) || GRAPH_ENDPOINT_RE.test(src) || NO_IMG_DECORATE_RE.test(rawSrc);
  }

  function clearGraphPlaceholderDecoration(img, inScope) {
    if (!img || !inScope(img)) {
      return;
    }
    var host = img.parentElement;
    img.classList.remove('smartolt-graph-placeholder');
    if (!host) {
      return;
    }
    host.classList.remove('smartolt-graph-placeholder-host');
    host.removeAttribute('data-smartolt-placeholder-size');
    host.removeAttribute('data-smartolt-placeholder-caption');
    var caption = host.querySelector('.smartolt-graph-placeholder-caption');
    if (caption) {
      caption.parentNode.removeChild(caption);
    }
  }

  function clearGraphsListingDecoration(img) {
    clearGraphPlaceholderDecoration(img, isGraphsListingPage);
  }

  function clearGraphsModalDecoration(img) {
    clearGraphPlaceholderDecoration(img, isGraphsModalImg);
  }

  function decorateGraphPlaceholder(img) {
    if (!img || img.classList.contains('smartolt-graph-placeholder-swapped')) {
      return;
    }

    if (!isNoDataPlaceholderImg(img)) {
      if (isGraphsListingPage(img)) {
        clearGraphsListingDecoration(img);
      }
      if (isGraphsModalImg(img)) {
        clearGraphsModalDecoration(img);
      }
      return;
    }

    var host = img.parentElement;
    if (!host) {
      return;
    }

    var src = imgSrcForCheck(img);
    var size = placeholderSizeFromDimensions(img) || placeholderSizeFromSrc(src);
    img.classList.add('smartolt-graph-placeholder');
    host.classList.add('smartolt-graph-placeholder-host');
    host.setAttribute('data-smartolt-placeholder-size', size);

    var graphsWrap = host.closest('.content-wrap[data-smartolt-graphs-placeholder-caption]');
    if (graphsWrap) {
      host.setAttribute(
        'data-smartolt-placeholder-caption',
        graphsWrap.getAttribute('data-smartolt-graphs-placeholder-caption') || 'No graph data yet'
      );
      var oldCaption = host.querySelector('.smartolt-graph-placeholder-caption');
      if (oldCaption) {
        oldCaption.parentNode.removeChild(oldCaption);
      }
    }
  }

  function bindGraphImg(img) {
    if (!img) {
      return;
    }

    // Listing/modal thumbnails are decorated only once the redirect is observable, so
    // the load handler (not just the synchronous pass) is what makes them work — the
    // resource-timing entry is present by the time load fires.
    if (img.dataset.smartoltPhBound !== '1') {
      img.dataset.smartoltPhBound = '1';
      img.addEventListener('load', function () {
        decorateGraphPlaceholder(img);
      });
      img.addEventListener('error', function () {
        decorateGraphPlaceholder(img);
      });
    }

    decorateGraphPlaceholder(img);
  }

  function rescanGraphPlaceholders(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('img').forEach(bindGraphImg);
  }

  function watchGraphPlaceholders() {
    if (typeof MutationObserver === 'undefined') {
      return;
    }

    var scanTimer;
    var scheduleScan = function () {
      if (scanTimer) {
        window.clearTimeout(scanTimer);
      }
      scanTimer = window.setTimeout(function () {
        rescanGraphPlaceholders();
      }, 50);
    };

    var observer = new MutationObserver(scheduleScan);
    var root = document.getElementById('content-wrapper') || document.body;
    // Watch src/style only — decoration keys off the img src, and the decoration
    // itself toggles classes inside this subtree, so watching 'class' would make
    // the observer re-trigger on its own mutations.
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style'] });

    // Graph thumbnails often redirect to no_img after the initial /graphs_* URL loads.
    var bootTicks = 0;
    var bootTimer = window.setInterval(function () {
      rescanGraphPlaceholders();
      bootTicks += 1;
      if (bootTicks >= 30) {
        window.clearInterval(bootTimer);
      }
    }, 500);
  }

  window.smartoltRescanGraphPlaceholders = rescanGraphPlaceholders;

  // The no_img / acl_diagram placeholders have light and _night PNG variants.
  // The server renders the correct one per the resolved-theme cookie, but a live
  // toggle must re-point already-rendered placeholders client-side (there is no
  // other src correction). Only these static placeholders are swapped — RRD
  // graph PNGs are theme-identical and must not be re-fetched.
  function swapPlaceholderImgForTheme(img, useNight) {
    if (!isPlaceholderImg(img)) {
      return;
    }

    var src = img.getAttribute('src') || img.src || '';
    var base = src.split('?')[0];
    var swapped = useNight
      ? base.replace(/(_night)?\.png$/i, '_night.png')
      : base.replace(/_night\.png$/i, '.png');

    if (swapped !== base) {
      img.src = swapped;
    }
  }

  function swapPlaceholdersForTheme(useNight) {
    document.querySelectorAll('img').forEach(function (img) {
      swapPlaceholderImgForTheme(img, useNight);
    });
  }

  // RRD graph endpoints (/graphs_olt/, /graphs/) 302-redirect to a theme-specific
  // no-data placeholder chosen server-side from the theme cookie. The <img src>
  // stays the endpoint URL (the redirect doesn't update currentSrc), so it can't
  // be swapped client-side — re-fetch it so the server re-evaluates the
  // now-updated cookie and serves the correct variant. Real RRD graphs are
  // theme-identical, so the only cost is a re-render; call this ONLY on an
  // explicit user toggle, never on load/system changes, to keep it rare.
  function reloadGraphEndpointImages() {
    document.querySelectorAll('img[src*="/graphs_olt/"], img[src*="/graphs/"]').forEach(function (img) {
      var src = img.getAttribute('src');
      if (!src) {
        return;
      }
      var base = src.split('?')[0].split('#')[0];
      img.src = base + '?_themeReload=' + Date.now();
    });
  }

  function syncNightCookie(on) {
    document.cookie = COOKIE_KEY + '=' + (on ? '1' : '0') + COOKIE_ATTRS;
  }

  function isNight() {
    return document.documentElement.classList.contains('smartolt-night');
  }

  function normalizePref(pref) {
    return VALID_PREFS.indexOf(pref) !== -1 ? pref : 'system';
  }

  function getLocalOverride() {
    try {
      var stored = localStorage.getItem(STORAGE_LOCAL);
      if (stored === 'night' || stored === 'light' || stored === 'system') {
        return stored;
      }
    } catch (e) {}

    return null;
  }

  function setLocalOverride(pref) {
    try {
      localStorage.setItem(STORAGE_LOCAL, normalizePref(pref));
    } catch (e) {}
  }

  // The header toggle only sets a per-device override (localStorage) and writes
  // the resolved-theme cookie the server reads. If neither can persist — cookies
  // blocked, or some incognito/privacy modes — the toggle can't do its job, so
  // it's hidden and we just render the account (DB) preference, or system.
  function canPersistTheme() {
    var lsOk = false;
    try {
      var lt = '__smartolt_theme_test__';
      localStorage.setItem(lt, '1');
      lsOk = localStorage.getItem(lt) === '1';
      localStorage.removeItem(lt);
    } catch (e) {}

    var cookieOk = false;
    try {
      var secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie = '__smartolt_theme_ctest__=1; path=/; SameSite=Lax' + secure;
      cookieOk = document.cookie.indexOf('__smartolt_theme_ctest__=1') !== -1;
      document.cookie = '__smartolt_theme_ctest__=; path=/; max-age=0; SameSite=Lax' + secure;
    } catch (e) {}

    return lsOk && cookieOk;
  }

  // Resolution precedence: per-device override (header button) wins; otherwise
  // the account/DB preference; otherwise follow the device (system). Mirrors the
  // inline boot script in backend_header.php.
  function effectivePref() {
    var local = getLocalOverride();
    if (local) {
      return local;
    }

    var db = window.SMARTOLT_DB_THEME;
    if (db === 'night' || db === 'light' || db === 'system') {
      return db;
    }

    return 'system';
  }

  function resolveNightFromPref(pref) {
    pref = normalizePref(pref);

    if (pref === 'night') {
      return true;
    }

    if (pref === 'light') {
      return false;
    }

    if (window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    return false;
  }

  // Header button cycles Light -> Night -> System -> Light.
  function nextPref(pref) {
    pref = normalizePref(pref);

    if (pref === 'light') {
      return 'night';
    }

    if (pref === 'night') {
      return 'system';
    }

    return 'light';
  }

  function isNetworkStatusChart(chart) {
    return !!(chart && chart.canvas && chart.canvas.id === 'onus-statuses-chart');
  }

  function isOnuViewChart(chart) {
    return !!(
      chart
      && chart.canvas
      && ['onu_traffic_chart', 'onu_signal_chart', 'live_graph_canvas'].indexOf(chart.canvas.id) !== -1
    );
  }

  function isGraphsPageChart(chart) {
    return !!(
      chart
      && chart.canvas
      && (
        chart.canvas.classList.contains('smartolt-graph-thumb')
        || chart.canvas.classList.contains('smartolt-graph-chart-canvas')
      )
    );
  }

  function setGraphsPageChartShell(chart, on) {
    if (!isGraphsPageChart(chart)) {
      return;
    }

    var chartBg = on ? 'rgba(2, 6, 23, 0.34)' : '#f5f5f5';
    var wrapBg = on ? 'rgba(15, 26, 46, 0.92)' : '#ffffff';
    var border = on ? '1px solid rgba(255, 255, 255, 0.08)' : '';
    var canvas = chart.canvas;

    canvas.style.backgroundColor = chartBg;

    var wrap = canvas.parentNode;
    if (wrap && (wrap.classList.contains('smartolt-graph-thumb-wrap') || wrap.classList.contains('smartolt-graph-chart-wrap'))) {
      wrap.style.backgroundColor = wrapBg;
      wrap.style.border = border;
    }
  }

  function setOnuViewChartShell(chart, on) {
    if (!isOnuViewChart(chart)) {
      return;
    }

    var canvas = chart.canvas;
    var chartBg = on ? 'rgba(2, 6, 23, 0.34)' : '#f5f5f5';
    var wrapBg = on ? 'rgba(15, 26, 46, 0.92)' : '#fff';
    var border = on ? '1px solid rgba(255, 255, 255, 0.08)' : '';
    var text = on ? '#cbd5e1' : '';

    canvas.style.backgroundColor = chartBg;
    canvas.style.borderColor = on ? 'rgba(255, 255, 255, 0.08)' : '';

    [
      canvas.parentNode,
      document.getElementById('onu_traffic_wrap'),
      document.getElementById('onu_signal_wrap'),
      document.getElementById('smartolt_live_graph')
    ].forEach(function (node) {
      if (!node || (node !== canvas.parentNode && node.querySelector && !node.querySelector('#' + canvas.id))) {
        return;
      }

      node.style.backgroundColor = wrapBg;
      node.style.borderColor = on ? 'rgba(255, 255, 255, 0.1)' : '';
      node.style.border = border;
    });

    ['onu_traffic_legend', 'onu_signal_legend'].forEach(function (id) {
      var legend = document.getElementById(id);
      if (legend) {
        legend.style.color = text;
      }
    });
  }

  function trendChartInstantiated() {
    if (typeof Chart === 'undefined' || !Chart.instances) {
      return false;
    }

    var asyncChartIds = ['trendChart', 'onu_traffic_chart', 'onu_signal_chart', 'live_graph_canvas'];
    var found = false;
    Chart.helpers.each(Chart.instances, function (chart) {
      if (chart && chart.canvas && asyncChartIds.indexOf(chart.canvas.id) !== -1) {
        found = true;
      }
    });

    return found;
  }

  // Last theme the network-status chart was rebuilt for. Tracked at module level
  // (not on the instance) because re-theming that chart destroys and recreates
  // it — a per-instance flag would be lost on the new instance and reload
  // forever. Only an actual theme flip should trigger the rebuild.
  var networkThemedNight = null;

  function applyChartTheme(on) {
    if (typeof Chart === 'undefined' || !Chart.instances) {
      return;
    }

    var tickColor = on ? '#94a3b8' : '#666666';
    var titleColor = on ? '#e2e8f0' : '#333333';
    var borderColor = on ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.15)';
    var gridAreaColor = on ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';

    Chart.defaults.global.defaultFontColor = tickColor;

    var needsNetworkStatusReload = networkThemedNight !== on;
    networkThemedNight = on;

    Chart.helpers.each(Chart.instances, function (chart) {
      try {
      // A chart with no canvas is mid-destroy (AJAX replace) — skip it. We must
      // NOT require chart.ctx: some Chart.js builds don't expose it on the
      // instance, and requiring it silently skipped live charts (ONU traffic /
      // signal) on toggle. Any genuine mid-destroy update() error is caught below.
      if (!chart || !chart.canvas) {
        return;
      }

      if (isNetworkStatusChart(chart)) {
        return;
      }

      // watchCharts() re-invokes applyChartTheme on every DOM mutation under
      // #content-wrapper (~10Hz on the dashboard). Without this guard each pass
      // calls chart.update() on every chart, restarting any open tooltip's fade
      // animation so it never settles — the bar chart tooltip flickers and never
      // sticks. Only touch a chart whose applied theme actually differs.
      if (chart.$smartoltThemedNight === on) {
        return;
      }

      var options = chart.options || {};

      if (options.title) {
        options.title.fontColor = titleColor;
      }

      if (options.tooltips) {
        options.tooltips.backgroundColor = on ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.96)';
        options.tooltips.titleFontColor = on ? '#f1f5f9' : '#1f2937';
        options.tooltips.bodyFontColor = on ? '#e2e8f0' : '#374151';
        options.tooltips.borderColor = on ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)';
      }

      setOnuViewChartShell(chart, on);
      setGraphsPageChartShell(chart, on);

      var scales = options.scales;

      if (!scales) {
        if (options.plugins && options.plugins.legend && options.plugins.legend.labels) {
          options.plugins.legend.labels.fontColor = tickColor;
        }
        chart.update();
        chart.$smartoltThemedNight = on;
        return;
      }

      ['yAxes', 'xAxes'].forEach(function (axisKey) {
        if (!scales[axisKey]) {
          return;
        }

        scales[axisKey].forEach(function (axis) {
          if (axis.ticks) {
            axis.ticks.fontColor = tickColor;
          }

          if (axis.scaleLabel) {
            axis.scaleLabel.fontColor = tickColor;
          }

          if (axis.gridLines) {
            // Keep each chart's layout (border vs grid area). Only swap colors
            // so ONU traffic/signal graphs stay readable after theme toggle.
            if (axis.gridLines.drawOnChartArea !== false) {
              axis.gridLines.color = gridAreaColor;
              axis.gridLines.zeroLineColor = borderColor;
            }

            if (axis.gridLines.drawBorder !== false) {
              axis.gridLines.borderColor = borderColor;
            }

            axis.gridLines.tickMarkColor = borderColor;
          }
        });
      });

      if (options.plugins && options.plugins.legend && options.plugins.legend.labels) {
        options.plugins.legend.labels.fontColor = tickColor;
      }

      if (options.legend && options.legend.labels) {
        options.legend.labels.fontColor = tickColor;
      }

      chart.update();
      setOnuViewChartShell(chart, on);
      setGraphsPageChartShell(chart, on);
      chart.$smartoltThemedNight = on;
      } catch (e) {
        // One chart's unexpected option shape (or a mid-destroy instance) must
        // not abort theming the rest — Chart.helpers.each stops on a thrown
        // callback, which had left later charts unthemed on toggle.
      }
    });

    if (needsNetworkStatusReload && typeof window.smartoltReloadNetworkStatusChartForTheme === 'function') {
      window.smartoltReloadNetworkStatusChartForTheme();
    }
  }

  window.smartoltApplyChartTheme = applyChartTheme;

  function watchCharts() {
    if (typeof MutationObserver === 'undefined') {
      return;
    }

    var applyTimer;
    var scheduleApply = function () {
      if (applyTimer) {
        window.clearTimeout(applyTimer);
      }
      applyTimer = window.setTimeout(function () {
        applyChartTheme(isNight());
      }, 50);
    };

    var observer = new MutationObserver(scheduleApply);

    [
      'adaptiveCharts',
      'trendChart',
      'onu_traffic_wrap',
      'onu_signal_wrap',
      'onu_traffic_container',
      'onu_signal_container',
      'smartolt_live_graph_container',
      'smartolt_live_graph',
      'content-wrapper'
    ].forEach(function (id) {
      var node = document.getElementById(id);
      if (!node) {
        return;
      }

      observer.observe(node.tagName === 'CANVAS' ? node.parentNode : node, {
        childList: true,
        subtree: true
      });
    });
  }

  // Applies the resolved night boolean to the page (theme class, cached flag,
  // cookie, charts, graph placeholders). Does NOT manage the toggle icon — that
  // is driven by the 3-way preference via updateTogglePrefUI().
  function setNight(on) {
    document.documentElement.classList.toggle('smartolt-night', on);

    try {
      localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch (e) {}

    syncNightCookie(on);
    swapPlaceholdersForTheme(on);
    applyChartTheme(on);
    rescanGraphPlaceholders();
  }

  // Reflects the 3-way preference (light/night/system) on the toggle button and
  // reveals it: the CSS keeps all icons hidden until the button carries BOTH
  // `is-resolved` and an `is-pref-*` class. Labels come from server-rendered
  // data-title-<pref> attributes so this static vendor file stays i18n-correct.
  function updateTogglePrefUI(pref) {
    var toggle = document.getElementById('smartolt-night-toggle');
    if (!toggle) {
      return;
    }

    pref = normalizePref(pref);
    toggle.classList.remove('is-pref-light', 'is-pref-night', 'is-pref-system');
    toggle.classList.add('is-pref-' + pref);
    toggle.classList.add('is-resolved');
    toggle.classList.toggle('is-night', isNight());

    var label = toggle.getAttribute('data-title-' + pref) || '';
    toggle.setAttribute('title', label);
    toggle.setAttribute('aria-label', label);
  }

  // Apply a preference to the page without recording it; callers decide whether
  // to persist it as a local override.
  function applyResolved(pref) {
    pref = normalizePref(pref);
    setNight(resolveNightFromPref(pref));
    updateTogglePrefUI(pref);
  }

  var systemMediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function onSystemThemeChange(e) {
    if (effectivePref() === 'system') {
      setNight(!!(e && typeof e.matches === 'boolean' ? e.matches : resolveNightFromPref('system')));
    }
  }

  if (systemMediaQuery) {
    if (typeof systemMediaQuery.addEventListener === 'function') {
      systemMediaQuery.addEventListener('change', onSystemThemeChange);
    } else if (typeof systemMediaQuery.addListener === 'function') {
      systemMediaQuery.addListener(onSystemThemeChange);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    rescanGraphPlaceholders();
    watchGraphPlaceholders();

    var canPersist = canPersistTheme();
    if (canPersist) {
      applyResolved(effectivePref());
    } else {
      // Apply the account (DB) or system theme without revealing the toggle:
      // a per-device choice can't be saved here, so offering it would mislead.
      setNight(resolveNightFromPref(effectivePref()));
    }

    watchCharts();

    if (
      document.getElementById('trendChart')
      || document.getElementById('onu_traffic_chart')
      || document.getElementById('onu_signal_chart')
      || document.getElementById('live_graph_canvas')
    ) {
      // Chart.js may instantiate these graphs asynchronously after load. Poll
      // until one exists (then theme once and stop) or give up after the cap.
      var CHART_BOOT_MAX_TRIES = 24; // 24 * 500ms = 12s ceiling
      var tries = 0;
      var chartBoot = window.setInterval(function () {
        tries += 1;
        applyChartTheme(isNight());
        if (trendChartInstantiated() || tries >= CHART_BOOT_MAX_TRIES) {
          window.clearInterval(chartBoot);
        }
      }, 500);
    }

    var toggle = document.getElementById('smartolt-night-toggle');
    if (!toggle) {
      return;
    }

    if (!canPersist) {
      // Hide the whole menu item so there's no empty/dead control.
      var toggleItem = (toggle.closest && toggle.closest('li')) || toggle.parentElement || toggle;
      toggleItem.style.display = 'none';
      return;
    }

    // Header button = per-device override only. Cycle Light -> Night -> System,
    // store the choice locally (localStorage + cookie via setNight); the user's
    // DB theme is written solely from the edit-user page.
    toggle.addEventListener('click', function (e) {
      e.preventDefault();
      var next = nextPref(effectivePref());
      setLocalOverride(next);
      applyResolved(next);
      // applyResolved() has just updated the theme cookie; re-fetch RRD-endpoint
      // graphs so their server-rendered no-data placeholders match the new theme.
      reloadGraphEndpointImages();
    });
  });
})();
