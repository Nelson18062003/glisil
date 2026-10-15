/* Le Journal : ce que l'administration a fait — qui, quoi, sur quoi, quand. */
import { Typography } from "@mui/material";
import { useJournal } from "../guichet";
import { heureSecondes, jourRelatif } from "../noyau/format";
import { Coquille, Tableau } from "../ui";

const ACTIONS: Record<string, string> = {
  rapprocher_retenue: "a rapproché un SMS retenu", rembourser_retenue: "a remboursé un SMS retenu", liberer_commande: "a libéré un transfert", creer_terminal: "a créé un terminal",
  renouveler_cle: "a renouvelé la clé d'un terminal", creer_float: "a ajouté un float", activer_float: "a activé un float", desactiver_float: "a mis un float en pause",
  changer_palier: "a changé un palier", valider_verification: "a validé des pièces", refuser_verification: "a refusé des pièces", desactiver_compte: "a désactivé un compte", reactiver_compte: "a réactivé un compte",
  modifier_parametre: "a modifié un paramètre", creer_administrateur: "a créé un administrateur", desactiver_administrateur: "a désactivé un administrateur", activer_administrateur: "a réactivé un administrateur",
};

export function Journal() {
  const { data } = useJournal();
  return (
    <Coquille titre="Journal de l'administration">
      <Typography variant="body2">Chaque action d'un administrateur, en ajout seul. Il se garde longtemps et se lit à plusieurs : aucun numéro ni nom de client n'y est écrit par le moteur, seulement des références. Vos notes y sont gardées telles quelles : n'y écrivez ni numéro ni nom.</Typography>
      <Tableau
        colonnes={["Quand", "Qui", "Action", "Sur", "Détail"]}
        lignes={(data ?? []).map((l) => [`${jourRelatif(l.quand)} ${heureSecondes(l.quand)}`, l.admin ?? "—", ACTIONS[l.action] ?? l.action, l.cible ?? "—", <Typography key="d" variant="caption" fontFamily="Roboto Mono, monospace">{l.detail ? JSON.stringify(l.detail) : ""}</Typography>])}
        vide="Rien encore."
      />
    </Coquille>
  );
}
