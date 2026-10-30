// ============================================================
// LE PONT entre l'application (dans la WebView) et le téléphone.
//
// L'application fait ce qu'il faut dans un navigateur : partager un reçu
// (navigator.share), copier un numéro ou une adresse (navigator.clipboard),
// télécharger un fichier (<a download>). Dans une WebView, rien de cela
// n'aboutit. Ce script, injecté AVANT chaque page, intercepte ces gestes et
// les confie à la coque (postMessage). Aucun fichier de l'application n'est
// modifié : elle passe par les API standard, la coque les attrape.
// Repris de BONZINI HQ (bonzinilabs/hq-app/src/bridge.ts).
// ============================================================

/** Ce que la page envoie à la coque. */
export type MessageDuPont =
  | { type: 'fichier'; nom: string; mime: string; base64: string }
  | { type: 'fichiers'; titre: string; fichiers: { nom: string; mime: string; base64: string }[] }
  | { type: 'url-a-telecharger'; url: string; nom: string }
  | { type: 'partager-texte'; titre: string; texte: string }
  | { type: 'presse-papiers'; texte: string }
  | { type: 'theme'; fond: string }
  | { type: 'route'; chemin: string }
  | { type: 'connexion-google'; url: string }
  | { type: 'erreur'; message: string };

/**
 * « Continuer avec Google » : Google refuse une WebView (disallowed_useragent). L'application
 * confie l'adresse à la coque, qui l'ouvre dans un onglet du système ; Google revient par
 * glisil://auth-retour, que la coque rend à la page (l'événement « glisil:retour-oauth »), où
 * le vérificateur PKCE — ou le nonce du chemin direct — attend. On n'ouvre QUE :
 *   · la page d'autorisation d'un projet Supabase (l'ancien chemin), en https ;
 *   · la page de Google elle-même (le chemin direct, pont v3 : l'écran dit « glisil.com »),
 *     et seulement si le retour demandé est la page de retour DE L'APPLICATION — jamais une
 *     autre adresse, où un jeton d'identité irait se perdre.
 */
export function estAdresseGoogleDeSupabase(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /^[a-z0-9]+\.supabase\.co$/.test(u.hostname) && u.pathname === '/auth/v1/authorize'
      && u.searchParams.get('provider') === 'google';
  } catch {
    return false;
  }
}

/** Le chemin direct : la page de Google, un jeton d'identité, rendu à la page de retour de l'application. */
export function estAdresseGoogleDirecte(url: string, baseUrl: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'accounts.google.com' && u.pathname === '/o/oauth2/v2/auth'
      && u.searchParams.get('response_type') === 'id_token'
      && u.searchParams.get('redirect_uri') === `${baseUrl}/bienvenue/retour`;
  } catch {
    return false;
  }
}

export const RETOUR_GOOGLE = 'glisil://auth-retour';

/** Le script qui rend à la page le retour de Google (ou son abandon). */
export function scriptDeRetourGoogle(url: string): string {
  return `window.dispatchEvent(new CustomEvent('glisil:retour-oauth', { detail: ${JSON.stringify(url)} })); true;`;
}

export function lireMessage(brut: string): MessageDuPont | null {
  try {
    const m = JSON.parse(brut) as MessageDuPont;
    return m && typeof m === 'object' && typeof m.type === 'string' ? m : null;
  } catch {
    return null;
  }
}

/** Injecté avant le contenu, cadre principal seulement. ES5 simple, se termine par `true;`. */
export const SCRIPT_INJECTE = `
(function () {
  if (window.__xafeCoque) return;
  // version 2 : la coque sait ouvrir Google hors de la WebView (connexion-google)
  // version 3 : … y compris la page de Google elle-même (le chemin direct, « glisil.com »)
  window.__xafeCoque = { version: 3, google: true };
  function poster(m) { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} }
  function enBase64(blob) {
    return new Promise(function (resoudre, rejeter) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result); resoudre(s.slice(s.indexOf(',') + 1)); };
      r.onerror = function () { rejeter(r.error); };
      r.readAsDataURL(blob);
    });
  }

  // 1. Garder les Blob derrière les URL « blob: », même après révocation.
  var blobs = {};
  var creer = URL.createObjectURL.bind(URL);
  var revoquer = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = function (obj) { var u = creer(obj); if (obj instanceof Blob) blobs[u] = obj; return u; };
  URL.revokeObjectURL = function (u) { setTimeout(function () { delete blobs[u]; }, 120000); return revoquer(u); };

  // 2. Les téléchargements <a download>.
  function telecharger(a) {
    if (!a || !a.hasAttribute || !a.hasAttribute('download')) return false;
    var href = a.href || '';
    var nom = a.getAttribute('download') || 'document';
    var blob = blobs[href];
    if (blob) {
      enBase64(blob).then(function (b64) { poster({ type: 'fichier', nom: nom, mime: blob.type || 'application/octet-stream', base64: b64 }); })
        .catch(function (e) { poster({ type: 'erreur', message: String(e) }); });
      return true;
    }
    if (href.indexOf('data:') === 0) {
      fetch(href).then(function (r) { return r.blob(); }).then(function (b) {
        return enBase64(b).then(function (b64) { poster({ type: 'fichier', nom: nom, mime: b.type || 'application/octet-stream', base64: b64 }); });
      }).catch(function (e) { poster({ type: 'erreur', message: String(e) }); });
      return true;
    }
    if (/^https?:/i.test(href)) { poster({ type: 'url-a-telecharger', url: href, nom: nom }); return true; }
    return false;
  }
  var clicNatif = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (telecharger(this)) return; return clicNatif.apply(this, arguments); };
  document.addEventListener('click', function (e) {
    var t = e.target;
    var a = t && t.closest ? t.closest('a[download]') : null;
    if (a && telecharger(a)) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // 3. La feuille de partage : celle du téléphone.
  navigator.canShare = function () { return true; };
  navigator.share = function (data) {
    data = data || {};
    var fichiers = data.files ? Array.prototype.slice.call(data.files) : [];
    if (fichiers.length) {
      return Promise.all(fichiers.map(function (f) {
        return enBase64(f).then(function (b64) { return { nom: f.name || 'document', mime: f.type || 'application/octet-stream', base64: b64 }; });
      })).then(function (liste) { poster({ type: 'fichiers', titre: data.title || '', fichiers: liste }); });
    }
    poster({ type: 'partager-texte', titre: data.title || '', texte: [data.text, data.url].filter(Boolean).join('\\n') });
    return Promise.resolve();
  };

  // 4. Le presse-papiers : par la coque, qui a le droit d'écrire.
  if (navigator.clipboard) {
    navigator.clipboard.writeText = function (texte) { poster({ type: 'presse-papiers', texte: String(texte) }); return Promise.resolve(); };
  }

  // 5. La couleur du fond : la coque peint les bords (barre d'état, barre du bas) pareil.
  function envoyerTheme() {
    try {
      var fond = getComputedStyle(document.body || document.documentElement).backgroundColor;
      if (fond && fond !== 'rgba(0, 0, 0, 0)' && fond !== 'transparent') poster({ type: 'theme', fond: fond });
    } catch (e) {}
  }
  document.addEventListener('DOMContentLoaded', envoyerTheme);

  // 6. La page courante, pour que le bouton retour sache où il est.
  var pousserEtat = history.pushState.bind(history);
  history.pushState = function () { var r = pousserEtat.apply(history, arguments); poster({ type: 'route', chemin: location.pathname }); return r; };
  var remplacerEtat = history.replaceState.bind(history);
  history.replaceState = function () { var r = remplacerEtat.apply(history, arguments); poster({ type: 'route', chemin: location.pathname }); return r; };
  window.addEventListener('popstate', function () { poster({ type: 'route', chemin: location.pathname }); });
})();
true;
`;
