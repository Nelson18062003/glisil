// ============================================================
// Les mises à jour « over the air » (EAS Update) de la coque — sans repasser
// par le magasin. L'application, elle, se met à jour toute seule : c'est un
// site. Inactif tant que `eas update:configure` n'a pas posé updates.url.
// ============================================================
import * as Updates from 'expo-updates';

export const misesAJourActives = Updates.isEnabled && !__DEV__;
const VERIFIER_TOUTES_LES_MS = 30 * 60 * 1000;

let prete = false;
let derniereVerification = 0;

/** Cherche et télécharge une mise à jour (sans l'appliquer). Vrai si une mise à jour est prête. */
export async function chercherMiseAJour(forcer = false): Promise<boolean> {
  if (!misesAJourActives || prete) return prete;
  if (!forcer && Date.now() - derniereVerification < VERIFIER_TOUTES_LES_MS) return false;
  derniereVerification = Date.now();
  try {
    const v = await Updates.checkForUpdateAsync();
    if (!v.isAvailable) return false;
    const r = await Updates.fetchUpdateAsync();
    if (r.isNew) prete = true;
  } catch {
    // hors ligne ou service indisponible : on réessaiera
  }
  return prete;
}

/** Redémarre sur la nouvelle version ; la session est gardée par l'application. */
export function appliquerMiseAJour(): void {
  if (!prete) return;
  Updates.reloadAsync().catch(() => {});
}
