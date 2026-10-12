/*
 * Les Clients : chercher, voir un compte en entier, monter ou descendre un
 * palier, valider ou refuser des pièces, désactiver.
 */
import { Button, Chip, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useClient, useClients, useGuichet, useRafraichir } from "../guichet";
import { enTranches, heure, jourRelatif, numeroEnTranches, prix, quand, xaf } from "../noyau/format";
import { useSession } from "../session/session";
import { Coquille, Dialogue, Erreur, Etat, Section, Tableau, Tuile } from "../ui";

const PALIERS = ["Palier 0 · numéro vérifié", "Palier 1 · identité vérifiée", "Palier 2 · entreprise vérifiée"];

export function Clients() {
  const [params] = useSearchParams();
  const [recherche, setRecherche] = useState("");
  const { data } = useClients(recherche);
  const filtre = params.get("filtre");
  const lignes = (data ?? []).filter((c) => filtre !== "verifications" || c.verification_en_cours);
  return (
    <Coquille titre="Clients">
      <Stack direction="row" gap={2} alignItems="center">
        <TextField label="Chercher un nom, une entreprise, un numéro" value={recherche} onChange={(e) => setRecherche(e.target.value)} sx={{ width: 420 }} size="small" />
        {filtre === "verifications" && <Chip label="Vérifications à faire" color="primary" component={Link} to="/clients" clickable onDelete={() => undefined} />}
        <Typography variant="body2">{lignes.length} compte{lignes.length > 1 ? "s" : ""}</Typography>
      </Stack>
      <Tableau
        colonnes={["Client", "Téléphone", "Palier", "Vérification", { label: "XAFe", align: "right" }, { label: "USDT", align: "right" }, "Depuis", "État"]}
        lignes={lignes.map((c) => [
          <Link key="n" to={`/clients/${c.id}`} style={{ color: "inherit", fontWeight: 600 }}>{c.nom ?? "—"}{c.entreprise && c.entreprise !== c.nom ? <Typography variant="caption" display="block">{c.entreprise}</Typography> : null}</Link>,
          numeroEnTranches(c.telephone),
          String(c.palier),
          c.verification_en_cours ? <Chip key="v" size="small" label={c.verification_en_cours === "identite" ? "identité à vérifier" : "entreprise à vérifier"} sx={{ height: 24, bgcolor: "#DBEAFF", color: "#0B3B78" }} /> : "",
          xaf(c.xafe),
          enTranches(c.usdt, 2),
          jourRelatif(c.cree_le),
          <Etat key="e" valeur={c.desactive_le ? "inactif" : "actif"} />,
        ])}
        vide="Aucun compte ne correspond."
      />
    </Coquille>
  );
}

export function ClientDetail() {
  const { id } = useParams();
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const { peut } = useSession();
  const { data } = useClient(id);
  const [dialogue, setDialogue] = useState<"palier" | "verification" | "desactiver" | null>(null);
  const [palier, setPalier] = useState(0);
  const [note, setNote] = useState("");
  const [erreur, setErreur] = useState<unknown>(null);
  const [enCours, setEnCours] = useState(false);

  if (!data) return <Coquille titre="Client"><Typography variant="body2">Chargement…</Typography></Coquille>;
  const c = data.compte;
  const agir = async (f: () => Promise<unknown>) => {
    setEnCours(true); setErreur(null);
    try { await f(); setDialogue(null); setNote(""); await rafraichir(); } catch (e) { setErreur(e); } finally { setEnCours(false); }
  };

  return (
    <Coquille titre={c.nom ?? numeroEnTranches(c.telephone)} actions={
      <Stack direction="row" gap={1}>
        {peut("paliers") && c.verification_en_cours && <Button variant="contained" onClick={() => setDialogue("verification")}>Examiner les pièces</Button>}
        {peut("paliers") && <Button variant="outlined" onClick={() => { setPalier(c.palier); setDialogue("palier"); }}>Changer le palier</Button>}
        {peut("clients") && <Button variant="text" color="error" onClick={() => setDialogue("desactiver")}>{c.desactive_le ? "Réactiver" : "Désactiver"}</Button>}
      </Stack>
    }>
      <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      <Stack direction="row" gap={2} flexWrap="wrap">
        <Tuile label="XAFe" valeur={xaf(data.soldes.XAFe?.disponible ?? 0)} tone="green" aide={`${xaf(data.soldes.XAFe?.bloque ?? 0)} bloqués`} />
        <Tuile label="USDT" valeur={enTranches(data.soldes.USDT?.disponible ?? 0, 2)} tone="blue" aide={`${enTranches(data.soldes.USDT?.bloque ?? 0, 2)} bloqués`} />
        <Tuile label="Palier" valeur={String(c.palier)} tone="amber" aide={PALIERS[c.palier]} />
        <Tuile label="Compte" valeur={c.desactive_le ? "désactivé" : "actif"} tone={c.desactive_le ? "red" : "neutral"} aide={`depuis ${jourRelatif(c.cree_le)} · ${c.entreprise ?? "particulier"}${c.a_code ? "" : " · sans code secret"}`} />
      </Stack>
      {c.verification_en_cours && (
        <Paper sx={{ p: 2.5, borderRadius: 5, bgcolor: "#DBEAFF", color: "#0B3B78" }}>
          <Typography fontWeight={600}>{c.verification_en_cours === "identite" ? "Identité" : "Entreprise"} à vérifier</Typography>
          <Typography variant="body2" sx={{ color: "inherit" }}>Pièces déposées : {(c.verification_pieces ?? []).join(" · ") || "—"}</Typography>
        </Paper>
      )}
      <Section titre="Numéros MoMo">
        <Tableau colonnes={["Numéro", "Opérateur", "Vérifié", "Actif", "Retiré"]} lignes={data.numeros.map((n) => [numeroEnTranches(n.numero), n.operateur.toUpperCase(), n.verifie_le ? quand(n.verifie_le) : "non", new Date(n.actif_des).getTime() <= Date.now() ? "oui" : `le ${jourRelatif(n.actif_des)} ${heure(n.actif_des)}`, n.retire_le ? quand(n.retire_le) : "—"])} />
      </Section>
      <Stack direction="row" gap={3} alignItems="flex-start" flexWrap="wrap">
        <Stack sx={{ flex: 1, minWidth: 420 }} gap={3}>
          <Section titre="Dépôts">
            <Tableau colonnes={["Dossier", "Opérateur", { label: "Crédité", align: "right" }, "État", "Quand"]} lignes={data.depots.map((d) => [d.reference, d.operateur.toUpperCase(), d.montant_recu > 0 ? xaf(d.montant_recu) : "—", <Etat key="e" valeur={d.etat} />, `${jourRelatif(d.cree_le)} ${heure(d.cree_le)}`])} vide="Aucun dépôt." />
          </Section>
          <Section titre="Sorties">
            <Tableau colonnes={["Référence", "Vers", { label: "XAFe", align: "right" }, { label: "Envoyé", align: "right" }, "État", "Quand"]} lignes={data.sorties.map((s) => [s.reference, `${s.operateur.toUpperCase()} ${numeroEnTranches(s.numero)}`, xaf(s.montant), xaf(s.montant_envoye), <Etat key="e" valeur={s.etat} />, `${jourRelatif(s.cree_le)} ${heure(s.cree_le)}`])} vide="Aucune sortie." />
          </Section>
        </Stack>
        <Stack sx={{ flex: 1, minWidth: 420 }} gap={3}>
          <Section titre="Ordres">
            <Tableau colonnes={["Référence", "Côté", "Type", { label: "Prix", align: "right" }, { label: "Quantité", align: "right" }, { label: "Exécuté", align: "right" }, "État"]} lignes={data.ordres.map((o) => [o.numero, o.cote, o.type, o.prix != null ? prix(o.prix) : "marché", enTranches(o.quantite, 2), enTranches(o.executee, 2), <Etat key="e" valeur={o.etat} />])} vide="Aucun ordre." />
          </Section>
          <Section titre="Grand livre (50 dernières écritures)">
            <Tableau colonnes={["Quand", "Actif", { label: "Disponible", align: "right" }, { label: "Bloqué", align: "right" }, "Nature", "Source"]} lignes={data.ecritures.map((e) => [`${jourRelatif(e.quand)} ${heure(e.quand)}`, e.actif, enTranches(e.disponible, e.actif === "USDT" ? 2 : 0), enTranches(e.bloque, e.actif === "USDT" ? 2 : 0), e.nature, e.source])} vide="Aucune écriture." />
          </Section>
        </Stack>
      </Stack>

      <Dialogue ouvert={dialogue === "palier"} titre="Changer le palier" onFermer={() => setDialogue(null)} onValider={() => void agir(() => guichet.changerPalier(c.id, palier, note))} libelle="Changer" enCours={enCours}>
        <TextField select label="Palier" value={palier} onChange={(e) => setPalier(Number(e.target.value))} fullWidth>
          {PALIERS.map((p, i) => <MenuItem key={i} value={i}>{p}</MenuItem>)}
        </TextField>
        <TextField label="Pourquoi" value={note} onChange={(e) => setNote(e.target.value)} fullWidth />
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>
      <Dialogue ouvert={dialogue === "verification"} titre={`Pièces : ${c.verification_en_cours === "identite" ? "identité" : "entreprise"}`} onFermer={() => setDialogue(null)} onValider={() => void agir(() => guichet.validerVerification(c.id, true, note))} libelle={`Valider → palier ${c.verification_en_cours === "identite" ? Math.max(c.palier, 1) : 2}`} enCours={enCours}>
        <Typography variant="body2">Pièces : {(c.verification_pieces ?? []).join(" · ") || "—"}. Ouvrez-les dans le stockage « verifications ».</Typography>
        <TextField label="Note" value={note} onChange={(e) => setNote(e.target.value)} fullWidth />
        <Button variant="outlined" color="error" onClick={() => void agir(() => guichet.validerVerification(c.id, false, note || "Pièces illisibles ou incomplètes."))}>Refuser les pièces</Button>
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>
      <Dialogue ouvert={dialogue === "desactiver"} titre={c.desactive_le ? "Réactiver ce compte" : "Désactiver ce compte"} onFermer={() => setDialogue(null)} onValider={() => void agir(() => guichet.desactiverCompte(c.id, Boolean(c.desactive_le), note))} libelle={c.desactive_le ? "Réactiver" : "Désactiver"} couleur={c.desactive_le ? "primary" : "error"} enCours={enCours} desactive={!c.desactive_le && note.trim().length < 3}>
        <Typography variant="body2">{c.desactive_le ? "Le client pourra de nouveau se connecter et bouger son argent." : "Le client ne pourra plus rien faire ; ses soldes restent. À réserver aux cas de fraude ou de demande du client."}</Typography>
        <TextField label="Pourquoi" value={note} onChange={(e) => setNote(e.target.value)} fullWidth autoFocus />
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>
    </Coquille>
  );
}
