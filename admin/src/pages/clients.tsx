/*
 * Les Clients : combien ils sont et combien vivent vraiment, qui vient
 * d'arriver, d'où ils sont ; chercher, filtrer, voir un compte en entier
 * (identité, connexions, tout l'historique), monter ou descendre un palier,
 * valider ou refuser des pièces, désactiver.
 */
import { Box, Button, Chip, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useClient, useClients, useGuichet, useRafraichir, useStatistiquesClients } from "../guichet";
import { enTranches, heure, jourRelatif, numeroEnTranches, prix, quand, xaf } from "../noyau/format";
import { useSession } from "../session/session";
import { Coquille, Dialogue, Erreur, Etat, Section, Tableau, Tuile } from "../ui";

const PALIERS = ["Palier 0 · e-mail vérifié", "Palier 1 · identité vérifiée", "Palier 2 · entreprise vérifiée"];

const FILTRES: { cle: string | null; label: string }[] = [
  { cle: null, label: "Tous" },
  { cle: "actifs", label: "Actifs (30 j)" },
  { cle: "inactifs", label: "Inactifs" },
  { cle: "nouveaux", label: "Nouveaux (7 j)" },
  { cle: "verifications", label: "Pièces à vérifier" },
  { cle: "desactives", label: "Désactivés" },
];

const nomsPays = typeof Intl !== "undefined" && "DisplayNames" in Intl ? new Intl.DisplayNames(["fr"], { type: "region" }) : null;
const drapeau = (code: string) => (/^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "");
export const nomDuPays = (code: string | null | undefined) => (code ? (nomsPays?.of(code) ?? code) : "—");

/** « +237677123456 » → « +237 6 77 12 34 56 » ; un ancien numéro local en tranches ; un autre pays tel quel. */
export function telephoneAffiche(t: string | null | undefined): string {
  if (!t) return "—";
  if (t.startsWith("+237")) return `+237 ${numeroEnTranches(t.slice(4))}`;
  if (t.startsWith("+")) return t;
  return numeroEnTranches(t);
}

function age(naissance: string): number {
  const [a, m, j] = naissance.split("-").map(Number);
  const d = new Date();
  return d.getFullYear() - a - (d.getMonth() + 1 < m || (d.getMonth() + 1 === m && d.getDate() < j) ? 1 : 0);
}

/** Les inscriptions des 30 derniers jours, un bâton par jour. */
function Inscriptions({ jours }: { jours: { jour: string; n: number }[] }) {
  const max = Math.max(1, ...jours.map((j) => j.n));
  return (
    <Stack direction="row" alignItems="flex-end" gap="3px" sx={{ height: 72 }} role="img" aria-label="Inscriptions par jour sur 30 jours">
      {jours.map((j) => (
        <Tooltip key={j.jour} title={`${new Date(j.jour).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} · ${j.n} inscription${j.n > 1 ? "s" : ""}`}>
          <Box sx={{ flex: 1, height: `${Math.max(4, (j.n / max) * 100)}%`, borderRadius: "3px 3px 0 0", bgcolor: j.n ? "primary.main" : "divider" }} />
        </Tooltip>
      ))}
    </Stack>
  );
}

function Fiche({ items }: { items: [string, ReactNode][] }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 2 }}>
      {items.map(([l, v]) => (
        <Box key={l} sx={{ minWidth: 0 }}>
          <Typography variant="caption" component="div">{l}</Typography>
          <Typography variant="body1" sx={{ overflowWrap: "anywhere", fontWeight: 500 }}>{v}</Typography>
        </Box>
      ))}
    </Box>
  );
}

export function Clients() {
  const [params, setParams] = useSearchParams();
  const [recherche, setRecherche] = useState("");
  const filtre = params.get("filtre");
  const { data } = useClients(recherche, filtre);
  const { data: s } = useStatistiquesClients();
  const lignes = data ?? [];
  const pourcent = (n: number) => (s && s.total ? ` · ${Math.round((n / s.total) * 100)} %` : "");
  const pays = s ? Object.entries(s.par_pays).sort((a, b) => b[1] - a[1]).slice(0, 6) : [];
  return (
    <Coquille titre="Clients">
      <Stack direction="row" gap={2} flexWrap="wrap">
        <Tuile label="Clients" valeur={s ? enTranches(s.total) : "…"} tone="green" aide={s ? `+${s.nouveaux_7j} cette semaine · +${s.nouveaux_30j} en 30 jours` : undefined} />
        <Tuile label="Actifs (30 jours)" valeur={s ? enTranches(s.actifs_30j) : "…"} tone="blue" aide={s ? `ont bougé de l'argent${pourcent(s.actifs_30j)}` : undefined} />
        <Tuile label="Connectés (7 jours)" valeur={s ? enTranches(s.connectes_7j) : "…"} tone="neutral" aide={s ? `sont venus sur l'application${pourcent(s.connectes_7j)}` : undefined} />
        <Tuile label="Inscriptions inachevées" valeur={s ? enTranches(s.inscriptions_inachevees) : "…"} tone="amber" aide="adresse e-mail prouvée, profil pas fini" />
        <Tuile label="Vérifiés" valeur={s ? enTranches(s.verifies) : "…"} tone="neutral" aide={s ? `${s.en_verification} dossier${s.en_verification > 1 ? "s" : ""} de pièces en attente · ${s.desactives} désactivé${s.desactives > 1 ? "s" : ""}` : undefined} />
      </Stack>
      {s && (
        <Stack direction="row" gap={2} flexWrap="wrap">
          <Paper sx={{ p: 2.5, borderRadius: 5, flex: 2, minWidth: 320 }}>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 1.5 }}>
              <Typography fontWeight={600}>Inscriptions sur 30 jours</Typography>
              <Typography variant="body2">{s.nouveaux_30j} au total</Typography>
            </Stack>
            <Inscriptions jours={s.inscriptions_30j} />
          </Paper>
          <Paper sx={{ p: 2.5, borderRadius: 5, flex: 1, minWidth: 260 }}>
            <Typography fontWeight={600} sx={{ mb: 1.5 }}>Par pays de résidence</Typography>
            <Stack gap={1}>
              {pays.map(([code, n]) => (
                <Stack key={code} direction="row" alignItems="center" gap={1}>
                  <span aria-hidden>{drapeau(code)}</span>
                  <Typography variant="body2" sx={{ flex: 1, color: "text.primary" }}>{code === "?" ? "Non renseigné" : nomDuPays(code)}</Typography>
                  <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "text.primary" }}>{n}</Typography>
                </Stack>
              ))}
            </Stack>
          </Paper>
        </Stack>
      )}
      <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
        {FILTRES.map((f) => (
          <Chip key={f.label} label={f.label} clickable color={filtre === f.cle ? "primary" : "default"} variant={filtre === f.cle ? "filled" : "outlined"}
            onClick={() => setParams(f.cle ? { filtre: f.cle } : {})} />
        ))}
      </Stack>
      <Stack direction="row" gap={2} alignItems="center" flexWrap="wrap">
        <TextField label="Chercher un nom, un e-mail, un numéro, une ville" value={recherche} onChange={(e) => setRecherche(e.target.value)} sx={{ width: 460, maxWidth: "100%" }} size="small" />
        <Typography variant="body2">{lignes.length} compte{lignes.length > 1 ? "s" : ""}</Typography>
      </Stack>
      <Tableau
        colonnes={["Client", "Téléphone", "Résidence", "Palier", { label: "XAFe", align: "right" }, { label: "USDT", align: "right" }, "Dernière opération", "Dernière connexion", "Inscrit", "État"]}
        lignes={lignes.map((c) => [
          <Link key="n" to={`/clients/${c.id}`} style={{ color: "inherit" }}>
            <Typography component="span" fontWeight={600} sx={{ display: "block" }}>{c.nom ?? "—"}</Typography>
            <Typography variant="caption" sx={{ display: "block" }}>{c.entreprise && c.entreprise !== c.nom ? c.entreprise : c.email ?? ""}</Typography>
          </Link>,
          telephoneAffiche(c.telephone),
          c.ville ? `${c.ville}${c.pays && c.pays !== "CM" ? `, ${nomDuPays(c.pays)}` : ""}` : "—",
          c.verification_en_cours ? <Chip key="v" size="small" label={`${c.palier} · ${c.verification_en_cours === "identite" ? "identité à vérifier" : "entreprise à vérifier"}`} sx={{ height: 24, bgcolor: "#DBEAFF", color: "#0B3B78" }} /> : String(c.palier),
          xaf(c.xafe),
          enTranches(c.usdt, 2),
          c.derniere_operation ? jourRelatif(c.derniere_operation) : "jamais",
          c.derniere_connexion ? `${jourRelatif(c.derniere_connexion)} ${heure(c.derniere_connexion)}` : "—",
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
    <Coquille titre={c.nom ?? telephoneAffiche(c.telephone)} actions={
      <Stack direction="row" gap={1}>
        {peut("paliers") && c.verification_en_cours && <Button variant="contained" onClick={() => setDialogue("verification")}>Examiner les pièces</Button>}
        {peut("paliers") && <Button variant="outlined" onClick={() => { setPalier(c.palier); setDialogue("palier"); }}>Changer le palier</Button>}
        {peut("clients") && <Button variant="text" color="error" onClick={() => setDialogue("desactiver")}>{c.ferme_le ? "Rouvrir" : c.desactive_le ? "Réactiver" : "Désactiver"}</Button>}
      </Stack>
    }>
      <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      <Stack direction="row" gap={2} flexWrap="wrap">
        <Tuile label="XAFe" valeur={xaf(data.soldes.XAFe?.disponible ?? 0)} tone="green" aide={`${xaf(data.soldes.XAFe?.bloque ?? 0)} bloqués`} />
        <Tuile label="USDT" valeur={enTranches(data.soldes.USDT?.disponible ?? 0, 2)} tone="blue" aide={`${enTranches(data.soldes.USDT?.bloque ?? 0, 2)} bloqués`} />
        <Tuile label="Palier" valeur={String(c.palier)} tone="amber" aide={PALIERS[c.palier]} />
        <Tuile label="Compte" valeur={c.ferme_le ? "fermé" : c.desactive_le ? "désactivé" : "actif"} tone={c.desactive_le ? "red" : "neutral"}
          aide={c.ferme_le ? `fermé par le client ${jourRelatif(c.ferme_le).toLowerCase()}` : `depuis ${jourRelatif(c.cree_le)} · ${c.entreprise ?? "particulier"}${c.a_code ? "" : " · sans code secret"}`} />
      </Stack>
      <Section titre="Identité et connexions">
        <Paper sx={{ p: 2.5, borderRadius: 5 }}>
          <Fiche items={[
            ["Prénom", c.prenom ?? "—"],
            ["Nom de famille", c.nom_de_famille ?? "—"],
            ["E-mail", c.email ?? "—"],
            ["Téléphone", telephoneAffiche(c.telephone)],
            ["Date de naissance", c.date_naissance ? `${new Date(c.date_naissance).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} · ${age(c.date_naissance)} ans` : "—"],
            ["Résidence", c.ville ? `${c.ville}, ${nomDuPays(c.pays)}` : "—"],
            ["Inscrit", `${quand(c.cree_le)}`],
            ["Dernière connexion", c.derniere_connexion ? quand(c.derniere_connexion) : "—"],
            ["Dernière opération", c.derniere_operation ? quand(c.derniere_operation) : "jamais"],
            ["Code secret", c.a_code ? "choisi" : "pas encore choisi"],
            ["Conditions", c.conditions_version ? `version du ${c.conditions_version}, acceptée ${c.conditions_acceptees_le ? quand(c.conditions_acceptees_le) : ""}${c.conditions_a_jour === false ? " · à réaccepter" : ""}` : "jamais acceptées (compte d'avant les conditions)"],
            ...(c.ferme_le ? [["Fermé", quand(c.ferme_le)] as [string, string]] : []),
          ]} />
        </Paper>
      </Section>
      {data.totaux && (
        <Stack direction="row" gap={2} flexWrap="wrap">
          <Tuile label="Entré par MoMo" valeur={xaf(data.totaux.entre_xaf)} unite="XAF" tone="neutral" aide="depuis l'ouverture du compte" />
          <Tuile label="Sorti vers MoMo" valeur={xaf(data.totaux.sorti_xaf)} unite="XAF" tone="neutral" aide="envoyé aux numéros du client" />
          <Tuile label="Ordres" valeur={enTranches(data.totaux.ordres)} tone="neutral" aide="placés sur le marché" />
          <Tuile label="Retraits crypto" valeur={enTranches(data.totaux.retraits_crypto)} tone="neutral" aide="vers un wallet externe" />
        </Stack>
      )}
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
          {(data.retraits_crypto?.length || data.transferts_crypto?.length) ? (
            <Section titre="Crypto">
              <Tableau colonnes={["Quand", "Sens", "Actif · réseau", { label: "Montant", align: "right" }, "Adresse", "État"]}
                lignes={[
                  ...(data.transferts_crypto ?? []).map((x) => [`${jourRelatif(x.cree_le)} ${heure(x.cree_le)}`, x.sens === "entree" ? "dépôt" : "sortie", `${x.actif} · ${x.reseau.toUpperCase()}`, enTranches(x.montant, 2), x.adresse ? `${x.adresse.slice(0, 8)}…${x.adresse.slice(-6)}` : "—", <Etat key="e" valeur="confirme" />]),
                  ...(data.retraits_crypto ?? []).map((x) => [`${jourRelatif(x.cree_le)} ${heure(x.cree_le)}`, "retrait", `${x.actif} · ${x.reseau.toUpperCase()}`, enTranches(x.montant, 2), `${x.adresse.slice(0, 8)}…${x.adresse.slice(-6)}`, <Etat key="e" valeur={x.etat} />]),
                ]} />
            </Section>
          ) : null}
          <Section titre="Grand livre (100 dernières écritures)">
            <Tableau colonnes={["Quand", "Actif", { label: "Disponible", align: "right" }, { label: "Bloqué", align: "right" }, "Nature", "Source"]} lignes={data.ecritures.map((e) => [`${jourRelatif(e.quand)} ${heure(e.quand)}`, e.actif, enTranches(e.disponible, e.actif === "USDT" ? 2 : 0), enTranches(e.bloque, e.actif === "USDT" ? 2 : 0), e.nature, e.source])} vide="Aucune écriture." />
          </Section>
        </Stack>
      </Stack>

      <Dialogue ouvert={dialogue === "palier"} titre="Changer le palier" onFermer={() => setDialogue(null)} onValider={() => void agir(() => guichet.changerPalier(c.id, palier, note))} libelle="Changer" enCours={enCours}>
        <TextField select label="Palier" value={palier} onChange={(e) => setPalier(Number(e.target.value))} fullWidth>
          {PALIERS.map((p, i) => <MenuItem key={i} value={i}>{p}</MenuItem>)}
        </TextField>
        <TextField label="Pourquoi" value={note} onChange={(e) => setNote(e.target.value)} fullWidth />
        {c.verification_en_cours && (
          <Typography variant="body2" color="warning.main">
            Des pièces ({c.verification_en_cours === "identite" ? "identité" : "entreprise"}) attendent l'équipe. Elles restent en attente tant que le palier posé ne les satisfait pas ({c.verification_en_cours === "identite" ? "palier 1" : "palier 2"}) : pour les examiner, passez plutôt par « Pièces ».
          </Typography>
        )}
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>
      <Dialogue ouvert={dialogue === "verification"} titre={`Pièces : ${c.verification_en_cours === "identite" ? "identité" : "entreprise"}`} onFermer={() => setDialogue(null)} onValider={() => void agir(() => guichet.validerVerification(c.id, true, note))} libelle={`Valider → palier ${c.verification_en_cours === "identite" ? Math.max(c.palier, 1) : 2}`} enCours={enCours}>
        <Typography variant="body2">Pièces : {(c.verification_pieces ?? []).join(" · ") || "—"}. Ouvrez-les dans le stockage « verifications ».</Typography>
        <TextField label="Note" value={note} onChange={(e) => setNote(e.target.value)} fullWidth />
        <Button variant="outlined" color="error" onClick={() => void agir(() => guichet.validerVerification(c.id, false, note || "Pièces illisibles ou incomplètes."))}>Refuser les pièces</Button>
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>
      <Dialogue ouvert={dialogue === "desactiver"} titre={c.ferme_le ? "Rouvrir ce compte fermé par le client" : c.desactive_le ? "Réactiver ce compte" : "Désactiver ce compte"} onFermer={() => setDialogue(null)} onValider={() => void agir(() => guichet.desactiverCompte(c.id, Boolean(c.desactive_le), note))} libelle={c.desactive_le ? "Réactiver" : "Désactiver"} couleur={c.desactive_le ? "primary" : "error"} enCours={enCours} desactive={!c.desactive_le && note.trim().length < 3}>
        <Typography variant="body2">{c.desactive_le ? "Le client pourra de nouveau se connecter et bouger son argent." : "Le client ne pourra plus rien faire ; ses soldes restent. À réserver aux cas de fraude ou de demande du client."}</Typography>
        <TextField label="Pourquoi" value={note} onChange={(e) => setNote(e.target.value)} fullWidth autoFocus />
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>
    </Coquille>
  );
}
