// LA MESURE DES FORMULAIRES : les espacements d'un formulaire, lus en pixels dans la page.
//
// La règle vient d'une leçon de Zander Whitehurst (« Stop guessing your UI form spacing », 29/10/2026),
// sur une grille de 4 px, en groupes de contenu — serré DANS un groupe, plus large ENTRE les groupes :
//
//   titre → texte d'en-tête    8     (le titre et sa phrase sont UN groupe)
//   en-tête → premier champ   24
//   étiquette → champ          8     (l'étiquette est AU-DESSUS du champ, jamais dedans)
//   champ → aide               4     (l'aide colle à SON champ)
//   champ → champ suivant     20     (de la fin d'un groupe au début du suivant)
//   dernier champ → bouton    20
//   bouton → bouton            8     (les actions d'un même groupe : des boutons frères)
//   groupe → groupe          ≥ 24    (deux boutons de groupes différents ne se touchent pas)
//
// Et une hauteur pour tous les champs d'une ligne : 52 px, celle des boutons.
//
// Ces nombres sont écrits ICI, pas importés de l'application : le harnais lit la leçon, pas le code
// qu'il juge (sinon changer la règle dans le code ferait changer le juge avec lui). Il ne lit que ce
// qui se VOIT : un champ caché, une feuille fermée, ne comptent pas. Il juge aussi l'application
// d'avant : il ne cherche aucune marque posée pour lui, seulement des étiquettes, des champs, des
// aides et des boutons, tels que n'importe quelle page les porte.
//
// Une seule exception, dite à chaque passage : le ticket d'ordre du marché ([data-ticket]), compact
// comme sur toute plateforme d'échange (prix, quantité, total, avec ses « − » et « + ») — ce n'est pas
// un formulaire qu'on remplit, c'est un instrument qu'on règle.
export const REGLE = { titreTexte: 8, enTeteChamp: 24, etiquetteChamp: 8, champAide: 4, champChamp: 20, champBouton: 20, boutonBouton: 8, groupeGroupe: 24, hauteurChamp: 52 };
const TOLERANCE = 0.75;

/** Mesure la page telle qu'elle est ; rend les écarts, chacun dit en clair, et le nombre de champs du ticket laissés de côté. */
export async function mesurerLesFormulaires(page) {
  return page.evaluate(({ R, TOL }) => {
    const ecarts = [];
    let ticket = 0;
    const vu = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      for (let x = el; x; x = x.parentElement) {
        const s = getComputedStyle(x);
        if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
        if (x.getAttribute("aria-hidden") === "true") return false;
      }
      return true;
    };
    const texte = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const nom = (c) => (texte(c.etiquette) || c.input.getAttribute("aria-label") || c.input.placeholder || c.input.name || "?").slice(0, 40);
    const juger = (quoi, mesure, attendu) => {
      if (Math.abs(mesure - attendu) > TOL) ecarts.push(`${quoi} : ${Math.round(mesure * 10) / 10} px au lieu de ${attendu}`);
    };

    /* 1 · les champs : la boîte, son étiquette, son aide */
    const champs = [];
    for (const input of document.querySelectorAll("input, textarea")) {
      if (["hidden", "checkbox", "radio", "range", "file"].includes(input.type) || !vu(input)) continue;
      if (input.closest("[data-ticket]")) { ticket++; continue; }
      const boite = input.closest(".MuiInputBase-root") ?? input;
      if (!vu(boite)) continue;
      const id = input.id;
      const etiquette = (id && [...document.querySelectorAll(`label[for="${CSS.escape(id)}"]`)].find(vu)) || null;
      const aides = (input.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)
        .map((i) => document.getElementById(i)).filter((el) => el && vu(el) && texte(el));
      champs.push({ input, boite, etiquette, aide: aides[0] ?? null, b: boite.getBoundingClientRect() });
    }
    for (const c of champs) {
      const n = nom(c);
      if (!c.etiquette) { ecarts.push(`« ${n} » : aucune étiquette visible liée au champ`); }
      else {
        const e = c.etiquette.getBoundingClientRect();
        if (e.bottom > c.b.top + TOL) ecarts.push(`« ${n} » : l'étiquette est DANS le champ, pas au-dessus`);
        else juger(`« ${n} » étiquette → champ`, c.b.top - e.bottom, R.etiquetteChamp);
      }
      if (c.aide) juger(`« ${n} » champ → aide`, c.aide.getBoundingClientRect().top - c.b.bottom, R.champAide);
      if (c.input.tagName === "INPUT") juger(`« ${n} » hauteur du champ`, c.b.height, R.hauteurChamp);
    }

    /* ce qui s'écrit entre deux pièces : une phrase entre deux boutons, un titre entre deux champs, et ce ne sont plus deux voisins d'un même groupe */
    const textes = [...document.querySelectorAll("body *")].filter((el) =>
      [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && !el.closest(".MuiInputBase-root, .MuiButton-root, label, .MuiFormHelperText-root") && vu(el))
      .map((el) => el.getBoundingClientRect());
    const separes = (haut, bas, gauche, droite) => textes.some((r) => r.top >= haut - TOL && r.bottom <= bas + TOL && Math.min(r.right, droite) - Math.max(r.left, gauche) > 0);

    /* 2 · d'un champ au suivant, dans une même colonne : la fin d'un groupe → le début du suivant */
    const bloc = (c) => {
      const rs = [c.b, c.etiquette?.getBoundingClientRect(), c.aide?.getBoundingClientRect()].filter(Boolean);
      return { haut: Math.min(...rs.map((r) => r.top)), bas: Math.max(...rs.map((r) => r.bottom)), gauche: c.b.left, droite: c.b.right };
    };
    const blocs = champs.map((c) => ({ c, ...bloc(c) })).sort((a, b) => a.haut - b.haut);
    const memeColonne = (a, b) => Math.min(a.droite, b.droite) - Math.max(a.gauche, b.gauche) > 0.5 * Math.min(a.droite - a.gauche, b.droite - b.gauche);
    for (let i = 1; i < blocs.length; i++) {
      const a = blocs[i - 1], b = blocs[i];
      if (!memeColonne(a, b) || b.haut < a.bas - TOL) continue;   // côte à côte (jour, mois, année) : pas un empilement
      const entre = b.haut - a.bas;
      if (entre > 64 || separes(a.bas, b.haut, a.gauche, a.droite)) continue;   // un autre bloc de l'écran sépare les deux
      juger(`« ${nom(a.c)} » → « ${nom(b.c)} »`, entre, R.champChamp);
    }

    /* 3 · le bouton qui suit le dernier champ, et les boutons empilés entre eux */
    const boutons = [...document.querySelectorAll("button.MuiButton-root, a.MuiButton-root")]
      .filter((x) => vu(x) && !x.closest(".MuiInputBase-root") && x.getBoundingClientRect().width > 160)
      .map((x) => ({ x, r: x.getBoundingClientRect() })).sort((a, b) => a.r.top - b.r.top);
    for (const bl of blocs) {
      const suivant = boutons.find((o) => o.r.top >= bl.bas - TOL);
      if (!suivant) continue;
      const entre = suivant.r.top - bl.bas;
      const autreChamp = blocs.some((o) => o !== bl && o.haut >= bl.bas - TOL && o.haut < suivant.r.top);
      if (autreChamp || entre > 48 || separes(bl.bas, suivant.r.top, bl.gauche, bl.droite)) continue;
      if (Math.min(bl.droite, suivant.r.right) - Math.max(bl.gauche, suivant.r.left) <= 0) continue;
      juger(`« ${nom(bl.c)} » → bouton « ${texte(suivant.x).slice(0, 30)} »`, entre, R.champBouton);
    }
    for (let i = 1; i < boutons.length; i++) {
      const a = boutons[i - 1].r, b = boutons[i].r;
      const entre = b.top - a.bottom;
      if (entre < -TOL || entre > 32 || Math.abs(a.left - b.left) > 1 || Math.abs(a.width - b.width) > 1 || separes(a.bottom, b.top, a.left, a.right)) continue;
      const quoi = `bouton « ${texte(boutons[i - 1].x).slice(0, 24)} » → « ${texte(boutons[i].x).slice(0, 24)} »`;
      // un groupe, c'est ce que la page range ensemble : deux boutons frères ; sinon, deux groupes
      if (boutons[i - 1].x.parentElement === boutons[i].x.parentElement) juger(quoi, entre, R.boutonBouton);
      else if (entre < R.groupeGroupe - TOL) ecarts.push(`${quoi} (deux groupes) : ${Math.round(entre * 10) / 10} px, il en faut au moins ${R.groupeGroupe}`);
    }

    /* 4 · l'en-tête d'un formulaire, quand l'écran le désigne (data-en-tete) : titre → texte, puis → premier champ */
    for (const t of document.querySelectorAll("[data-en-tete]")) {
      if (!vu(t)) continue;
      const [titre, phrase] = [...t.children].filter(vu);
      if (titre && phrase) juger("en-tête titre → texte", phrase.getBoundingClientRect().top - titre.getBoundingClientRect().bottom, R.titreTexte);
      const bas = t.getBoundingClientRect().bottom;
      const premier = blocs.find((b) => b.haut >= bas - TOL);
      if (premier && premier.haut - bas <= 48) juger("en-tête → premier champ", premier.haut - bas, R.enTeteChamp);
    }
    return { ecarts: [...new Set(ecarts)], ticket };
  }, { R: REGLE, TOL: TOLERANCE });
}
