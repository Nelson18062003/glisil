/*
 * Les Clients : combien ils sont et combien vivent vraiment, qui vient
 * d'arriver, d'où ils sont ; chercher, filtrer, voir un compte en entier
 * (identité, connexions, tout l'historique), monter ou descendre un palier,
 * valider ou refuser des pièces, désactiver — et, tant que l'interrupteur de
 * l'approbation est allumé (0047), approuver chaque nouveau compte avant son
 * premier geste d'argent.
 */
import { Box, Button, Chip, MenuItem, Paper, Stack, Switch, TextField, Tooltip, Typography } from "@mui/material";
import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useApprobation, useClient, useClients, useGuichet, useRafraichir, useSecurite, useStatistiquesClients } from "../guichet";
import { enTranches, heure, jourRelatif, numeroEnTranches, prix, quand, xaf } from "../noyau/format";
import { EVENEMENTS } from "../noyau/securite";
import { useSession } from "../session/session";
import { Coquille, Dialogue, Erreur, Etat, Section, Tableau, Tuile, useEnvironnement } from "../ui";

const PALIERS = ["Palier 0 · e-mail vérifié", "Palier 1 · identité vérifiée", "Palier 2 · entreprise vérifiée"];

const FILTRES: { cle: string | null; label: string }[] = [
  { cle: null, label: "Tous" },
  { cle: "a_approuver", label: "À approuver" },
  { cle: "actifs", label: "Actifs (30 j)" },
  { cle: "inactifs", label: "Inactifs" },
  { cle: "nouveaux", label: "Nouveaux (7 j)" },
  { cle: "verifications", label: "Pièces à vérifier" },
  { cle: "desactives", label: "Désactivés" },
  /* la bêta : les robots du marché et les comptes de test ne sont pas des clients ; ils ont leur filtre */
  { cle: "robots", label: "Robots" },
  { cle: "tests", label: "Comptes de test" },
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

/**
 * L'interrupteur de l'approbation (0047) et la file. Allumé : un nouveau compte visite Glisil, mais
 * ne bouge pas d'argent avant d'être approuvé. Éteint : ceux qui attendent sont approuvés d'office,
 * les suivants naissent approuvés ; rallumé, il ne reprend rien à personne.
 */
function Approbation({ onVoir }: { onVoir: () => void }) {
  const { data: a } = useApprobation();
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<unknown>(null);
  const [enCours, setEnCours] = useState(false);
  if (!a) return null;
  const basculer = async () => {
    setEnCours(true); setErreur(null);
    try { await guichet.reglerApprobation(!a.manuelle); setOuvert(false); await rafraichir(); } catch (e) { setErreur(e); } finally { setEnCours(false); }
  };
  return (
    <Paper data-approbation={a.manuelle ? "allumee" : "eteinte"} sx={{ p: 2.5, borderRadius: 5, bgcolor: a.manuelle ? "#FFF4DC" : "background.paper" }}>
      <Stack direction="row" gap={2} alignItems="center" flexWrap="wrap">
        <Stack sx={{ flex: 1, minWidth: 260 }} gap={0.5}>
          <Typography fontWeight={600}>Approbation manuelle des comptes · {a.manuelle ? "allumée" : "éteinte"}</Typography>
          <Typography variant="body2">
            {a.manuelle
              ? "Un nouveau compte visite Glisil, mais ne peut ni déposer, ni trader, ni retirer avant que vous l'approuviez."
              : "Un nouveau compte peut bouger de l'argent dès la fin de son inscription."}
          </Typography>
        </Stack>
        {a.en_attente > 0 && <Button variant="contained" onClick={onVoir}>{a.en_attente} compte{a.en_attente > 1 ? "s" : ""} à approuver</Button>}
        {a.peut_regler && (
          <Stack direction="row" alignItems="center" gap={0.5}>
            <Typography variant="body2">{a.manuelle ? "Allumée" : "Éteinte"}</Typography>
            <Switch checked={a.manuelle} onChange={() => setOuvert(true)} inputProps={{ "aria-label": "Approbation manuelle des comptes" }} />
          </Stack>
        )}
      </Stack>
      <Dialogue ouvert={ouvert} titre={a.manuelle ? "Éteindre l'approbation manuelle ?" : "Rallumer l'approbation manuelle ?"} onFermer={() => setOuvert(false)}
        onValider={() => void basculer()} libelle={a.manuelle ? "Éteindre" : "Rallumer"} enCours={enCours}>
        <Typography variant="body2">
          {a.manuelle
            ? `${a.en_attente > 1 ? `Les ${a.en_attente} comptes en attente seront approuvés d'office, et l` : a.en_attente === 1 ? "Le compte en attente sera approuvé d'office, et l" : "L"}es nouveaux comptes pourront bouger de l'argent dès leur inscription. Vous pourrez la rallumer à tout moment.`
            : "Les comptes ouverts à partir de maintenant attendront votre approbation avant tout geste d'argent. Ceux qui sont déjà approuvés le restent."}
        </Typography>
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>
    </Paper>
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
      <Approbation onVoir={() => setParams({ filtre: "a_approuver" })} />
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
        colonnes={["Client", "Téléphone", "Résidence", "Palier", { label: "XAFe", align: "right" }, { label: "USDT", align: "right" }, { label: "USDC", align: "right" }, "Dernière opération", "Dernière connexion", "Inscrit", "État"]}
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
          enTranches(c.usdc ?? 0, 2),
          c.derniere_operation ? jourRelatif(c.derniere_operation) : "jamais",
          c.derniere_connexion ? `${jourRelatif(c.derniere_connexion)} ${heure(c.derniere_connexion)}` : "—",
          jourRelatif(c.cree_le),
          <Etat key="e" valeur={c.desactive_le ? "inactif" : c.approuve_le === null ? "a_approuver" : "actif"} />,
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
  const { data: securite } = useSecurite(id);
  const production = useEnvironnement() === "production";
  const [dialogue, setDialogue] = useState<"palier" | "verification" | "desactiver" | "doter" | "deux_facteurs" | "approuver" | null>(null);
  const [dotation, setDotation] = useState({ xafe: "1000000", usdt: "0" });
  const [palier, setPalier] = useState(0);
  const [note, setNote] = useState("");
  const [erreur, setErreur] = useState<unknown>(null);
  const [enCours, setEnCours] = useState(false);

  if (!data) return <Coquille titre="Client"><Typography variant="body2">Chargement…</Typography></Coquille>;
  const c = data.compte;
  /* 0047 : en attente de l'approbation de l'équipe (un compte fermé n'attend plus rien) */
  const attend = c.approuve === false && !c.ferme_le;
  const naissance = c.date_naissance ? `${new Date(c.date_naissance).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} · ${age(c.date_naissance)} ans` : "—";
  const agir = async (f: () => Promise<unknown>) => {
    setEnCours(true); setErreur(null);
    try { await f(); setDialogue(null); setNote(""); await rafraichir(); } catch (e) { setErreur(e); } finally { setEnCours(false); }
  };

  return (
    <Coquille titre={c.nom ?? telephoneAffiche(c.telephone)} actions={
      <Stack direction="row" gap={1}>
        {peut("paliers") && attend && <Button variant="contained" onClick={() => { setNote(""); setDialogue("approuver"); }}>Approuver ce client</Button>}
        {peut("paliers") && c.verification_en_cours && <Button variant="contained" onClick={() => setDialogue("verification")}>Examiner les pièces</Button>}
        {peut("paliers") && <Button variant="outlined" onClick={() => { setPalier(c.palier); setDialogue("palier"); }}>Changer le palier</Button>}
        {/* la bêta : de l'argent de test, refusé par le moteur hors bêta */}
        {peut("parametres") && !production && <Button variant="outlined" onClick={() => setDialogue("doter")}>Donner de l'argent de test</Button>}
        {peut("administrateurs") && <Button variant="text" color="error" onClick={() => { setNote(""); setDialogue("deux_facteurs"); }}>Réinitialiser la double authentification</Button>}
        {peut("clients") && <Button variant="text" color="error" onClick={() => setDialogue("desactiver")}>{c.ferme_le ? "Rouvrir" : c.desactive_le ? "Réactiver" : "Désactiver"}</Button>}
      </Stack>
    }>
      <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      {attend && (
        <Paper data-a-approuver sx={{ p: 2.5, borderRadius: 5, bgcolor: "#FFF4DC" }}>
          <Stack direction="row" gap={2} alignItems="center" flexWrap="wrap">
            <Stack sx={{ flex: 1, minWidth: 260 }} gap={0.5}>
              <Typography fontWeight={600}>Ce compte attend votre approbation</Typography>
              <Typography variant="body2">
                Vérifiez son identité ci-dessous : nom, date de naissance, téléphone, résidence. Tant qu'il n'est pas approuvé, il visite Glisil mais ne peut ni déposer, ni trader, ni retirer.
              </Typography>
            </Stack>
            {peut("paliers") && <Button variant="contained" onClick={() => { setNote(""); setDialogue("approuver"); }}>Approuver ce client</Button>}
          </Stack>
        </Paper>
      )}
      <Stack direction="row" gap={2} flexWrap="wrap">
        <Tuile label="XAFe" valeur={xaf(data.soldes.XAFe?.disponible ?? 0)} tone="green" aide={`${xaf(data.soldes.XAFe?.bloque ?? 0)} bloqués`} />
        <Tuile label="USDT" valeur={enTranches(data.soldes.USDT?.disponible ?? 0, 2)} tone="blue" aide={`${enTranches(data.soldes.USDT?.bloque ?? 0, 2)} bloqués`} />
        <Tuile label="USDC" valeur={enTranches(data.soldes.USDC?.disponible ?? 0, 2)} tone="blue" aide={`${enTranches(data.soldes.USDC?.bloque ?? 0, 2)} bloqués`} />
        <Tuile label="Palier" valeur={String(c.palier)} tone="amber" aide={PALIERS[c.palier]} />
        <Tuile label="Compte" valeur={c.ferme_le ? "fermé" : c.desactive_le ? "désactivé" : attend ? "à approuver" : "actif"} tone={c.desactive_le ? "red" : attend ? "amber" : "neutral"}
          aide={c.ferme_le ? `fermé par le client ${jourRelatif(c.ferme_le).toLowerCase()}` : `depuis ${jourRelatif(c.cree_le)} · ${c.entreprise ?? "particulier"}${securite && !securite.deux_facteurs ? " · sans double authentification" : ""}`} />
      </Stack>
      <Section titre="Identité et connexions">
        <Paper sx={{ p: 2.5, borderRadius: 5 }}>
          <Fiche items={[
            ["Prénom", c.prenom ?? "—"],
            ["Nom de famille", c.nom_de_famille ?? "—"],
            ["E-mail", c.email ?? "—"],
            ["Téléphone", `${telephoneAffiche(c.telephone)} · non vérifié`],
            ["Date de naissance", naissance],
            ["Résidence", c.ville ? `${c.ville}, ${nomDuPays(c.pays)}` : "—"],
            ["Inscrit", `${quand(c.cree_le)}`],
            ["Dernière connexion", c.derniere_connexion ? quand(c.derniere_connexion) : "—"],
            ["Dernière opération", c.derniere_operation ? quand(c.derniere_operation) : "jamais"],
            ["Approbation", c.approuve_le ? `${quand(c.approuve_le)} · ${c.approuve_par ?? "d'office"}` : attend ? "en attente" : "—"],
            ["Conditions", c.conditions_version ? `version du ${c.conditions_version}, acceptée ${c.conditions_acceptees_le ? quand(c.conditions_acceptees_le) : ""}${c.conditions_a_jour === false ? " · à réaccepter" : ""}` : "jamais acceptées (compte d'avant les conditions)"],
            ...(c.ferme_le ? [["Fermé", quand(c.ferme_le)] as [string, string]] : []),
          ]} />
        </Paper>
      </Section>
      <Section titre="Sécurité">
        <Paper sx={{ p: 2.5, borderRadius: 5 }}>
          {!securite ? <Typography variant="body2">Chargement…</Typography> : (
            <Stack gap={2}>
              <Fiche items={[
                ["Double authentification", securite.deux_facteurs ? "active" : "absente — le client l'ajoutera à sa prochaine connexion"],
                ["Codes de secours", securite.codes_confirmes_le ? `${securite.codes_restants} restant(s) · notés ${quand(securite.codes_confirmes_le)}` : "pas encore notés"],
              ]} />
              {securite.evenements.length > 0 && (
                <Tableau colonnes={["Quand", "Ce qui s'est passé"]} lignes={securite.evenements.slice(0, 8).map((e) => [quand(e.cree_le), EVENEMENTS[e.evenement] ?? e.evenement])} />
              )}
              {securite.reinitialisations.length > 0 && (
                <Tableau colonnes={["Réinitialisation", "Faite", "Motif"]} lignes={securite.reinitialisations.map((r) => [quand(r.demandee_le), r.faite_le ? quand(r.faite_le) : r.echec ? `échec : ${r.echec}` : "non", r.motif ?? "—"])} />
              )}
            </Stack>
          )}
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
            <Tableau colonnes={["Quand", "Actif", { label: "Disponible", align: "right" }, { label: "Bloqué", align: "right" }, "Nature", "Source"]} lignes={data.ecritures.map((e) => [`${jourRelatif(e.quand)} ${heure(e.quand)}`, e.actif, enTranches(e.disponible, e.actif === "XAFe" ? 0 : 2), enTranches(e.bloque, e.actif === "XAFe" ? 0 : 2), e.nature, e.source])} vide="Aucune écriture." />
          </Section>
        </Stack>
      </Stack>

      <Dialogue ouvert={dialogue === "approuver"} titre={`Approuver ${c.nom ?? "ce client"}`} onFermer={() => setDialogue(null)}
        onValider={() => void agir(() => guichet.approuverClient(c.id, note))} libelle="Approuver" enCours={enCours}>
        <Fiche items={[
          ["Nom", `${c.prenom ?? ""} ${c.nom_de_famille ?? ""}`.trim() || (c.nom ?? "—")],
          ["Date de naissance", naissance],
          ["Téléphone", telephoneAffiche(c.telephone)],
          ["E-mail", c.email ?? "—"],
          ["Résidence", c.ville ? `${c.ville}, ${nomDuPays(c.pays)}` : "—"],
          ["Inscrit", quand(c.cree_le)],
        ]} />
        <Typography variant="body2">Une fois approuvé, il peut déposer, trader et retirer. Il est prévenu par e-mail et dans l'application.</Typography>
        <TextField label="Ce que vous avez vérifié (facultatif)" value={note} onChange={(e) => setNote(e.target.value)} fullWidth
          helperText="Gardé au journal : un appel, une pièce d'identité, une personne que vous connaissez…" />
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>
      <Dialogue ouvert={dialogue === "doter"} titre="Donner de l'argent de test" onFermer={() => setDialogue(null)} libelle="Donner" enCours={enCours}
        desactive={!(Number(dotation.xafe) > 0 || Number(dotation.usdt) > 0)}
        onValider={() => void agir(() => guichet.doter(c.id, Math.round(Number(dotation.xafe) || 0), Math.round((Number(dotation.usdt) || 0) * 100) / 100, note))}>
        <Typography variant="body2">Pendant la bêta seulement. Les XAFe sont créés comme un dépôt (et frappés dans la réserve, sur la chaîne d'essai), mais comptés à part par la parité : aucun XAF réel n'est derrière.</Typography>
        <TextField label="XAFe" value={dotation.xafe} onChange={(e) => setDotation({ ...dotation, xafe: e.target.value.replace(/[^0-9]/g, "") })} inputMode="numeric" fullWidth helperText="au plus 100 000 000" />
        <TextField label="USDT" value={dotation.usdt} onChange={(e) => setDotation({ ...dotation, usdt: e.target.value.replace(/[^0-9.]/g, "") })} inputMode="decimal" fullWidth helperText="au plus 1 000 000" />
        <TextField label="Pourquoi" value={note} onChange={(e) => setNote(e.target.value)} fullWidth />
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>
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
      <Dialogue ouvert={dialogue === "deux_facteurs"} titre="Réinitialiser la double authentification" onFermer={() => setDialogue(null)}
        onValider={() => void agir(() => guichet.reinitialiserDeuxFacteurs(c.id, note))} libelle="Retirer son application" couleur="error" enCours={enCours} desactive={note.trim().length < 10}>
        <Typography variant="body2">Seulement si le client a perdu son téléphone ET ses codes de secours, et après avoir vérifié que c'est bien lui. Son application d'authentification et ses codes sont retirés ; à sa prochaine connexion, il en ajoute une nouvelle. Il est prévenu par e-mail et dans l'application.</Typography>
        <TextField label="Comment l'identité a été vérifiée" value={note} onChange={(e) => setNote(e.target.value)} fullWidth autoFocus multiline minRows={2}
          helperText="Obligatoire, 10 caractères au moins : appel vidéo, pièce d'identité comparée, question sur ses dernières opérations…" />
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
