/* Каталог рецептов: поиск, указатели, карточки и редактор.
   Данные берутся из data/catalog.js (его собирает scripts/build.py). */
(function () {
  "use strict";

  var CATALOG = window.CATALOG || { recipes: [] };
  var CFG = Object.assign({ owner: "", repo: "", branch: "main", recipesDir: "recipes" },
    window.SITE_CONFIG || {});
  var PAGE = 40;
  var NO_PLANTS = "нет, не растительное средство";

  // Владелец и репозиторий по адресу вида имя.github.io/репозиторий
  (function detectRepo() {
    var host = location.hostname;
    if (!CFG.owner && /\.github\.io$/i.test(host)) CFG.owner = host.split(".")[0];
    if (!CFG.repo && CFG.owner && /\.github\.io$/i.test(host)) {
      var first = location.pathname.split("/").filter(Boolean)[0];
      CFG.repo = first && !/\.html?$/.test(first) ? decodeURIComponent(first) : host;
    }
  })();
  var REPO_URL = CFG.owner && CFG.repo ? "https://github.com/" + CFG.owner + "/" + CFG.repo : "";

  /* ---------- Утилиты ---------- */

  var app = document.getElementById("app");
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function norm(s) { return String(s || "").toLowerCase().replace(/ё/g, "е"); }
  function enc(s) { return encodeURIComponent(s); }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function recipesWord(n) { return n + " " + plural(n, "рецепт", "рецепта", "рецептов"); }
  var collator = new Intl.Collator("ru");
  function byName(a, b) { return collator.compare(a, b); }
  function uniq(arr) { var s = {}; return arr.filter(function (x) { if (!x || s[x]) return false; s[x] = 1; return true; }); }
  function toast(text) {
    var t = document.getElementById("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.classList.remove("show"); }, 3500);
  }
  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast(okMsg || "Скопировано"); } catch (e) { toast("Не удалось скопировать"); }
      ta.remove();
    }
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { toast(okMsg || "Скопировано"); }, fallback);
    }
    fallback();
    return Promise.resolve();
  }
  var store = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* без хранилища */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* без хранилища */ } }
  };

  /* ---------- Индексы ---------- */

  var recipes = CATALOG.recipes.slice().sort(function (a, b) { return byName(a.title, b.title); });
  var byId = {};
  var diseases = {}, plants = {}, others = {}, sections = {};
  var plantCats = {}, otherCats = {};
  function add(map, key, r) { (map[key] = map[key] || []).push(r); }

  recipes.forEach(function (r) {
    byId[r.id] = r;
    r.diseases.forEach(function (d) { add(diseases, d, r); });
    add(sections, r.section, r);
    r.plants.forEach(function (p) {
      plants[p.name] = plants[p.name] || { cat: p.cat, list: [] };
      plants[p.name].list.push(r);
      (plantCats[p.cat] = plantCats[p.cat] || {})[p.name] = 1;
    });
    r.others.forEach(function (p) {
      others[p.name] = others[p.name] || { cat: p.cat, list: [] };
      others[p.name].list.push(r);
      (otherCats[p.cat] = otherCats[p.cat] || {})[p.name] = 1;
    });
    r.hay = {
      title: norm(r.title),
      dis: norm(r.diseases.join(" · ")),
      comp: norm(r.plants.concat(r.others).map(function (p) { return p.name; }).join(" · ")),
      sec: norm(r.section),
      body: norm(r.body)
    };
  });
  var diseaseNames = Object.keys(diseases).sort(byName);
  var plantNames = Object.keys(plants).sort(byName);
  var otherNames = Object.keys(others).sort(byName);
  var sectionNames = Object.keys(sections).sort(byName);

  /* ---------- Поиск ---------- */

  // Простое отсечение окончаний, чтобы «простуда» находила «простуды», «простудой».
  function terms(q) {
    return norm(q).split(/[\s,.;:!?()«»"'\/]+/).filter(Boolean).map(function (t) {
      if (t.length > 6) return t.slice(0, t.length - 2);
      if (t.length > 4) return t.slice(0, t.length - 1);
      return t;
    });
  }
  function search(q, section) {
    var ts = terms(q);
    var pool = section ? (sections[section] || []) : recipes;
    if (!ts.length) return pool.slice();
    var res = [];
    pool.forEach(function (r) {
      var score = 0, h = r.hay;
      for (var i = 0; i < ts.length; i++) {
        var t = ts[i], s = 0;
        if (h.title.indexOf(t) >= 0) s += 6;
        if (h.dis.indexOf(t) >= 0) s += 5;
        if (h.comp.indexOf(t) >= 0) s += 4;
        if (h.sec.indexOf(t) >= 0) s += 2;
        if (h.body.indexOf(t) >= 0) s += 1;
        if (!s) return;
        score += s;
      }
      res.push({ r: r, score: score });
    });
    res.sort(function (a, b) { return b.score - a.score || byName(a.r.title, b.r.title); });
    return res.map(function (x) { return x.r; });
  }
  function matchNames(names, q, limit) {
    var ts = terms(q);
    if (!ts.length) return [];
    return names.filter(function (n) {
      var nn = norm(n);
      return ts.every(function (t) { return nn.indexOf(t) >= 0; });
    }).slice(0, limit);
  }
  // Подсветка найденных слов (norm сохраняет длину строки)
  function highlight(text, q) {
    var ts = terms(q || "");
    if (!ts.length) return esc(text);
    var n = norm(text), marks = [];
    ts.forEach(function (t) {
      var i = n.indexOf(t);
      while (i >= 0) {
        // Подсвечиваем слово до конца, а не только найденную основу
        var e = i + t.length;
        while (e < n.length && /[а-яa-z0-9]/.test(n.charAt(e))) e++;
        marks.push([i, e]);
        i = n.indexOf(t, e);
      }
    });
    if (!marks.length) return esc(text);
    marks.sort(function (a, b) { return a[0] - b[0]; });
    var out = "", pos = 0;
    marks.forEach(function (m) {
      if (m[0] < pos) m[0] = pos;
      if (m[1] <= pos) return;
      out += esc(text.slice(pos, m[0])) + "<mark>" + esc(text.slice(m[0], m[1])) + "</mark>";
      pos = m[1];
    });
    return out + esc(text.slice(pos));
  }

  /* ---------- Markdown ---------- */

  function fixUrl(url) {
    var m = url.match(/(?:^|\/)([^\/]+)\.md$/);
    if (m && !/^https?:/.test(url)) return "#/r/" + enc(decodeURIComponent(m[1]));
    return url;
  }
  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, t, u) {
      return '<a href="' + esc(fixUrl(u.replace(/&amp;/g, "&"))) + '">' + t + "</a>";
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, "$1<em>$2</em>");
    return s;
  }
  function cells(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (c) { return c.trim(); });
  }
  function md(src) {
    var lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
    var html = "", i = 0;
    var isBlock = function (l) { return /^(#{1,6}\s|\||>|\s*([-*+]|\d+\.)\s)/.test(l); };
    while (i < lines.length) {
      var l = lines[i], m;
      if (!l.trim()) { i++; continue; }
      if ((m = l.match(/^(#{1,6})\s+(.*)$/))) {
        var lv = Math.min(6, Math.max(2, m[1].length));
        html += "<h" + lv + ">" + inline(m[2]) + "</h" + lv + ">";
        i++;
      } else if (l.trim().charAt(0) === "|") {
        var rows = [];
        while (i < lines.length && lines[i].trim().charAt(0) === "|") rows.push(lines[i++]);
        var head = cells(rows[0]);
        var bodyRows = rows.slice(1).filter(function (r) { return !/^\s*\|?\s*:?-{2,}/.test(r); });
        html += '<div class="table-wrap"><table><thead><tr>' +
          head.map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          bodyRows.map(function (r) {
            return "<tr>" + cells(r).map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>";
          }).join("") + "</tbody></table></div>";
      } else if (/^\s*([-*+]|\d+\.)\s/.test(l)) {
        var ordered = /^\s*\d+\./.test(l), items = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ""));
          i++;
          while (i < lines.length && lines[i].trim() && !isBlock(lines[i])) items[items.length - 1] += " " + lines[i++].trim();
        }
        var tag = ordered ? "ol" : "ul";
        html += "<" + tag + ">" + items.map(function (t) { return "<li>" + inline(t) + "</li>"; }).join("") + "</" + tag + ">";
      } else if (l.charAt(0) === ">") {
        var q = [];
        while (i < lines.length && lines[i].charAt(0) === ">") q.push(lines[i++].replace(/^>\s?/, ""));
        html += "<blockquote>" + md(q.join("\n")) + "</blockquote>";
      } else {
        var p = [];
        while (i < lines.length && lines[i].trim() && !isBlock(lines[i])) p.push(lines[i++]);
        html += "<p>" + inline(p.join(" ")) + "</p>";
      }
    }
    return html;
  }

  /* ---------- Общие куски разметки ---------- */

  function routeLink(kind, name) { return "#/" + kind + "/" + enc(name); }
  var POISON = "Ядовитые и сильнодействующие растения";
  function plantChip(p) {
    return '<a class="chip' + (p.cat === POISON ? " warn" : "") + '" href="' + routeLink("p", p.name) + '">' + esc(p.name) + "</a>";
  }
  function otherChip(p) { return '<a class="chip plain" href="' + routeLink("n", p.name) + '">' + esc(p.name) + "</a>"; }
  function diseaseChip(d) { return '<a class="chip" href="' + routeLink("d", d) + '">' + esc(d) + "</a>"; }

  function itemHtml(r, q) {
    var comp = r.plants.map(function (p) { return p.name; }).concat(r.others.map(function (p) { return p.name; }));
    return '<a class="item" href="#/r/' + enc(r.id) + '"><h3>' + highlight(r.title, q) + "</h3>" +
      '<div class="meta"><b>Что лечит:</b> ' + highlight(r.diseases.join("; "), q) + "</div>" +
      (comp.length ? '<div class="meta"><b>Состав:</b> ' + highlight(comp.join(", "), q) + "</div>" : "") +
      '<div class="meta">' + esc(r.section) + "</div></a>";
  }
  // Список с подгрузкой по кнопке «Показать ещё»
  function renderList(el, list, q) {
    var shown = 0;
    function more() {
      var chunk = list.slice(shown, shown + PAGE);
      shown += chunk.length;
      var box = el.querySelector(".list");
      box.insertAdjacentHTML("beforeend", chunk.map(function (r) { return itemHtml(r, q); }).join(""));
      var btn = el.querySelector(".more");
      if (shown >= list.length) { if (btn) btn.remove(); }
      else if (!btn) {
        el.insertAdjacentHTML("beforeend", '<button class="more" type="button"></button>');
        el.querySelector(".more").onclick = more;
      }
      if (shown < list.length) el.querySelector(".more").textContent = "Показать ещё (" + (list.length - shown) + ")";
    }
    el.innerHTML = list.length ? '<div class="list"></div>' : '<p class="empty">Ничего не найдено. Попробуйте другое слово или уберите фильтр.</p>';
    if (list.length) more();
  }
  function topComponents(list, kind, limit) {
    var counts = {};
    list.forEach(function (r) { r[kind].forEach(function (p) { counts[p.name] = (counts[p.name] || 0) + 1; }); });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || byName(a, b); })
      .slice(0, limit).map(function (n) { return { name: n, n: counts[n] }; });
  }
  function letterOf(name) { return name.charAt(0).toUpperCase().replace("Ё", "Е"); }

  /* ---------- Страницы ---------- */

  var views = {};

  // Главная и поиск
  views[""] = function (arg, params) {
    var q = params.q || "", sec = params.s || "";
    var examples = ["простуда", "давление", "суставы", "мёд", "золотой ус", "бессонница", "печень"];
    app.innerHTML =
      '<section class="hero"><h1>Рецепты народной медицины</h1>' +
      "<p>" + recipesWord(recipes.length) + ". Ищите по болезни, растению или любому слову из рецепта.</p>" +
      '<div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>' +
      '<input id="q" type="search" autocomplete="off" placeholder="Например: кашель, ромашка, мёд с алоэ" value="' + esc(q) + '" aria-label="Поиск">' +
      '<button class="clear" type="button" aria-label="Очистить">×</button></div>' +
      '<div class="filters"><label>Раздел: <select id="sec"><option value="">все разделы</option>' +
      sectionNames.map(function (s) {
        return "<option" + (s === sec ? " selected" : "") + ' value="' + esc(s) + '">' + esc(s) + " (" + sections[s].length + ")</option>";
      }).join("") + "</select></label>" +
      '<a href="#/r/' + enc(recipes[Math.floor(Math.random() * recipes.length)].id) + '">Случайный рецепт</a></div>' +
      '<div class="examples" id="examples">Например: ' + examples.map(function (e) {
        return '<a href="#/?q=' + enc(e) + '">' + esc(e) + "</a>";
      }).join(" ") + "</div></section>" +
      '<div id="home-extra"></div><div id="suggest" class="suggest"></div><p class="count" id="count"></p><div id="results"></div>';

    var input = document.getElementById("q"), select = document.getElementById("sec");
    function update(push) {
      var qv = input.value.trim(), sv = select.value;
      var h = "#/" + (qv || sv ? "?" + [qv ? "q=" + enc(qv) : "", sv ? "s=" + enc(sv) : ""].filter(Boolean).join("&") : "");
      if (push && location.hash !== h) history.replaceState(null, "", h);
      document.getElementById("examples").style.display = qv ? "none" : "";
      document.getElementById("home-extra").innerHTML = qv || sv ? "" : homeExtra();
      var sug = "";
      if (qv) {
        var groups = [
          ["Болезни", matchNames(diseaseNames, qv, 12), function (n) { return '<a class="chip" href="' + routeLink("d", n) + '">' + highlight(n, qv) + " <small>" + diseases[n].length + "</small></a>"; }],
          ["Растения", matchNames(plantNames, qv, 12), function (n) { return '<a class="chip" href="' + routeLink("p", n) + '">' + highlight(n, qv) + " <small>" + plants[n].list.length + "</small></a>"; }],
          ["Не растения", matchNames(otherNames, qv, 12), function (n) { return '<a class="chip plain" href="' + routeLink("n", n) + '">' + highlight(n, qv) + " <small>" + others[n].list.length + "</small></a>"; }]
        ];
        groups.forEach(function (g) {
          if (g[1].length) sug += "<h4>" + g[0] + '</h4><div class="chips">' + g[1].map(g[2]).join("") + "</div>";
        });
      }
      document.getElementById("suggest").innerHTML = sug;
      var list = search(qv, sv);
      document.getElementById("count").textContent = qv
        ? "Найдено: " + recipesWord(list.length)
        : (sv ? sv + ": " : "Все рецепты по алфавиту: ") + recipesWord(list.length);
      renderList(document.getElementById("results"), list, qv);
    }
    var timer;
    input.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { update(true); }, 150); });
    select.addEventListener("change", function () { update(true); });
    app.querySelector(".clear").onclick = function () { input.value = ""; update(true); input.focus(); };
    update(false);
    if (!q && matchMedia("(min-width: 760px)").matches) input.focus();
  };
  views.search = views[""];

  function homeExtra() {
    return '<div class="stats">' +
      '<a class="stat" href="#/d"><b>' + diseaseNames.length + "</b><span>болезней и состояний</span></a>" +
      '<a class="stat" href="#/p"><b>' + plantNames.length + "</b><span>растений</span></a>" +
      '<a class="stat" href="#/n"><b>' + otherNames.length + "</b><span>компонентов не растений</span></a>" +
      '<a class="stat" href="#/s"><b>' + sectionNames.length + "</b><span>разделов</span></a></div>" +
      "<h2>Разделы</h2>" + sectionTiles();
  }
  function sectionTiles() {
    return '<div class="tiles">' + sectionNames.map(function (s) {
      return '<a class="tile" href="' + routeLink("s", s) + '"><span>' + esc(s) + '</span><span class="n">' + sections[s].length + "</span></a>";
    }).join("") + "</div>";
  }

  // Указатель болезней
  views.d = function (arg) {
    if (arg) return listPage("Болезнь или состояние", arg, diseases[arg], [
      ["Чаще всего в составе", topComponents(diseases[arg] || [], "plants", 12), "p"]
    ]);
    var letters = uniq(diseaseNames.map(letterOf));
    app.innerHTML = "<h1>Болезни и состояния</h1>" +
      '<input class="filter-input" id="flt" type="search" placeholder="Фильтр, например: кашель" aria-label="Фильтр">' +
      '<div class="letters">' + letters.map(function (l) { return '<a href="#" data-letter="' + l + '">' + l + "</a>"; }).join("") + "</div>" +
      '<div id="idx"></div>';
    function draw(f) {
      var names = f ? matchNames(diseaseNames, f, 1e4) : diseaseNames;
      var groups = {};
      names.forEach(function (n) { add(groups, letterOf(n), n); });
      document.getElementById("idx").innerHTML = Object.keys(groups).map(function (l) {
        return '<div class="group"><h2 id="L-' + l + '">' + l + '</h2><ul class="index-list">' + groups[l].map(function (n) {
          return '<li><a href="' + routeLink("d", n) + '">' + highlight(n, f) + '</a><span class="n">' + diseases[n].length + "</span></li>";
        }).join("") + "</ul></div>";
      }).join("") || '<p class="empty">Ничего не найдено.</p>';
    }
    bindFilter(draw);
    app.querySelectorAll("[data-letter]").forEach(function (a) {
      a.onclick = function (e) {
        e.preventDefault();
        var h = document.getElementById("L-" + a.dataset.letter);
        if (h) h.scrollIntoView({ behavior: "smooth" });
      };
    });
  };

  function bindFilter(draw) {
    var f = document.getElementById("flt");
    f.addEventListener("input", function () { draw(f.value.trim()); });
    draw("");
  }

  // Указатель растений и не растений по категориям
  function catIndex(title, intro, map, catMap, kind, catKind) {
    app.innerHTML = "<h1>" + title + "</h1><p>" + intro + "</p>" +
      '<input class="filter-input" id="flt" type="search" placeholder="Фильтр по названию" aria-label="Фильтр">' +
      '<div class="chips">' + Object.keys(catMap).sort(byName).map(function (c) {
        return '<a class="chip plain" href="' + routeLink(catKind, c) + '">' + esc(c) + " <small>" + Object.keys(catMap[c]).length + "</small></a>";
      }).join("") + '</div><div id="idx"></div>';
    bindFilter(function (f) {
      document.getElementById("idx").innerHTML = Object.keys(catMap).sort(byName).map(function (c) {
        var names = Object.keys(catMap[c]).sort(byName);
        if (f) names = matchNames(names, f, 1e4);
        if (!names.length) return "";
        return '<div class="group"><h2><a href="' + routeLink(catKind, c) + '">' + esc(c) + '</a> <span class="n">' + names.length + '</span></h2><ul class="index-list">' +
          names.map(function (n) {
            return '<li><a href="' + routeLink(kind, n) + '">' + highlight(n, f) + '</a><span class="n">' + map[n].list.length + "</span></li>";
          }).join("") + "</ul></div>";
      }).join("") || '<p class="empty">Ничего не найдено.</p>';
    });
  }

  views.p = function (arg) {
    if (arg) {
      var p = plants[arg];
      return listPage("Растение", arg, p && p.list, [
        ["Категория", p ? [{ name: p.cat, href: routeLink("pc", p.cat) }] : []],
        ["Что лечат рецепты с ним", topDiseases(p ? p.list : [], 16), "d"],
        ["Часто вместе с", topComponents(p ? p.list : [], "plants", 13).filter(function (x) { return x.name !== arg; }).slice(0, 12), "p"]
      ], p && p.cat === POISON ? "Ядовитое или сильнодействующее растение. Дозировку соблюдайте строго и посоветуйтесь с врачом." : "");
    }
    catIndex("Растения", plantNames.length + " растений по категориям. Число рядом с названием показывает, в скольких рецептах оно есть.", plants, plantCats, "p", "pc");
  };
  views.n = function (arg) {
    if (arg) {
      var p = others[arg];
      return listPage("Компонент", arg, p && p.list, [
        ["Категория", p ? [{ name: p.cat, href: routeLink("nc", p.cat) }] : []],
        ["Что лечат рецепты с ним", topDiseases(p ? p.list : [], 16), "d"]
      ]);
    }
    catIndex("Не растения", "Мёд и продукты пчеловодства, продукты питания, минералы, аптечные средства и прочее.", others, otherCats, "n", "nc");
  };
  function catPage(map, catMap, kind, label) {
    return function (arg) {
      var names = Object.keys(catMap[arg] || {}).sort(byName);
      var list = uniq([].concat.apply([], names.map(function (n) { return map[n].list.map(function (r) { return r.id; }); }))).map(function (id) { return byId[id]; })
        .sort(function (a, b) { return byName(a.title, b.title); });
      listPage(label, arg, names.length ? list : null, [
        [kind === "p" ? "Растения категории" : "Компоненты категории", names.map(function (n) { return { name: n, n: map[n].list.length }; }), kind]
      ]);
    };
  }
  views.pc = catPage(plants, plantCats, "p", "Категория растений");
  views.nc = catPage(others, otherCats, "n", "Категория не растений");

  views.s = function (arg) {
    if (arg) return listPage("Раздел", arg, sections[arg], [
      ["Болезни раздела", topDiseases(sections[arg] || [], 30), "d"],
      ["Чаще всего в составе", topComponents(sections[arg] || [], "plants", 12), "p"]
    ]);
    app.innerHTML = "<h1>Разделы</h1><p>Рецепты сгруппированы по системам организма.</p>" + sectionTiles();
  };

  function topDiseases(list, limit) {
    var counts = {};
    list.forEach(function (r) { r.diseases.forEach(function (d) { counts[d] = (counts[d] || 0) + 1; }); });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || byName(a, b); })
      .slice(0, limit).map(function (n) { return { name: n, n: counts[n] }; });
  }

  // Страница со списком рецептов (болезнь, растение, раздел, категория)
  function listPage(label, name, list, related, warning) {
    if (!list) {
      app.innerHTML = '<p class="crumbs">' + esc(label) + "</p><h1>" + esc(name) + '</h1><p class="empty">Такой записи в каталоге нет. <a href="#/">Перейти к поиску</a></p>';
      return;
    }
    var rel = (related || []).filter(function (x) { return x[1] && x[1].length; }).map(function (x) {
      return '<div class="suggest"><h4>' + esc(x[0]) + '</h4><div class="chips">' + x[1].map(function (it) {
        var href = it.href || routeLink(x[2], it.name);
        var cls = x[2] === "p" && plants[it.name] && plants[it.name].cat === POISON ? "chip warn" : (x[2] === "n" ? "chip plain" : "chip");
        return '<a class="' + cls + '" href="' + href + '">' + esc(it.name) + (it.n ? " <small>" + it.n + "</small>" : "") + "</a>";
      }).join("") + "</div></div>";
    }).join("");
    app.innerHTML = '<p class="crumbs">' + esc(label) + "</p><h1>" + esc(name) + "</h1>" +
      (warning ? '<div class="note-box warn">' + esc(warning) + "</div>" : "") + rel +
      '<p class="count">' + recipesWord(list.length) + '</p><div id="results"></div>';
    renderList(document.getElementById("results"), list, "");
  }

  // Карточка рецепта
  views.r = function (id) {
    var r = byId[id];
    if (!r) {
      app.innerHTML = '<h1>Рецепт не найден</h1><p class="empty">Возможно, карточку переименовали или удалили. <a href="#/">Перейти к поиску</a></p>';
      return;
    }
    var related = {};
    r.diseases.forEach(function (d) {
      diseases[d].forEach(function (x) { if (x !== r) related[x.id] = (related[x.id] || 0) + 1; });
    });
    var rel = Object.keys(related).sort(function (a, b) { return related[b] - related[a] || byName(byId[a].title, byId[b].title); }).slice(0, 8);
    var poison = r.plants.some(function (p) { return p.cat === POISON; });
    app.innerHTML =
      '<p class="crumbs"><a href="#/">Поиск</a> › <a href="' + routeLink("s", r.section) + '">' + esc(r.section) + "</a></p>" +
      '<article class="recipe">' + recipeHtml(r, poison) +
      '<div class="actions">' +
      '<a class="btn" href="#/edit/' + enc(r.id) + '">✎ Изменить</a>' +
      (REPO_URL ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(githubFile("edit", r.file)) + '">Править файл на GitHub</a>' : "") +
      '<button class="btn" type="button" id="copyRecipe">Скопировать текст</button>' +
      '<button class="btn" type="button" onclick="print()">Печать</button></div></article>' +
      (rel.length ? '<section class="related"><h2>Ещё при этих болезнях</h2><div class="list">' + rel.map(function (x) { return itemHtml(byId[x], ""); }).join("") + "</div></section>" : "");
    document.getElementById("copyRecipe").onclick = function () { copyText(plainText(r), "Текст рецепта скопирован"); };
  };

  function recipeHtml(r, poison) {
    return "<h1>" + esc(r.title) + "</h1>" +
      '<dl class="facts"><dt>Что лечит</dt><dd class="chips">' + r.diseases.map(diseaseChip).join("") + "</dd>" +
      '<dt>Раздел</dt><dd><a href="' + routeLink("s", r.section) + '">' + esc(r.section) + "</a></dd>" +
      (r.plants.length ? '<dt>Растения</dt><dd class="chips">' + r.plants.map(plantChip).join("") + "</dd>" : "") +
      (r.others.length ? '<dt>Не растения</dt><dd class="chips">' + r.others.map(otherChip).join("") + "</dd>" : "") +
      "</dl>" +
      (poison ? '<div class="note-box warn">В составе есть ядовитое или сильнодействующее растение. Дозировку соблюдайте строго и посоветуйтесь с врачом.</div>' : "") +
      '<div class="body">' + md(r.body) + "</div>";
  }
  function plainText(r) {
    var t = r.title + "\n\nЧто лечит: " + r.diseases.join("; ") + "\n";
    if (r.plants.length) t += "Растения: " + r.plants.map(function (p) { return p.name; }).join(", ") + "\n";
    if (r.others.length) t += "Не растения: " + r.others.map(function (p) { return p.name; }).join(", ") + "\n";
    return t + "\n" + r.body.replace(/\*\*/g, "").replace(/^\|[-| ]+\|$/gm, "").replace(/^## /gm, "") + "\n";
  }
  function githubFile(action, file) {
    return REPO_URL + "/" + action + "/" + CFG.branch + "/" + CFG.recipesDir + "/" + enc(file);
  }

  /* ---------- Редактор карточки ---------- */

  var DRAFT_KEY = "recipe-draft";
  var SECTION_DEFAULT = "Прочее (не растительные средства)";

  function emptyForm() {
    return { title: "", file: "", fileTouched: false, diseases: "", section: "", rows: [newRow()], prep: "", usage: "", note: "", extra: "" };
  }
  function newRow(type) { return { name: "", type: type || "plant", cat: "", idx: "", part: "", amount: "", inTable: true }; }

  // Разбор существующей карточки в поля формы
  function formFromRecipe(r) {
    var f = emptyForm();
    f.title = r.title; f.file = r.file; f.fileTouched = true;
    f.diseases = r.diseases.join("\n"); f.section = r.section;
    f.rows = [];
    var parts = ("\n" + r.body).split(/\n## /);
    var extra = parts.shift().trim();
    var extras = extra ? [extra] : [];
    parts.forEach(function (chunk) {
      var nl = chunk.indexOf("\n");
      var head = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
      var text = (nl < 0 ? "" : chunk.slice(nl + 1)).trim();
      var key = head.toLowerCase();
      if (key === "состав") {
        var rest = [];
        text.split("\n").forEach(function (line) {
          if (line.trim().charAt(0) !== "|") { if (line.trim()) rest.push(line); return; }
          if (/^\s*\|?\s*:?-{2,}/.test(line)) return;
          var c = cells(line);
          if (c[0] === "Компонент") return;
          var cat = c[1] || "";
          var type = otherCats[cat] ? "other" : "plant";
          f.rows.push({ name: c[0] || "", type: type, cat: cat, idx: "", part: c[2] === "—" ? "" : (c[2] || ""), amount: c[3] === "—" ? "" : (c[3] || ""), inTable: true });
        });
        if (rest.length) extras.push(rest.join("\n"));
      } else if (key === "приготовление" && !f.prep) f.prep = text;
      else if (key === "применение" && !f.usage) f.usage = text;
      else if (key === "примечание" && !f.note) f.note = text;
      else extras.push("## " + head + "\n\n" + text);
    });
    f.extra = extras.join("\n\n");
    // Сопоставляем строки таблицы с названиями в указателе
    [["plant", r.plants], ["other", r.others]].forEach(function (pair) {
      var left = pair[1].slice();
      var rows = f.rows.filter(function (x) { return x.type === pair[0]; });
      function take(test) {
        rows.forEach(function (row) {
          if (row.idx) return;
          for (var i = 0; i < left.length; i++) {
            if (test(norm(row.name), norm(left[i].name))) { row.idx = left[i].name; if (!row.cat) row.cat = left[i].cat; left.splice(i, 1); return; }
          }
        });
      }
      take(function (a, b) { return a === b; });
      take(function (a, b) { return a.indexOf(b) === 0 || b.indexOf(a) === 0; });
      take(function (a, b) { return a.slice(0, 5) === b.slice(0, 5); });
      take(function (a, b) { return b.split(/[\s\/,]+/).some(function (w) { return w.length > 3 && a.indexOf(w.slice(0, 5)) >= 0; }); });
      rows.forEach(function (row) { if (!row.idx) row.idx = "-"; });
      left.forEach(function (p) { f.rows.push({ name: p.name, type: pair[0], cat: p.cat, idx: p.name, part: "", amount: "", inTable: false }); });
    });
    if (!f.rows.length) f.rows.push(newRow());
    return f;
  }

  function slugify(title) {
    return norm(title).replace(/[«»"'`]/g, "").replace(/[^a-zа-я0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/, "") || "новый-рецепт";
  }
  function lines(s) { return uniq(String(s || "").split(/[\n;]+/).map(function (x) { return x.trim(); })); }
  function cell(s) { return String(s || "").replace(/\|/g, "/").replace(/\n/g, " ").trim() || "—"; }

  // Из формы получаем объект рецепта и текст .md
  function buildFromForm(f) {
    var title = f.title.trim() || "Новый рецепт";
    var dis = lines(f.diseases);
    var section = f.section.trim() || SECTION_DEFAULT;
    var rows = f.rows.filter(function (x) { return x.name.trim() || (x.idx && x.idx !== "-"); });
    function indexed(type) {
      var seen = {}, out = [];
      rows.forEach(function (x) {
        if (x.type !== type) return;
        var n = (x.idx || x.name).trim();
        if (!n || n === "-" || seen[n]) return;
        seen[n] = 1;
        out.push({ name: n, cat: x.cat.trim() || "Без категории" });
      });
      return out;
    }
    var pl = indexed("plant"), ot = indexed("other");
    var cats = function (arr) { return uniq(arr.map(function (p) { return p.cat; })).sort(byName); };
    var body = [];
    var table = rows.filter(function (x) { return x.inTable && x.name.trim(); });
    if (table.length) {
      body.push("## Состав\n\n| Компонент | Категория | Часть / форма | Количество |\n|---|---|---|---|\n" +
        table.map(function (x) { return "| " + [x.name, x.cat, x.part, x.amount].map(cell).join(" | ") + " |"; }).join("\n"));
    }
    if (f.prep.trim()) body.push("## Приготовление\n\n" + f.prep.trim());
    if (f.usage.trim()) body.push("## Применение\n\n" + f.usage.trim());
    if (f.note.trim()) body.push("## Примечание\n\n" + f.note.trim());
    if (f.extra.trim()) body.push(f.extra.trim());
    var bodyMd = body.join("\n\n");
    var J = function (v) { return Array.isArray(v) ? "[" + v.map(function (x) { return JSON.stringify(x); }).join(", ") + "]" : JSON.stringify(v); };
    var text = "---\n" +
      "название: " + J(title) + "\n" +
      "что_лечит: " + J(dis) + "\n" +
      "раздел: " + J(section) + "\n" +
      "растения: " + J(pl.map(function (p) { return p.name; })) + "\n" +
      "категории_растений: " + J(cats(pl)) + "\n" +
      "не_растения: " + J(ot.map(function (p) { return p.name; })) + "\n" +
      "категории_не_растений: " + J(cats(ot)) + "\n" +
      "---\n\n# " + title + "\n\n" +
      "**Что лечит:** " + dis.join("; ") + "\n\n" +
      "**Раздел:** " + section + "\n\n" +
      "**Растения:** " + (pl.length ? pl.map(function (p) { return p.name + " (" + p.cat + ")"; }).join("; ") : NO_PLANTS) + "\n\n" +
      (ot.length ? "**Не растения:** " + ot.map(function (p) { return p.name + " (" + p.cat + ")"; }).join("; ") + "\n\n" : "") +
      bodyMd + "\n";
    var file = (f.file.trim() || slugify(title)).replace(/\.md$/i, "") + ".md";
    return {
      text: text, file: file,
      recipe: { id: file.replace(/\.md$/, ""), file: file, title: title, diseases: dis, section: section, plants: pl, others: ot, body: bodyMd }
    };
  }

  function editor(id) {
    var orig = id ? byId[id] : null;
    if (id && !orig) return views.r(id);
    var f = orig ? formFromRecipe(orig) : (store.get(DRAFT_KEY) || emptyForm());
    var allCats = { plant: Object.keys(plantCats).sort(byName), other: Object.keys(otherCats).sort(byName) };

    app.innerHTML =
      '<p class="crumbs"><a href="#/">Поиск</a> › ' + (orig ? '<a href="#/r/' + enc(orig.id) + '">' + esc(orig.title) + "</a> › изменение" : "новый рецепт") + "</p>" +
      "<h1>" + (orig ? "Изменить рецепт" : "Добавить рецепт") + "</h1>" +
      '<p class="hint">Заполните поля, справа сразу видно, как будет выглядеть карточка. Затем сохраните её на GitHub одной кнопкой. ' +
      '<a href="#/help">Подробнее, как это работает</a>.</p>' +
      '<datalist id="dl-sections">' + sectionNames.map(function (s) { return '<option value="' + esc(s) + '">'; }).join("") + "</datalist>" +
      '<datalist id="dl-diseases">' + diseaseNames.map(function (s) { return '<option value="' + esc(s) + '">'; }).join("") + "</datalist>" +
      '<datalist id="dl-cat-plant">' + allCats.plant.map(function (s) { return '<option value="' + esc(s) + '">'; }).join("") + "</datalist>" +
      '<datalist id="dl-cat-other">' + allCats.other.map(function (s) { return '<option value="' + esc(s) + '">'; }).join("") + "</datalist>" +
      '<datalist id="dl-idx-plant">' + plantNames.map(function (s) { return '<option value="' + esc(s) + '">'; }).join("") + "</datalist>" +
      '<datalist id="dl-idx-other">' + otherNames.map(function (s) { return '<option value="' + esc(s) + '">'; }).join("") + "</datalist>" +
      '<div class="editor"><form id="ed" autocomplete="off">' +
      field("title", "Название рецепта", '<input name="title" required placeholder="Например: Отвар ромашки при гастрите">') +
      field("diseases", "Что лечит", '<textarea name="diseases" rows="3" placeholder="По одной болезни в строке"></textarea>', "По одной болезни или состоянию в строке. Пишите так же, как в указателе болезней, тогда рецепт попадёт в ту же группу.") +
      field("section", "Раздел", '<input name="section" list="dl-sections" placeholder="Например: Пищеварение">', "Выберите из списка или впишите новый.") +
      '<div class="field"><span class="label">Состав</span><span class="hint">Каждый компонент отдельной строкой. «В указателе» — под каким именем компонент попадёт в указатель растений или не растений; пусто — как в поле «Компонент», знак «-» — не включать в указатель.</span>' +
      '<div class="rows" id="rows"></div><div class="actions"><button class="btn small" type="button" id="addPlant">+ растение</button><button class="btn small" type="button" id="addOther">+ не растение</button></div></div>' +
      field("prep", "Приготовление", '<textarea name="prep" rows="4"></textarea>') +
      field("usage", "Применение", '<textarea name="usage" rows="4"></textarea>', "Дозировка, как и сколько принимать.") +
      field("note", "Примечание", '<textarea name="note" rows="3"></textarea>', "Предостережения, источник, пометка «дополнено».") +
      field("extra", "Дополнительные разделы", '<textarea name="extra" rows="4" placeholder="## Вариант: ..."></textarea>', "Необязательно. Текст в формате Markdown: заголовок раздела начинается с «## ».") +
      field("file", "Имя файла", '<input name="file"' + (orig ? " readonly" : "") + ">", orig ? "У существующей карточки имя файла не меняется." : "Создаётся из названия, можно поменять.") +
      (orig ? "" : '<button class="btn" type="button" id="reset">Очистить форму</button>') +
      "</form>" +
      '<div class="preview-pane"><div class="tabs" role="tablist"><button type="button" role="tab" aria-selected="true" data-tab="view">Как будет выглядеть</button><button type="button" role="tab" aria-selected="false" data-tab="code">Текст файла</button></div>' +
      '<div id="tab-view" class="recipe"></div><textarea id="tab-code" class="output" readonly hidden></textarea>' +
      '<div class="actions" id="saveActions"></div><div id="saveHint"></div></div></div>';

    function field(name, label, control, hint) {
      return '<div class="field"><label for="f-' + name + '">' + label + "</label>" + control.replace(/name="(\w+)"/, 'name="$1" id="f-$1"') +
        (hint ? '<span class="hint">' + hint + "</span>" : "") + "</div>";
    }

    var form = document.getElementById("ed");
    ["title", "diseases", "section", "prep", "usage", "note", "extra", "file"].forEach(function (k) { form.elements[k].value = f[k] || ""; });
    if (!f.file && f.title) form.elements.file.value = slugify(f.title) + ".md";

    function rowHtml(x, i) {
      var t = x.type;
      return '<div class="row" data-i="' + i + '">' +
        '<label class="c-name"><small>Компонент</small><input data-k="name" value="' + esc(x.name) + '" placeholder="' + (t === "plant" ? "Ромашка аптечная" : "Мёд") + '"></label>' +
        '<label class="c-type"><small>Тип</small><select data-k="type"><option value="plant"' + (t === "plant" ? " selected" : "") + '>растение</option><option value="other"' + (t === "other" ? " selected" : "") + ">не растение</option></select></label>" +
        '<label class="c-cat"><small>Категория</small><input data-k="cat" list="dl-cat-' + t + '" value="' + esc(x.cat) + '"></label>' +
        '<label class="c-idx"><small>В указателе</small><input data-k="idx" list="dl-idx-' + t + '" value="' + esc(x.idx) + '" placeholder="как в «Компонент»"></label>' +
        '<label class="c-part"><small>Часть / форма</small><input data-k="part" value="' + esc(x.part) + '" placeholder="цветки, корень…"></label>' +
        '<label class="c-amt"><small>Количество</small><input data-k="amount" value="' + esc(x.amount) + '" placeholder="1 ст. л."></label>' +
        '<div class="c-foot"><label><input type="checkbox" data-k="inTable"' + (x.inTable ? " checked" : "") + "> показывать в таблице состава</label>" +
        '<button class="btn small" type="button" data-del>Удалить</button></div></div>';
    }
    function drawRows() {
      document.getElementById("rows").innerHTML = f.rows.map(rowHtml).join("");
    }
    drawRows();

    var rowsBox = document.getElementById("rows");
    rowsBox.addEventListener("input", onRow);
    rowsBox.addEventListener("change", onRow);
    function onRow(e) {
      var rowEl = e.target.closest(".row"), k = e.target.dataset.k;
      if (!rowEl || !k) return;
      var x = f.rows[+rowEl.dataset.i];
      x[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      if (k === "type" && e.type === "change") { drawRows(); }
      // Подставляем категорию для знакомого компонента
      if ((k === "name" || k === "idx") && !x.cat) {
        var known = (x.type === "plant" ? plants : others)[(x.idx || x.name).trim()];
        if (known) { x.cat = known.cat; rowEl.querySelector('[data-k="cat"]').value = known.cat; }
      }
      refresh();
    }
    rowsBox.addEventListener("click", function (e) {
      if (!e.target.hasAttribute("data-del")) return;
      f.rows.splice(+e.target.closest(".row").dataset.i, 1);
      if (!f.rows.length) f.rows.push(newRow());
      drawRows(); refresh();
    });
    document.getElementById("addPlant").onclick = function () { f.rows.push(newRow("plant")); drawRows(); refresh(); };
    document.getElementById("addOther").onclick = function () { f.rows.push(newRow("other")); drawRows(); refresh(); };
    var reset = document.getElementById("reset");
    if (reset) reset.onclick = function () {
      if (!confirm("Очистить все поля?")) return;
      store.del(DRAFT_KEY); editor(null);
    };

    form.addEventListener("input", function (e) {
      var k = e.target.name;
      if (!k) return;
      f[k] = e.target.value;
      if (k === "file") f.fileTouched = true;
      if (k === "title" && !orig && !f.fileTouched) { f.file = slugify(f.title) + ".md"; form.elements.file.value = f.file; }
      refresh();
    });

    app.querySelectorAll("[data-tab]").forEach(function (b) {
      b.onclick = function () {
        app.querySelectorAll("[data-tab]").forEach(function (o) { o.setAttribute("aria-selected", o === b ? "true" : "false"); });
        document.getElementById("tab-view").hidden = b.dataset.tab !== "view";
        document.getElementById("tab-code").hidden = b.dataset.tab !== "code";
      };
    });

    var timer, current;
    function refresh() {
      clearTimeout(timer);
      timer = setTimeout(function () {
        current = buildFromForm(f);
        document.getElementById("tab-view").innerHTML = recipeHtml(current.recipe, current.recipe.plants.some(function (p) { return p.cat === POISON; }));
        document.getElementById("tab-code").value = current.text;
        if (!orig) store.set(DRAFT_KEY, f);
        drawSave();
      }, 120);
    }

    function drawSave() {
      var problems = [];
      if (!f.title.trim()) problems.push("название");
      if (!lines(f.diseases).length) problems.push("что лечит");
      var clash = !orig && byId[current.recipe.id];
      var box = document.getElementById("saveActions"), hint = document.getElementById("saveHint");
      box.innerHTML =
        '<button class="btn primary" type="button" id="toGithub"' + (problems.length || clash ? " disabled" : "") + ">" + (orig ? "Сохранить на GitHub" : "Создать на GitHub") + "</button>" +
        '<button class="btn" type="button" id="copyMd">Скопировать текст файла</button>' +
        '<button class="btn" type="button" id="dlMd">Скачать .md</button>';
      hint.innerHTML = problems.length ? '<p class="hint">Заполните: ' + problems.join(", ") + ".</p>"
        : clash ? '<p class="hint">Файл с именем <code>' + esc(current.file) + "</code> уже есть. Измените имя файла.</p>"
        : !REPO_URL ? '<p class="hint">Сайт открыт не с GitHub Pages, поэтому кнопка сохранения не знает адрес репозитория. Укажите его в <code>config.js</code> или скачайте файл и положите его в папку <code>recipes</code>.</p>'
        : '<p class="hint">' + (orig
          ? "Откроется редактор файла на GitHub, текст уже будет скопирован. Выделите всё в редакторе (Cmd+A), вставьте (Cmd+V) и нажмите «Commit changes»."
          : "Откроется GitHub с готовым файлом. Нажмите «Commit changes».") +
          " Через 1–2 минуты сайт обновится сам.</p>";
      document.getElementById("copyMd").onclick = function () { copyText(current.text, "Текст файла скопирован"); };
      document.getElementById("dlMd").onclick = function () {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([current.text], { type: "text/markdown;charset=utf-8" }));
        a.download = current.file;
        document.body.appendChild(a); a.click(); a.remove();
      };
      document.getElementById("toGithub").onclick = function () {
        if (!REPO_URL) { toast("Адрес репозитория не задан, см. config.js"); return; }
        if (orig) {
          var win = window.open("about:blank", "_blank");
          copyText(current.text, "Текст скопирован. Вставьте его в редакторе GitHub вместо старого.").then(function () {
            if (win) win.location = githubFile("edit", orig.file); else location.href = githubFile("edit", orig.file);
          });
          return;
        }
        var url = REPO_URL + "/new/" + CFG.branch + "/" + CFG.recipesDir + "?filename=" + enc(current.file) + "&value=" + enc(current.text);
        if (url.length > 7500) {
          // Слишком длинный адрес: открываем пустой файл, текст кладём в буфер
          url = REPO_URL + "/new/" + CFG.branch + "/" + CFG.recipesDir + "?filename=" + enc(current.file);
          copyText(current.text, "Текст скопирован. Вставьте его в поле файла на GitHub (Cmd+V).");
        }
        window.open(url, "_blank", "noopener");
        store.del(DRAFT_KEY);
      };
    }
    refresh();
  }
  views.add = function () { editor(null); };
  window.RecipeApp = { formFromRecipe: formFromRecipe, buildFromForm: buildFromForm, byId: byId };
  views.edit = function (id) { editor(id); };

  // Справка
  views.help = function () {
    var repo = REPO_URL ? '<a href="' + REPO_URL + '" target="_blank" rel="noopener">' + esc(REPO_URL.replace("https://", "")) + "</a>" : "репозиторий сайта на GitHub";
    app.innerHTML = '<div class="help"><h1>Как добавить или изменить рецепт</h1>' +
      "<p>Каждый рецепт хранится отдельным файлом <code>.md</code> в папке <code>recipes</code> репозитория (" + repo + "). " +
      "Когда файл добавлен или изменён, GitHub сам пересобирает сайт, обычно за 1–2 минуты.</p>" +
      "<h2>Добавить рецепт</h2><ol>" +
      '<li>Нажмите <a href="#/add">«+ Добавить»</a> вверху страницы и заполните форму. Черновик сохраняется в браузере, его можно дописать позже.</li>' +
      "<li>Нажмите «Создать на GitHub». Откроется GitHub с уже заполненным файлом (нужно быть вошедшим в свой аккаунт).</li>" +
      "<li>Внизу или справа нажмите зелёную кнопку <b>Commit changes</b>, затем ещё раз <b>Commit changes</b> в появившемся окне.</li></ol>" +
      "<h2>Изменить рецепт</h2><ol>" +
      "<li>Откройте рецепт и нажмите «✎ Изменить». Исправьте поля.</li>" +
      "<li>Нажмите «Сохранить на GitHub». Текст карточки скопируется, откроется редактор файла.</li>" +
      "<li>В редакторе выделите всё (Cmd+A), вставьте новый текст (Cmd+V) и нажмите <b>Commit changes</b>.</li></ol>" +
      "<p>Небольшую опечатку проще исправить сразу в файле: кнопка «Править файл на GitHub» на странице рецепта.</p>" +
      "<h2>Удалить рецепт</h2><p>Откройте файл рецепта на GitHub, нажмите меню «…» справа вверху и выберите <b>Delete file</b>, затем <b>Commit changes</b>.</p>" +
      "<h2>Как устроены указатели</h2><p>Указатели болезней, растений, не растений и разделов строятся автоматически из полей карточек. " +
      "Чтобы рецепт попал в уже существующую группу, пишите название болезни или растения точно так же, как в указателе: в форме есть подсказки из списка.</p>" +
      '<p class="hint">Каталог собран: ' + esc((CATALOG.generated || "").replace("T", " ").replace("Z", " UTC")) + ".</p></div>";
  };

  /* ---------- Маршрутизация ---------- */

  function parseHash() {
    var h = location.hash.replace(/^#\/?/, "");
    var qs = "", qi = h.indexOf("?");
    if (qi >= 0) { qs = h.slice(qi + 1); h = h.slice(0, qi); }
    var slash = h.indexOf("/");
    var route = slash < 0 ? h : h.slice(0, slash);
    var arg = slash < 0 ? "" : h.slice(slash + 1);
    try { arg = decodeURIComponent(arg); } catch (e) { /* оставляем как есть */ }
    var params = {};
    qs.split("&").forEach(function (kv) {
      if (!kv) return;
      var p = kv.split("=");
      try { params[p[0]] = decodeURIComponent((p[1] || "").replace(/\+/g, " ")); } catch (e) { params[p[0]] = p[1]; }
    });
    return { route: route, arg: arg, params: params };
  }
  var NAV_OF = { "": "", search: "", d: "d", p: "p", pc: "p", n: "n", nc: "n", s: "s", add: "add", edit: "", r: "", help: "" };
  var TITLES = { d: "Болезни", p: "Растения", pc: "Растения", n: "Не растения", nc: "Не растения", s: "Разделы", add: "Добавить рецепт", edit: "Изменить рецепт", help: "Справка" };
  function render() {
    var h = parseHash();
    var view = views[h.route] || views[""];
    view(h.arg, h.params);
    var nav = NAV_OF[h.route] != null ? NAV_OF[h.route] : "";
    document.querySelectorAll("[data-nav]").forEach(function (a) { a.classList.toggle("active", a.dataset.nav === nav && h.route !== "r"); });
    var r = h.route === "r" && byId[h.arg];
    document.title = (r ? r.title : h.arg || TITLES[h.route] || "") ? (r ? r.title : (h.arg || TITLES[h.route])) + " · Народные рецепты" : "Народные рецепты";
    document.getElementById("nav").classList.remove("open");
    document.getElementById("menuBtn").setAttribute("aria-expanded", "false");
  }
  var lastRoute = null;
  window.addEventListener("hashchange", function () {
    var h = parseHash();
    // Ввод в строку поиска меняет адрес без перерисовки, остальное перерисовываем
    var key = h.route + "/" + h.arg;
    render();
    if (key !== lastRoute) window.scrollTo(0, 0);
    lastRoute = key;
  });
  document.getElementById("menuBtn").onclick = function () {
    var n = document.getElementById("nav");
    n.classList.toggle("open");
    this.setAttribute("aria-expanded", n.classList.contains("open") ? "true" : "false");
  };
  document.getElementById("footInfo").textContent = recipesWord(recipes.length) + " в каталоге";

  if (!recipes.length) {
    app.innerHTML = "<h1>Каталог пуст</h1><p>Не найден файл <code>data/catalog.js</code>. Запустите <code>python3 scripts/build.py</code> или дождитесь сборки на GitHub.</p>";
  } else {
    lastRoute = parseHash().route + "/" + parseHash().arg;
    render();
  }
})();
