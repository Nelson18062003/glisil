/*
 * Les Sorties : en haut, les remboursements à payer à la main (0014) ; puis
 * la liste de toutes les sorties. Une sortie TOTEM se suit transfert par transfert. Une commande
 * réclamée par un boîtier qui s'est tu se libère ; une commande en attente
 * d'un boîtier muet se réaffecte, ou la sortie s'annule (ses XAFe reviennent) ;
 * jamais une commande faite, ni une commande en train d'être composée.
 */
import { Button, Chip, Collapse, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useGuichet, useRafraichir, useSorties, useTerminaux } from "../guichet";
import { heure, jourRelatif, numeroEnTranches, xaf } from "../noyau/format";
import { useSession } from "../session/session";
import { Coquille, Dialogue, Erreur, Etat, Tableau } from "../ui";
import { APayer, PuceDit } from "./sorties-manuelles";

export function Sorties() {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const { peut } = useSession();
  const [etat, setEtat] = useState<string | null>(null);
  const { data } = useSorties(etat);
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  const { data: terminaux } = useTerminaux();
  const [aReaffecter, setAReaffecter] = useState<{ id: number; operateur: string; de: string } | null>(null);
  const [vers, setVers] = useState("");
  const [aAnnuler, setAAnnuler] = useState<{ reference: string; montant: number } | null>(null);
  const [note, setNote] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [fait, setFait] = useState<string | null>(null);

  const liberer = async (id: number) => {
    try { await guichet.libererCommande(id); await rafraichir(); } catch (e) { setErreur(e); }
  };
  const agir = async (geste: () => Promise<string>) => {
    setEnCours(true); setErreur(null);
    try { setFait(await geste()); setAReaffecter(null); setAAnnuler(null); setNote(""); setVers(""); await rafraichir(); } catch (e) { setErreur(e); } finally { setEnCours(false); }
  };
  /* les boîtiers qui portent une carte de cet opérateur, le plus récemment entendu d'abord */
  const candidats = aReaffecter
    ? (terminaux ?? []).filter((t) => t.id !== aReaffecter.de && (t.floats ?? []).some((f) => f.actif && f.operateur === aReaffecter.operateur))
    : [];

  return (
    <Coquille titre="Sorties de XAF">
      <Stack direction="row" gap={1} flexWrap="wrap">
        {[["Toutes", null], ["En attente", "en_attente"], ["En cours", "en_cours"], ["En preuve", "en_preuve"], ["Envoyées", "envoyee"], ["Partielles", "partielle"], ["Échouées", "echouee"], ["Annulées", "annulee"]].map(([l, v]) => (
          <Chip key={String(v)} label={l as string} onClick={() => setEtat(v as string | null)} color={etat === v ? "primary" : undefined} variant={etat === v ? "filled" : "outlined"} />
        ))}
      </Stack>
      <APayer />
      <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      {fait && <Typography variant="body2" sx={{ bgcolor: "#CDEFD9", color: "#06331B", px: 2, py: 1, borderRadius: 3 }} onClick={() => setFait(null)}>{fait}</Typography>}
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
            {s.mode === "manuel" ? (
              <Stack gap={0.5}>
                <Typography variant="caption">à la main{s.payee_par ? ` · payée par ${s.payee_par}` : ""}{s.confirmee_par ? ` · confirmée par ${s.confirmee_par}` : ""}</Typography>
                {(s.paiements?.length ? s.paiements.map((p) => p.transaction_id) : s.transaction_id ? [s.transaction_id] : []).map((id) => (
                  <Typography key={id} variant="caption" fontFamily="Roboto Mono, monospace">{id}</Typography>
                ))}
                {s.forcee_le && <Typography variant="caption" color="error">forcée par {s.forcee_par} : {s.forcee_note}</Typography>}
                {s.motif && <Typography variant="caption" color="error">{s.motif}</Typography>}
                <PuceDit r={s.rapprochement} />
              </Stack>
            ) : <Stack direction="row" gap={0.5}>{s.transferts.map((t) => <Etat key={t.id} valeur={t.etat} />)}</Stack>}
            <Collapse in={ouverte === s.reference}>
              <Stack gap={0.5} sx={{ mt: 1 }}>
                {s.transferts.map((t) => (
                  <Stack key={t.id} direction="row" gap={1.5} alignItems="center">
                    <Typography variant="caption" sx={{ minWidth: 70 }}>#{t.id} · {t.terminal}</Typography>
                    <Typography variant="caption">{xaf(t.montant_envoye)} XAF</Typography>
                    <Typography variant="caption">{t.reprises > 0 ? `${t.reprises} reprise${t.reprises > 1 ? "s" : ""}` : ""}</Typography>
                    <Typography variant="caption" fontFamily="Roboto Mono, monospace">{t.reference_operateur ?? t.resultat ?? ""}</Typography>
                    {t.etat === "en_cours" && peut("sorties") && <Button size="small" variant="outlined" onClick={() => void liberer(t.id)} sx={{ minHeight: 26, fontSize: 12 }}>Libérer</Button>}
                    {t.etat === "en_attente" && peut("sorties") && <Button size="small" variant="outlined" onClick={() => { setAReaffecter({ id: t.id, operateur: s.operateur, de: t.terminal }); setVers(""); }} sx={{ minHeight: 26, fontSize: 12 }}>Réaffecter</Button>}
                  </Stack>
                ))}
                {peut("sorties") && s.transferts.some((t) => t.etat === "en_attente") && !s.transferts.some((t) => t.etat === "en_cours") && (
                  <Button size="small" variant="outlined" color="error" onClick={() => setAAnnuler({ reference: s.reference, montant: s.transferts.filter((t) => t.etat === "en_attente").reduce((m, t) => m + t.montant_xafe, 0) })}
                    sx={{ minHeight: 28, fontSize: 12, alignSelf: "flex-start" }}>Annuler ce qui n'est pas parti</Button>
                )}
              </Stack>
            </Collapse>
          </Stack>,
          <Etat valeur={s.etat} key="e" />,
          `${jourRelatif(s.cree_le)} ${heure(s.cree_le)}`,
        ])}
        vide="Aucune sortie."
      />
      <Typography variant="body2">Un transfert « en cours » depuis plus de cinq minutes vient d'un boîtier qui s'est tu : le libérer le remet en attente pour le prochain tour. Un transfert « en attente » d'un boîtier muet se donne à un autre boîtier, ou s'annule : ses XAFe reviennent au client. Un transfert fait ne se touche pas : l'argent est parti.</Typography>

      <Dialogue ouvert={Boolean(aReaffecter)} titre={`Réaffecter le transfert #${aReaffecter?.id ?? ""}`} onFermer={() => setAReaffecter(null)} libelle="Réaffecter" enCours={enCours} desactive={!vers}
        onValider={() => aReaffecter && void agir(async () => { await guichet.reaffecterCommande(aReaffecter.id, vers); return `Transfert #${aReaffecter.id} donné à ${vers}.`; })}>
        <Typography variant="body2">Il attend {aReaffecter?.de}. Il partira du premier boîtier choisi ici qui le relève, depuis sa carte {aReaffecter?.operateur.toUpperCase()}.</Typography>
        {candidats.length === 0
          ? <Typography variant="body2" color="error">Aucun autre boîtier ne porte une carte de cet opérateur.</Typography>
          : <TextField select label="Vers le boîtier" value={vers} onChange={(e) => setVers(e.target.value)} fullWidth>
              {candidats.map((t) => <MenuItem key={t.id} value={t.id}>{t.nom} ({t.id}){t.muet ? " · muet" : ""}</MenuItem>)}
            </TextField>}
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>

      <Dialogue ouvert={Boolean(aAnnuler)} titre={`Annuler ${aAnnuler?.reference ?? ""}`} onFermer={() => setAAnnuler(null)} libelle="Annuler et rendre les XAFe" couleur="error" enCours={enCours} desactive={note.trim().length < 3}
        onValider={() => aAnnuler && void agir(async () => { const r = await guichet.annulerSortie(aAnnuler.reference, note); return `${aAnnuler.reference} : ${xaf(r.rendu)} XAFe revenus au client.`; })}>
        <Typography variant="body2">Les transferts qui n'ont pas encore été pris par un boîtier sont clos ; leurs {aAnnuler ? xaf(aAnnuler.montant) : ""} XAFe reviennent au client, qui est prévenu. Ce qui est déjà parti reste parti.</Typography>
        <TextField label="Pourquoi (le journal le garde)" value={note} onChange={(e) => setNote(e.target.value)} fullWidth autoFocus />
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>
    </Coquille>
  );
}
