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

  /* ---------- 4. Где лежит сборка: части или один файл ---------- */
  var available = null; // null = не проверяли
  var mode = null;      // 'parts' = собирать из частей, 'file' = один файл

  function probe(url) {
    return fetch(url, { method: "HEAD" })
      .then(function (r) { return r.ok; })
      .catch(function () { return null; }); // null = нет сети или file://
  }

  function checkBuild() {
    if (available !== null) return Promise.resolve(available);
    var probes = [];
    if (GAME.parts && GAME.parts.length) probes.push(GAME.parts[0]);
    if (GAME.build) probes.push(GAME.build);
    var i = 0, sawError = false;

    function next() {
      if (i >= probes.length) {
        // Ни один адрес не ответил (file:// и похожее) — считаем, что всё ок
        if (mode === null && sawError) { mode = "file"; available = true; }
        else available = (mode !== null);
        return Promise.resolve(available);
      }
      var url = probes[i++];
      return probe(url).then(function (ok) {
        if (ok === null) sawError = true;
        else if (ok) { mode = (url === GAME.build) ? "file" : "parts"; return true; }
        return next();
      });
    }
    return next();
  }

  // Собираем части обратно в один файл и отдаём его как blob-адрес
  function assemble() {
    if (!GAME.parts || !GAME.parts.length) return Promise.resolve(null);
    return Promise.all(GAME.parts.map(function (p) {
      return fetch(p).then(function (r) { return r.arrayBuffer(); });
    })).then(function (bufs) {
      return URL.createObjectURL(new Blob(bufs, { type: "text/html;charset=utf-8" }));
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
})();
