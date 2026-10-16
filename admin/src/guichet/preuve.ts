/*
 * La capture d'un paiement : une image ou un PDF, 10 Mo au plus. Vérifiée
 * avant l'envoi (le stockage refuse aussi : type et taille y sont posés).
 */
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
export const TAILLE_MAX_PREUVE = 10 * 1024 * 1024;

/** Rend l'extension à donner au fichier ; lève une erreur lisible sinon. */
export function verifierPreuve(f: { type: string; size: number }): string {
  const ext = TYPES[f.type];
  if (!ext) throw new Error("capture refusée : une image (JPEG, PNG, WebP) ou un PDF");
  if (f.size > TAILLE_MAX_PREUVE) throw new Error("capture trop lourde : 10 Mo au plus");
  if (f.size === 0) throw new Error("capture vide");
  return ext;
}
