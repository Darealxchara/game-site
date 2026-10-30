/* ============ ГЛАВНЫЙ СКРИПТ САЙТА ============ */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- 1. Заголовок, версия, описание ---------- */
  document.title = GAME.title + " — играй в браузере";
  $$("[data-title]").forEach(function (e) { e.textContent = GAME.title; });
  $$("[data-tagline]").forEach(function (e) { e.textContent = GAME.tagline; });
  $$("[data-version]").forEach(function (e) { e.textContent = GAME.version; });
  $$("[data-buildpath]").forEach(function (e) { e.textContent = GAME.build; });
  $$("[data-copy]").forEach(function (e) {
    e.textContent = "© " + new Date().getFullYear() + " · " + GAME.title;
  });

  var meta = document.querySelector('meta[property="og:title"]');
  if (meta) meta.setAttribute("content", GAME.title);

  /* ---------- 2. Карточки «О игре» ---------- */
  var icons = ["✦", "★", "◆", "✧", "◈"];
  var wrap = $("[data-features]");
  GAME.features.forEach(function (f, i) {
    var el = document.createElement("div");
    el.className = "card";
    el.innerHTML =
      '<div class="ico">' + (icons[i % icons.length]) + '</div>' +
      '<h3></h3><p></p>';
    el.querySelector("h3").textContent = f[0];
    el.querySelector("p").textContent = f[1];
    wrap.appendChild(el);
  });

  /* ---------- 3. Скриншоты ---------- */
  var swrap = $("[data-shots]");
  GAME.shots.forEach(function (src, i) {
    var fig = document.createElement("figure");
    fig.className = "shot";
    fig.innerHTML =
      '<div class="ph">Скриншот ' + (i + 1) + '<br><small>' + src + '</small></div>';
    var img = new Image();
    img.alt = GAME.title + " — скриншот " + (i + 1);
    img.onload = function () { fig.appendChild(img); };
    img.src = src;
    swrap.appendChild(fig);
  });

  /* ---------- 4. Где лежит сборка: динамический поиск частей ----------
     Игра лежит на сайте кусками: game.part1.html, game.part2.html, …
     Сайт сам перебирает номера, пока куски не кончатся. Поэтому обновление
     с панели разработчика может быть любым по размеру — просто залей новый
     набор кусков, и всё соберётся заново. */
  var available = null; // null = не проверяли
  var mode = null;      // 'parts' = собирать из частей, 'file' = один файл
  var partList = null;   // найденные куски

  function probe(url) {
    return fetch(url, { method: "HEAD" })
      .then(function (r) { return r.ok; })
      .catch(function () { return null; }); // null = нет сети или file://
  }

  function discoverParts() {
    if (partList !== null) return Promise.resolve(partList);
    var found = [], n = 1, MAX = 80;
    function next() {
      if (n > MAX) { partList = found; return Promise.resolve(found); }
      var name = "game.part" + n + ".html";
      return probe(name).then(function (ok) {
        if (ok === true) { found.push(name); n++; return next(); }
        if (ok === null) {
          // нечем проверять (file://) — берём список из настроек
          partList = (GAME.parts && GAME.parts.length) ? GAME.parts.slice() : [];
          return partList;
        }
        partList = found; // 404 — конец списка
        return found;
      });
    }
    return next();
  }

  function checkBuild() {
    if (available !== null) return Promise.resolve(available);
    if (window.location.protocol === "file:") {
      mode = "file"; available = true;
      return Promise.resolve(true);
    }
    return discoverParts().then(function (list) {
      if (list && list.length) { mode = "parts"; available = true; return true; }
      return probe(GAME.build).then(function (ok) {
        if (ok === null || ok === true) { mode = "file"; available = true; return true; }
        available = false; // ни частей, ни файла — покажем подсказку
        return false;
      });
    });
  }

  // Собираем части обратно в один файл и отдаём его как blob-адрес
  function assemble() {
    return discoverParts().then(function (list) {
      if (!list || !list.length) return null;
      return Promise.all(list.map(function (p) {
        // cache:no-cache — после обновления сразу берём свежие куски
        return fetch(p, { cache: "no-cache" }).then(function (r) { return r.arrayBuffer(); });
      })).then(function (bufs) {
        return URL.createObjectURL(new Blob(bufs, { type: "text/html;charset=utf-8" }));
      });
    });
  }

  /* ---------- Кнопка скачивания ---------- */
  var dlBtns = $$("[data-download]");
  var zipOk = false, dlReady = false;

  function syncDownload() {
    dlBtns.forEach(function (b) {
      if (zipOk) {
        b.setAttribute("href", GAME.zip);
        b.setAttribute("download", "");
        b.removeAttribute("disabled");
      } else if (GAME.parts && GAME.parts.length) {
        // Архива нет — соберём файл на лету по нажатию
        b.setAttribute("href", "#");
        b.removeAttribute("download");
        b.removeAttribute("disabled");
      } else {
        b.setAttribute("disabled", "");
        b.removeAttribute("href");
        b.setAttribute("title", "Архив пока не загружен на сайт");
        b.textContent = "⬇ Архив не загружен";
      }
    });
    dlReady = true;
  }

  if (GAME.zip) {
    fetch(GAME.zip, { method: "HEAD" })
      .then(function (r) { zipOk = r.ok; syncDownload(); })
      .catch(function () { zipOk = false; syncDownload(); });
  } else {
    syncDownload();
  }

  dlBtns.forEach(function (b) {
    b.addEventListener("click", function (e) {
      if (zipOk) return;                       // обычный переход по ссылке
      if (!dlReady) { e.preventDefault(); return; }
      if (!GAME.parts || !GAME.parts.length) { e.preventDefault(); return; }
      e.preventDefault();
      if (b.dataset.busy) return;
      b.dataset.busy = "1";
      var old = b.textContent;
      b.textContent = "Собираем файл…";
      assemble().then(function (url) {
        if (!url) {
          b.textContent = old;
          delete b.dataset.busy;
          alert("Файл для скачивания пока не найден на сайте.");
          return;
        }
        var a = document.createElement("a");
        a.href = url;
        a.download = GAME.downloadName || "game.html";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
        b.textContent = old;
        delete b.dataset.busy;
      }).catch(function () {
        b.textContent = old;
        delete b.dataset.busy;
        alert("Не удалось собрать файл для скачивания.");
      });
    });
  });

  /* ---------- 5. Окно игры ---------- */
  var player  = $("#player"),
      frame   = $("#frame"),
      loader  = $("#loader"),
      errorBox= $("#errorBox");

  function openPlayer() {
    player.hidden = false;
    document.body.style.overflow = "hidden";
    loader.hidden = false;
    errorBox.hidden = true;

    checkBuild().then(function (ok) {
      if (!ok) {
        loader.hidden = true;
        errorBox.hidden = false;
        return;
      }
      if (mode === "parts") {
        // Собираем файл из частей прямо в браузере
        assemble().then(function (url) {
          gameUrl = url;
          frame.src = url;
        }).catch(function () {
          loader.hidden = true;
          errorBox.hidden = false;
        });
      } else {
        frame.src = GAME.build;
      }
    });
  }

  var gameUrl = null;

  function closePlayer() {
    player.hidden = true;
    frame.src = "about:blank";   // останавливаем звук игры
    if (gameUrl) { URL.revokeObjectURL(gameUrl); gameUrl = null; }
    document.body.style.overflow = "";
  }

  frame.addEventListener("load", function () { loader.hidden = true; });
  $("#closeBtn").addEventListener("click", closePlayer);
  $("#retryBtn").addEventListener("click", function () { available = null; openPlayer(); });

  $("#fsBtn").addEventListener("click", function () {
    var stage = $(".stage");
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (stage.requestFullscreen) {
      stage.requestFullscreen();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !player.hidden && !document.fullscreenElement) closePlayer();
  });

  $$("[data-play]").forEach(function (b) {
    b.addEventListener("click", openPlayer);
  });

  /* ---------- 6. Ссылки в подвале ---------- */
  var itch = $("[data-itch]"), gh = $("[data-github]");
  if (GAME.itch)  { itch.href = GAME.itch;  itch.hidden = false; }
  if (GAME.github){ gh.href  = GAME.github; gh.hidden  = false; }

  /* ---------- 7. Дата обновления игры (кладёт панель разработчика) ---------- */
  fetch("version.json?t=" + Date.now(), { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (v) {
      if (!v || !v.updated) return;
      var months = ["января", "февраля", "марта", "апреля", "мая", "июня",
                    "июля", "августа", "сентября", "октября", "ноября", "декабря"];
      var d = new Date(v.updated);
      var when = isNaN(d.getTime())
        ? String(v.updated)
        : d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
      if (v.version) {
        GAME.version = v.version;
        $$("[data-version]").forEach(function (e) { e.textContent = v.version; });
      }
      var el = $("[data-updated]");
      if (el) {
        el.textContent = "Игра обновлена: " + when + (v.version ? " · версия " + v.version : "");
        el.hidden = false;
      }
    })
    .catch(function () { /* version.json ещё нет — просто молчим */ });
})();
