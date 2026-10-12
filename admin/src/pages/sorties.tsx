/*
 * Les Sorties : ce que TOTEM compose, transfert par transfert. Une commande
 * réclamée par un boîtier qui s'est tu se libère ; jamais une commande faite.
 */
import { Button, Chip, Collapse, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useGuichet, useRafraichir, useSorties } from "../guichet";
import { heure, jourRelatif, numeroEnTranches, xaf } from "../noyau/format";
import { useSession } from "../session/session";
import { Coquille, Erreur, Etat, Tableau } from "../ui";

export function Sorties() {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const { peut } = useSession();
  const [etat, setEtat] = useState<string | null>(null);
  const { data } = useSorties(etat);
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);

  const liberer = async (id: number) => {
    try { await guichet.libererCommande(id); await rafraichir(); } catch (e) { setErreur(e); }
  };

  return (
    <Coquille titre="Sorties de XAF">
      <Stack direction="row" gap={1}>
        {[["Toutes", null], ["En attente", "en_attente"], ["En cours", "en_cours"], ["Envoyées", "envoyee"], ["Partielles", "partielle"], ["Échouées", "echouee"]].map(([l, v]) => (
          <Chip key={String(v)} label={l as string} onClick={() => setEtat(v as string | null)} color={etat === v ? "primary" : undefined} variant={etat === v ? "filled" : "outlined"} />
        ))}
      </Stack>
      <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      <Tableau
        colonnes={["Référence", "Client", "Vers", { label: "XAFe", align: "right" }, { label: "Envoyé", align: "right" }, { label: "Revenu", align: "right" }, "Transferts", "État", "Demandée"]}
        lignes={(data ?? []).map((s) => [
          <Button key="r" variant="text" size="small" onClick={() => setOuverte(ouverte === s.reference ? null : s.reference)} sx={{ fontFamily: "Roboto Mono, monospace", minHeight: 28, px: 0.5 }}>{s.reference}</Button>,
          <Link to={`/clients/${s.compte.id}`} key="c" style={{ color: "inherit" }}>{s.compte.nom ?? numeroEnTranches(s.compte.telephone)}</Link>,
          `${s.operateur.toUpperCase()} ${numeroEnTranches(s.numero)}`,
          xaf(s.montant),
          `${xaf(s.montant_envoye)} XAF`,
          s.montant_rendu > 0 ? `${xaf(s.montant_rendu)} XAFe` : "—",
          <Stack key="t" gap={0.5}>
            <Stack direction="row" gap={0.5}>{s.transferts.map((t) => <Etat key={t.id} valeur={t.etat} />)}</Stack>
            <Collapse in={ouverte === s.reference}>
              <Stack gap={0.5} sx={{ mt: 1 }}>
                {s.transferts.map((t) => (
                  <Stack key={t.id} direction="row" gap={1.5} alignItems="center">
                    <Typography variant="caption" sx={{ minWidth: 70 }}>#{t.id} · {t.terminal}</Typography>
                    <Typography variant="caption">{xaf(t.montant_envoye)} XAF</Typography>
                    <Typography variant="caption">{t.reprises > 0 ? `${t.reprises} reprise${t.reprises > 1 ? "s" : ""}` : ""}</Typography>
                    <Typography variant="caption" fontFamily="Roboto Mono, monospace">{t.reference_operateur ?? t.resultat ?? ""}</Typography>
                    {t.etat === "en_cours" && peut("sorties") && <Button size="small" variant="outlined" onClick={() => void liberer(t.id)} sx={{ minHeight: 26, fontSize: 12 }}>Libérer</Button>}
                  </Stack>
                ))}
              </Stack>
            </Collapse>
          </Stack>,
          <Etat valeur={s.etat} key="e" />,
          `${jourRelatif(s.cree_le)} ${heure(s.cree_le)}`,
        ])}
        vide="Aucune sortie."
      />
      <Typography variant="body2">Un transfert « en cours » depuis plus de cinq minutes vient d'un boîtier qui s'est tu : le libérer le remet en attente pour le prochain tour. Un transfert fait ne se touche pas : l'argent est parti.</Typography>
    </Coquille>
  );
}
