/* ========== СЧЁТЧИКИ САЙТА ==========
   Работают через публичный MQTT-брокер: без сервера, без регистрации.
   Каждый браузер получает свой id и раз в минуту сообщает «я здесь».
   - Всего посмотрели — сколько разных браузеров когда-либо заходили.
   - Сейчас смотрят  — сколько браузеров пинговали последние 2,5 минуты.
   Подключается только по https (браузер сам шифрует соединение). */
(function () {
  "use strict";

  var PREFIX = "xchara/gamesite/u/";
  var BROKERS = [
    "wss://broker.hivemq.com:8884/mqtt",
    "wss://test.mosquitto.org:8081/"
  ];
  var HEARTBEAT_MS = 60000;        // пинг «я онлайн» каждую минуту
  var ONLINE_WINDOW_MS = 150000;   // 2,5 минуты молчания = уже не онлайн
  var READ_WAIT_MS = 1200;         // сколько ждать снимок при чтении

  /* --- свой постоянный id браузера --- */
  var uid = null;
  try {
    uid = localStorage.getItem("gs_uid");
    if (!uid) {
      uid = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("gs_uid", uid);
    }
  } catch (e) {
    uid = "anon" + Math.random().toString(36).slice(2, 10);
  }

  var firstVisit = 0;
  try {
    firstVisit = Number(localStorage.getItem("gs_first")) || Date.now();
    localStorage.setItem("gs_first", String(firstVisit));
  } catch (e) {
    firstVisit = Date.now();
  }

  /* --- браузер разработчика: не считается посетителем --- */
  var isOwner = false;
  try { isOwner = localStorage.getItem("gs_owner") === "1"; } catch (e) {}

  /* --- подключение --- */
  var client = null;
  var starting = false;
  var waiters = [];
  var heartbeat = null;

  function flush(err) {
    var w = waiters;
    waiters = [];
    w.forEach(function (f) { f(err); });
  }

  function loadMqtt(done) {
    if (window.mqtt) return done(null);
    var urls = [
      "https://cdn.jsdelivr.net/npm/mqtt@5.3.5/dist/mqtt.min.js",
      "https://unpkg.com/mqtt@5.3.5/dist/mqtt.min.js"
    ];
    var i = 0;
    (function nextLib() {
      if (i >= urls.length) return done(new Error("нет MQTT-библиотеки"));
      var s = document.createElement("script");
      s.src = urls[i++];
      s.onload = function () { done(window.mqtt ? null : new Error("битая MQTT-библиотека")); };
      s.onerror = nextLib;
      document.head.appendChild(s);
    })();
  }

  function ownValue()     { return firstVisit + ":" + Date.now(); }
  function ownOffline()   { return firstVisit + ":0"; }

  function startHeartbeat(c) {
    if (heartbeat) clearInterval(heartbeat);
    var ping = function () {
      try { c.publish(PREFIX + uid, ownValue(), { qos: 0, retain: true }); } catch (e) {}
    };
    ping();
    heartbeat = setInterval(ping, HEARTBEAT_MS);
    var bye = function () {
      try { c.publish(PREFIX + uid, ownOffline(), { qos: 0, retain: true }); } catch (e) {}
    };
    window.addEventListener("pagehide", bye);
    window.addEventListener("beforeunload", bye);
  }

  function tryBroker(idx) {
    if (idx >= BROKERS.length) {
      starting = false;
      flush(new Error("нет связи со счётчиками"));
      return;
    }
    var done = false, c;
    try {
      c = window.mqtt.connect(BROKERS[idx], {
        clientId: "gs-" + uid.slice(0, 8) + "-" + Math.random().toString(16).slice(2, 8),
        connectTimeout: 10000,
        reconnectPeriod: 5000,
        keepalive: 30,
        will: { topic: PREFIX + uid, payload: isOwner ? "" : ownOffline(), qos: 0, retain: true }
      });
    } catch (e) {
      tryBroker(idx + 1);
      return;
    }
    var to = setTimeout(function () {
      if (done) return;
      done = true;
      try { c.end(true); } catch (e) {}
      tryBroker(idx + 1);
    }, 12000);

    c.on("connect", function () {
      if (done) return;
      done = true;
      clearTimeout(to);
      client = c;
      if (isOwner) {
        // разработчик: стираем свою прошлую запись и не пингуем
        try { c.publish(PREFIX + uid, "", { qos: 0, retain: true }); } catch (e) {}
      } else {
        startHeartbeat(c);
      }
      flush(null);
    });
    c.on("error", function () {
      if (done) return;
      done = true;
      clearTimeout(to);
      try { c.end(true); } catch (e) {}
      tryBroker(idx + 1);
    });
  }

  function ensure(cb) {
    if (client) return cb(null);
    waiters.push(cb);
    if (starting) return;
    starting = true;
    loadMqtt(function (err) {
      if (err) { starting = false; flush(err); return; }
      tryBroker(0);
    });
  }

  /* --- чтение статистики: снимок всех retained-записей --- */
  function read(cb) {
    ensure(function (err) {
      if (err) return cb(err);
      var snapshot = {};
      var handler = function (topic, payload) {
        if (topic.indexOf(PREFIX) !== 0) return;
        snapshot[topic.slice(PREFIX.length)] = String(payload);
      };
      client.on("message", handler);
      client.subscribe(PREFIX + "#", { qos: 0 }, function () {
        setTimeout(function () {
          try { client.removeListener("message", handler); } catch (e) {}
          try { client.unsubscribe(PREFIX + "#"); } catch (e) {}
          var now = Date.now(), total = 0, online = 0;
          for (var k in snapshot) {
            var parts = snapshot[k].split(":");
            var last = Number(parts[1]) || 0;
            total++;
            if (last > 0 && now - last < ONLINE_WINDOW_MS) online++;
          }
          // если своя запись ещё не вернулась — считаем себя
          // (кроме браузера разработчика — его не считаем)
          if (!isOwner && !Object.prototype.hasOwnProperty.call(snapshot, uid)) {
            total++;
            online++;
          }
          cb(null, { total: total, online: online });
        }, READ_WAIT_MS);
      });
    });
  }

  /* --- переключатель «считать/не считать этот браузер» --- */
  function applyOwnerState() {
    if (isOwner) {
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
      var c = client;
      if (c) {
        // стираем свою запись и переподключимся без «последнего сообщения»
        client = null;
        starting = false;
        try { c.publish(PREFIX + uid, "", { qos: 0, retain: true }); } catch (e) {}
        setTimeout(function () { try { c.end(true); } catch (e) {} }, 400);
      }
    } else if (client) {
      startHeartbeat(client);
    }
  }

  function setOwner(v) {
    isOwner = !!v;
    try {
      if (isOwner) localStorage.setItem("gs_owner", "1");
      else localStorage.removeItem("gs_owner");
    } catch (e) {}
    applyOwnerState();
  }

  // если флаг поменяли в другой вкладке этого же сайта
  window.addEventListener("storage", function (e) {
    if (e.key !== "gs_owner") return;
    isOwner = (e.newValue === "1");
    applyOwnerState();
  });

  /* --- сразу начинаем пинговать, чтобы сайт видел нас в «онлайн» --- */
  ensure(function () {});

  window.SITE_STATS = {
    uid: uid,
    read: read,
    setOwner: setOwner,
    isOwner: function () { return isOwner; }
  };
})();
