// ============================================================
// Les réglages de la coque. Tout vient de app.json → extra : changer
// d'environnement, c'est changer app.json. Aucun secret ici : la coque ne
// parle pas au moteur, c'est l'application (dans la WebView) qui le fait,
// avec sa propre session.
// ============================================================
import Constants from 'expo-constants';

type Extra = { baseUrl?: string; startPath?: string };
const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

export const BASE_URL = (extra.baseUrl ?? 'https://app.xafe.exchange').replace(/\/+$/, '');
export const START_URL = BASE_URL + (extra.startPath ?? '/');
export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
/** Ajouté à l'agent utilisateur : l'application sait qu'elle est dans la coque. */
export const USER_AGENT_SUFFIX = `XAFeExchange/${APP_VERSION}`;

/** Les pages qui s'ouvrent DANS la coque ; tout le reste part vers le téléphone (tel:, wa.me, navigateur). */
export function estUrlDeLApp(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.origin === new URL(BASE_URL).origin;
  } catch {
    return false;
  }
}

/** Le verrou biométrique : au lancement, puis après cette absence. L'application a en plus son code secret pour l'argent. */
export const REVERROUILLER_APRES_MS = 2 * 60 * 1000;
