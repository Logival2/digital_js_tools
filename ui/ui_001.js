// ═══════════════════════════════════════════════════════════════════
// Digital tools — interface commune, version 001 (va avec ui_001.css ; même comportement que ui_000.js)
// Chargé en <script defer> avant le script de l'outil, il ne touche qu'à l'affichage :
// · titre en MingLiU Prop (SVG, ajusté à la largeur du panneau),
// · volets « + / – » sur les titres de section,
// · valeur de chaque slider à droite de son libellé, piste remplie jusqu'au curseur,
// · clic à côté d'une fenêtre (RGPD) pour la fermer.
// ═══════════════════════════════════════════════════════════════════
(() => {
  // ── Titre : <h1 class="toolTitle">Ligne 1<br>Ligne 2</h1> → SVG, une ligne par <text> ;
  //    le titre tient sur une seule ligne tant qu'il ne dépasse pas, sinon il se coupe aux <br> ──
  const SVG_NS = "http://www.w3.org/2000/svg";
  const LINE_HEIGHT = 0.98; // en em : un peu plus que Gradient body (0,88), pour les capitales accentuées
  const titles = Array.from(document.querySelectorAll(".toolTitle")).map((h1) => {
    const lines = h1.innerHTML.split(/<br\s*\/?>/i).map((s) => {
      const tmp = document.createElement("div");
      tmp.innerHTML = s;
      return tmp.textContent.trim().toUpperCase();
    }).filter(Boolean);
    const hidden = document.createElement("span");
    hidden.className = "visuallyHidden";
    hidden.textContent = lines.join(" ");
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("aria-hidden", "true");
    h1.replaceChildren(hidden, svg);
    return { h1, svg, lines };
  });
  function setLines(svg, lines) {
    svg.replaceChildren(...lines.map((line, i) => {
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", "0");
      t.setAttribute("y", `${0.8 + i * LINE_HEIGHT}em`);
      t.textContent = line;
      return t;
    }));
  }
  // Taille du titre : celle de la feuille de style, réduite si la ligne la plus longue dépasse.
  // Dans le panneau des outils, tous les titres prennent la taille de celui de la Matrice d'images
  // (« IMAGE MATRICE » sur toute la largeur du SVG), même quand leurs lignes sont plus courtes ;
  // l'accueil (#top) aussi, son titre ayant la largeur d'un panneau.
  const REF_TITLE = "IMAGE MATRICE";
  const textWidth = (svg, text) => {
    const t = document.createElementNS(SVG_NS, "text");
    t.textContent = text;
    svg.append(t);
    const w = t.getComputedTextLength();
    t.remove();
    return w;
  };
  function fitTitles() {
    for (const { h1, svg, lines } of titles) {
      svg.style.fontSize = "";
      const size = parseFloat(getComputedStyle(h1).fontSize);
      const avail = svg.clientWidth;
      if (!avail) continue;
      svg.style.fontSize = `${size}px`;
      const margin = size * 0.03;
      // taille de base : celle de la feuille de style ou, dans un panneau, celle d'« IMAGE MATRICE »
      const base = h1.closest("#panel, #top") ? Math.min(1, avail / (textWidth(svg, REF_TITLE) + margin)) : 1;
      const oneLine = lines.join(" ");
      const shown = lines.length > 1 && (textWidth(svg, oneLine) + margin) * base <= avail ? [oneLine] : lines;
      setLines(svg, shown);
      const widest = Math.max(...Array.from(svg.querySelectorAll("text"), (t) => t.getComputedTextLength()));
      const k = widest > 0 ? Math.min(base, avail / (widest + margin)) : base;
      const fs = size * k;
      svg.style.fontSize = `${fs}px`;
      svg.style.height = `${fs * (0.95 + (shown.length - 1) * LINE_HEIGHT)}px`;
    }
  }
  fitTitles();
  document.fonts.ready.then(fitTitles);
  if (titles.length) new ResizeObserver(fitTitles).observe(titles[0].h1);

  // ── Volets : cliquer le titre d'une section la replie ──
  for (const h2 of document.querySelectorAll(".section > h2")) {
    const section = h2.parentElement;
    h2.tabIndex = 0;
    h2.setAttribute("role", "button");
    h2.setAttribute("aria-expanded", String(!section.classList.contains("collapsed"))); // une section peut partir fermée
    const toggle = () => {
      const collapsed = section.classList.toggle("collapsed");
      h2.setAttribute("aria-expanded", String(!collapsed));
    };
    h2.addEventListener("click", toggle);
    h2.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  }

  // ── Menus déroulants (Chrome, Edge : menus personnalisables) : un bouton qui montre le choix,
  //    pour que ui_001.css puisse couper un nom trop long par « … » sans pousser la flèche hors de la pilule ──
  if (CSS.supports("appearance", "base-select")) {
    const addButton = (select) => {
      if (select.querySelector(":scope > button")) return;
      const button = document.createElement("button");
      button.append(document.createElement("selectedcontent"));
      select.prepend(button);
    };
    // un outil qui remplace les options (Bookmarks) efface le bouton : il revient aussitôt
    const watch = new MutationObserver((records) => records.forEach((r) => addButton(r.target)));
    for (const select of document.querySelectorAll("select:not([multiple])")) {
      addButton(select);
      watch.observe(select, { childList: true });
    }
  }

  // ── Sliders : valeur affichée en fin de ligne, piste remplie ──
  // Les outils changent parfois un slider par le code (sans événement) : on relit les valeurs
  // à chaque image, mais on n'écrit dans la page que lorsqu'elles changent.
  const sliders = Array.from(document.querySelectorAll('input[type="range"]')).map((el) => {
    let out = null;
    const row = el.closest(".row");
    if (row && !row.querySelector("output")) {
      out = document.createElement("output");
      out.setAttribute("for", el.id);
      row.append(out); // en dernier : l'outil peut chercher le slider juste après le libellé
    }
    return { el, out, last: null };
  });
  const decimals = (el) => Math.min(4, (String(el.step).split(".")[1] ?? "").length);
  function paintSliders() {
    for (const s of sliders) {
      const { el, out } = s;
      const key = `${el.value}|${el.min}|${el.max}`;
      if (key === s.last) continue;
      s.last = key;
      const span = el.max - el.min || 1;
      el.style.setProperty("--fill", `${((el.value - el.min) / span) * 100}%`);
      if (out) out.textContent = Number(el.value).toFixed(decimals(el)) + (el.dataset.unit ? ` ${el.dataset.unit}` : "");
    }
    requestAnimationFrame(paintSliders);
  }
  if (sliders.length) paintSliders();

  // ── Petits choix (4 options au plus) : <select class="asPills"> devient une rangée de pilules.
  // Le menu reste dans la page (caché) : l'outil lit et règle toujours select.value ; un clic
  // le change et envoie « input » et « change », comme si on avait choisi dans le menu. ──
  const pillSelects = Array.from(document.querySelectorAll("select.asPills")).map((select) => {
    const row = document.createElement("div");
    row.className = "pills";
    const buttons = Array.from(select.options).map((opt) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = opt.textContent;
      b.addEventListener("click", () => {
        if (select.value === opt.value) return;
        select.value = opt.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      return [opt.value, b];
    });
    row.append(...buttons.map(([, b]) => b));
    select.hidden = true;
    select.after(row);
    return { select, buttons, last: null };
  });
  // l'outil change parfois la valeur par le code (réinitialiser, préréglage) : on relit à chaque image
  function paintPills() {
    for (const p of pillSelects) {
      if (p.select.value === p.last) continue;
      p.last = p.select.value;
      for (const [v, b] of p.buttons) b.setAttribute("aria-pressed", String(v === p.select.value));
    }
    requestAnimationFrame(paintPills);
  }
  if (pillSelects.length) paintPills();

  // ── Menus déroulants ailleurs (Firefox, Safari) : leur liste native ne se dessine pas en CSS ;
  // un menu fait maison la remplace, avec la même pilule et la même plaque de verre qu'en Chrome.
  // Le <select> reste caché dans la page : l'outil lit et règle toujours select.value ;
  // un choix envoie « input » et « change ». Clavier : flèches, Début / Fin, Entrée, Échap. ──
  const menus = [];
  if (!CSS.supports("appearance", "base-select") && "popover" in HTMLElement.prototype) {
    let uid = 0;
    for (const select of document.querySelectorAll("select:not([multiple]):not(.asPills)")) menus.push(makeMenu(select, uid++));
    // la page ou le panneau défile, la fenêtre change de taille : la liste ouverte se ferme
    const closeAll = (e) => { for (const m of menus) if (e.target !== m.list) m.list.hidePopover(); };
    window.addEventListener("scroll", closeAll, true);
    window.addEventListener("resize", closeAll);
  }
  function makeMenu(select, uid) {
    const wrap = document.createElement("div");
    wrap.className = "uiMenu";
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    const value = document.createElement("span");
    value.id = `uiMenu${uid}Value`;
    button.append(value);
    const list = document.createElement("div");
    list.className = "uiMenuList";
    list.popover = "auto";
    list.tabIndex = -1;
    list.setAttribute("role", "listbox");
    button.popoverTargetElement = list; // le bouton ouvre et ferme la liste (un clic dessus ne la rouvre pas)
    wrap.append(button, list);
    select.classList.add("uiMenuSource");
    select.after(wrap);
    // le libellé nomme le bouton, et un clic dessus y met le focus comme sur un menu
    const label = select.id ? document.querySelector(`label[for="${CSS.escape(select.id)}"]`) : null;
    if (label) {
      label.id ||= `uiMenu${uid}Label`;
      button.setAttribute("aria-labelledby", `${label.id} ${value.id}`);
      list.setAttribute("aria-labelledby", label.id);
      label.addEventListener("click", (e) => { e.preventDefault(); button.focus(); });
    }

    let items = [], active = -1;
    const setActive = (i) => {
      items[active]?.classList.remove("active");
      active = Math.max(0, Math.min(items.length - 1, i));
      const el = items[active];
      if (!el) return;
      el.classList.add("active");
      // la liste seule défile jusqu'au choix (scrollIntoView ferait aussi défiler le panneau, qui la fermerait)
      const top = el.offsetTop, bottom = top + el.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top - 4;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
      list.setAttribute("aria-activedescendant", el.id);
    };
    const choose = (opt) => {
      list.hidePopover();
      if (select.value === opt.value) return;
      select.value = opt.value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };
    // les options sont relues à chaque ouverture : un outil peut les remplir ou les changer (Type flyer, Bookmarks)
    const build = () => {
      items = [];
      active = -1;
      const option = (opt) => {
        const el = document.createElement("div");
        el.id = `uiMenu${uid}Option${items.length}`;
        el.setAttribute("role", "option");
        el.setAttribute("aria-selected", String(opt.selected));
        el.textContent = opt.textContent;
        if (opt.disabled) {
          el.setAttribute("aria-disabled", "true");
          return el;
        }
        const i = items.push(el) - 1;
        el.addEventListener("click", () => choose(opt));
        el.addEventListener("pointermove", () => { if (active !== i) setActive(i); });
        return el;
      };
      list.replaceChildren(...Array.from(select.children, (child) => {
        if (child.tagName !== "OPTGROUP") return option(child);
        const group = document.createElement("div");
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", child.label);
        const title = document.createElement("div");
        title.className = "uiMenuGroup";
        title.setAttribute("aria-hidden", "true");
        title.textContent = child.label;
        group.append(title, ...Array.from(child.children, option));
        return group;
      }));
    };
    // sous le bouton, à sa largeur au moins ; au-dessus seulement près du bas de l'écran
    const place = () => {
      const r = button.getBoundingClientRect();
      const below = innerHeight - r.bottom - 12, above = r.top - 12;
      const up = list.scrollHeight > below && below < 240 && above > below;
      list.style.minWidth = `${r.width}px`;
      list.style.maxHeight = `${Math.min(420, up ? above : below)}px`;
      list.style.top = up ? "auto" : `${r.bottom + 4}px`;
      list.style.bottom = up ? `${innerHeight - r.top + 4}px` : "auto";
      list.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 8 - list.offsetWidth))}px`;
    };
    list.addEventListener("beforetoggle", (e) => {
      if (e.newState !== "open") return;
      if (select.disabled) { e.preventDefault(); return; }
      build();
    });
    list.addEventListener("toggle", (e) => {
      const open = e.newState === "open";
      button.setAttribute("aria-expanded", String(open));
      if (open) {
        place();
        setActive(Math.max(0, items.findIndex((el) => el.getAttribute("aria-selected") === "true")));
        list.focus({ preventScroll: true });
      } else if (list.contains(document.activeElement) || document.activeElement === document.body) {
        button.focus({ preventScroll: true });
      }
    });
    button.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); list.showPopover(); }
    });
    list.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") setActive(active + 1);
      else if (e.key === "ArrowUp") setActive(active - 1);
      else if (e.key === "Home") setActive(0);
      else if (e.key === "End") setActive(items.length - 1);
      else if (e.key === "Enter" || e.key === " ") {
        const el = items[active];
        if (el) el.click();
      } else if (e.key === "Tab") { list.hidePopover(); return; }
      else return;
      e.preventDefault();
    });
    return { select, wrap, button, value, list, last: null };
  }
  // l'outil change parfois la valeur, les options ou l'état par le code : on relit à chaque image
  function paintMenus() {
    for (const m of menus) {
      const text = m.select.selectedOptions[0]?.textContent ?? "";
      if (text !== m.last) m.value.textContent = m.last = text;
      if (m.button.disabled !== m.select.disabled) m.button.disabled = m.select.disabled;
      if (m.wrap.hidden !== m.select.hidden) m.wrap.hidden = m.select.hidden;
    }
    requestAnimationFrame(paintMenus);
  }
  if (menus.length) paintMenus();

  // ── Téléphone : les outils sont faits pour un ordinateur (grand écran, souris, clavier).
  // Sur petit écran, un volet couvre la page et renvoie vers l'ordinateur ; une page adaptée
  // au téléphone s'en exempte avec <body data-mobile="ok"> (l'accueil, HEIF to JPEG). ──
  if (document.body.dataset.mobile !== "ok") {
    const small = matchMedia("(max-width: 760px), (max-height: 480px) and (pointer: coarse)");
    const notice = document.createElement("div");
    notice.id = "desktopOnly";
    notice.setAttribute("role", "alertdialog");
    notice.setAttribute("aria-modal", "true");
    notice.setAttribute("aria-labelledby", "desktopOnlyTitle");
    notice.innerHTML = `
      <div class="desktopOnlyPlate">
        <p class="eyebrow"><a class="badge backLink" href="../">← Digital tools</a></p>
        <h2 id="desktopOnlyTitle">Desktop only</h2>
        <p>This tool is made for a computer: a large screen, a mouse and a keyboard. Open it in a desktop browser.</p>
      </div>`;
    const apply = () => {
      notice.hidden = !small.matches;
      if (small.matches && !notice.isConnected) document.body.append(notice);
    };
    apply();
    small.addEventListener("change", apply);
  }

  // ── Outils plein écran sur téléphone : un bouton pour ouvrir / fermer le panneau (pas de touche H) ──
  if (document.body.dataset.layout === "fullscreen") {
    const phone = matchMedia("(max-width: 760px)");
    const toggle = document.createElement("button");
    toggle.id = "panelToggle";
    toggle.type = "button";
    const label = () => {
      const hidden = document.body.classList.contains("panel-hidden");
      toggle.textContent = hidden ? "Settings" : "Hide";
      toggle.setAttribute("aria-expanded", String(!hidden));
    };
    toggle.addEventListener("click", () => { document.body.classList.toggle("panel-hidden"); label(); });
    new MutationObserver(label).observe(document.body, { attributes: true, attributeFilter: ["class"] }); // H au clavier
    const apply = () => {
      if (phone.matches && !toggle.isConnected) document.body.append(toggle);
      toggle.hidden = !phone.matches;
      label();
    };
    apply();
    phone.addEventListener("change", apply);
  }

  // ── Traits de coupe : autour de chaque affiche marquée <… data-crop>, comme sur une épreuve d'imprimeur.
  //    Le cadre suit l'affiche (format changé, fenêtre redimensionnée, page qui défile) ; caché avec elle. ──
  const crops = Array.from(document.querySelectorAll("[data-crop]"), (el) => {
    const marks = document.createElement("div");
    marks.className = "cropMarks";
    marks.setAttribute("aria-hidden", "true");
    document.body.append(marks);
    return { el, marks, key: null };
  });
  const cropCss = getComputedStyle(document.documentElement);
  const cropE = parseFloat(cropCss.getPropertyValue("--crop-gap")) + parseFloat(cropCss.getPropertyValue("--crop-len"));
  function paintCrops() {
    const e = cropE;
    for (const c of crops) {
      const r = c.el.getBoundingClientRect();
      const shown = r.width > 0 && r.height > 0 && c.el.checkVisibility?.({ visibilityProperty: true }) !== false;
      const key = shown ? `${r.left} ${r.top} ${r.width} ${r.height}` : "";
      if (key === c.key) continue;
      c.key = key;
      c.marks.hidden = !shown;
      if (!shown) continue;
      Object.assign(c.marks.style, {
        left: `${r.left - e}px`,
        top: `${r.top - e}px`,
        width: `${r.width + 2 * e}px`,
        height: `${r.height + 2 * e}px`,
      });
    }
    requestAnimationFrame(paintCrops);
  }
  if (crops.length) paintCrops();

  // ── Fenêtres : un clic sur le fond assombri ferme le volet ──
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("click", (e) => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect(); // la marge intérieure du volet a la même cible
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
    });
  }
})();

// ── Retour caméra commun, repris de la Matrice d'images : l'image en noir et blanc, retournée comme dans
// une glace, recadrée au centre, et le squelette de la main (MediaPipe) par-dessus : les traits entre les
// articulations dans le jaune de l'interface (--lime), le contour des points aussi quand la main agit (pince, attrape…). L'outil l'appelle à chaque image : drawCameraPreview(canvas, video, { landmarks, active, mirror }) ──
window.drawCameraPreview = (() => {
  // paires de points reliés, les mêmes que HandLandmarker.HAND_CONNECTIONS (paume, puis pouce → auriculaire)
  const LINKS = [
    [0, 1], [0, 5], [9, 13], [13, 17], [5, 9], [0, 17],
    [1, 2], [2, 3], [3, 4], [5, 6], [6, 7], [7, 8], [9, 10], [10, 11], [11, 12],
    [13, 14], [14, 15], [15, 16], [17, 18], [18, 19], [19, 20],
  ];
  return function drawCameraPreview(canvas, video, { landmarks = null, active = false, mirror = true } = {}) {
    if (video.readyState < 2) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.save();
    if (mirror) ctx.setTransform(-1, 0, 0, 1, W, 0);
    ctx.filter = "grayscale(1) contrast(1.1)";
    // l'image remplit l'aperçu, recadrée au centre
    const vw = video.videoWidth || W, vh = video.videoHeight || H;
    const k = Math.max(W / vw, H / vh), dw = vw * k, dh = vh * k, ox = (W - dw) / 2, oy = (H - dh) / 2;
    ctx.drawImage(video, ox, oy, dw, dh);
    ctx.filter = "none";
    if (landmarks) {
      const pt = (q) => [ox + q.x * dw, oy + q.y * dh];
      const lime = getComputedStyle(document.documentElement).getPropertyValue("--lime").trim() || "#e4fb02";
      ctx.strokeStyle = lime;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [a, b] of LINKS) {
        ctx.moveTo(...pt(landmarks[a]));
        ctx.lineTo(...pt(landmarks[b]));
      }
      ctx.stroke();
      ctx.fillStyle = "#000";
      ctx.strokeStyle = active ? lime : "#fff";
      for (const q of landmarks) {
        const [x, y] = pt(q);
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  };
})();
