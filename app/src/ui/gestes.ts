import { useCallback, useRef, useState } from "react";
import { nouvelleCle } from "../noyau/argent";

/**
 * Un geste d'argent part UNE fois. Le verrou est synchrone (un état React ne
 * se ferme qu'au rendu suivant : deux appuis rapprochés passeraient tous les
 * deux), et la clé d'intention vit tant que le geste n'a pas réussi : si la
 * réponse se perd en route et que la personne recommence, le moteur
 * reconnaît la clé et ne crée pas un second ordre.
 */
export function useGesteUnique<T>(prefixe = "k") {
  const verrou = useRef(false);
  const cle = useRef(nouvelleCle(prefixe));
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<unknown>(null);

  const lancer = useCallback(async (geste: (cle: string) => Promise<T>): Promise<T | undefined> => {
    if (verrou.current) return undefined;
    verrou.current = true;
    setEnCours(true);
    setErreur(null);
    try {
      const r = await geste(cle.current);
      cle.current = nouvelleCle(prefixe);
      return r;
    } catch (e) {
      setErreur(e);
      return undefined;
    } finally {
      verrou.current = false;
      setEnCours(false);
    }
  }, [prefixe]);

  return { lancer, enCours, erreur, effacerErreur: () => setErreur(null) };
}
