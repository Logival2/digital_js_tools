// ═══════════════════════════════════════════════════════════════════
// Digital tools — interface commune, version 000 (va avec ui_000.css)
// Chargé en <script defer> avant le script de l'outil, il ne touche qu'à l'affichage :
// · titre en MingLiU (SVG, ajusté à la largeur du panneau),
// · volets « + / – » sur les titres de section,
// · valeur de chaque slider à droite de son libellé, piste remplie jusqu'au curseur,
// · clic à côté d'une fenêtre (RGPD) pour la fermer.
// ═══════════════════════════════════════════════════════════════════
(() => {
  // ── Titre : <h1 class="toolTitle">Ligne 1<br>Ligne 2</h1> → SVG, une ligne par <text> ──
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
    lines.forEach((line, i) => {
      const t = document.createElementNS(SVG_NS, "text");
      t.setAttribute("x", "0");
      t.setAttribute("y", `${0.8 + i * LINE_HEIGHT}em`);
      t.textContent = line;
      svg.append(t);
    });
    h1.replaceChildren(hidden, svg);
    return { h1, svg, lines: lines.length };
  });
  // Taille du titre : celle de la feuille de style, réduite si la ligne la plus longue dépasse
  function fitTitles() {
    for (const { h1, svg, lines } of titles) {
      svg.style.fontSize = "";
      const size = parseFloat(getComputedStyle(h1).fontSize);
      const avail = svg.clientWidth;
      if (!avail) continue;
      svg.style.fontSize = `${size}px`;
      const widest = Math.max(...Array.from(svg.querySelectorAll("text"), (t) => t.getComputedTextLength()));
      const k = widest > 0 ? Math.min(1, avail / (widest + size * 0.03)) : 1;
      const fs = size * k;
      svg.style.fontSize = `${fs}px`;
      svg.style.height = `${fs * (0.95 + (lines - 1) * LINE_HEIGHT)}px`;
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

  // ── Fenêtres : un clic sur le fond assombri ferme le volet ──
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("click", (e) => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect(); // la marge intérieure du volet a la même cible
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
    });
  }
})();
