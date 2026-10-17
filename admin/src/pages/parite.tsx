/*
 * La Parité : 1 XAFe = 1 XAF, prouvé à trois colonnes qui ne se connaissent pas.
 *   LES FLOATS    l'argent posé chez MTN et Orange, tel que l'opérateur l'annonce ;
 *   LE REGISTRE   ce que Glisil doit à ses clients ;
 *   LA CHAÎNE     les XAFe qui existent, relus frappe par frappe sur la chaîne.
 * La chaîne doit valoir le registre au franc près ; les floats doivent le
 * couvrir. Chaque ligne rapproche une opération du registre de sa transaction.
 * Le relevé se refait seul toutes les cinq minutes ; un écart ouvre une alarme.
 */
import AttachFileRounded from "@mui/icons-material/AttachFileRounded";
import OpenInNewRounded from "@mui/icons-material/OpenInNewRounded";
import RefreshRounded from "@mui/icons-material/RefreshRounded";
import { Alert, Box, Button, Link as Lien, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useRef, useState } from "react";
import { useGuichet, useParite, useRafraichir } from "../guichet";
import type { LigneParite, Parite as LaParite, StatutParite } from "../guichet/types";
import { enTranches, numeroEnTranches, quand, xaf } from "../noyau/format";
import { useSession } from "../session/session";
import { tones, type Tone } from "../theme";
import { Coquille, Dialogue, Erreur, Etat, Section, Tableau } from "../ui";

const RESEAUX = { bep20: "BNB Smart Chain", trc20: "Tron" } as const;
const SOURCES = { sms: "SMS de l'opérateur", ussd: "consultation du solde", releve: "relevé officiel" } as const;
const OPERATEURS: Record<string, string> = { mtn: "MTN MoMo", om: "Orange Money" };
const NATURES = { reserve: "réserve Glisil", retrait: "vers le wallet d'un client", retour: "rendus par un client", inconnue: "inconnue du registre" } as const;

/** Un montant de jeton : entier s'il l'est, sinon jusqu'aux six décimales de la chaîne. */
const jeton = (n: number | null | undefined) => (n == null ? "—" : Number.isInteger(n) ? xaf(n) : enTranches(n, 6).replace(/0+$/, ""));
const court = (h: string | null | undefined) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "—");
const lienTx = (p: LaParite, reseau: string, tx: string) => {
  const c = p.contrats.find((x) => x.reseau === reseau);
  return c ? `${c.explorateur}/${reseau === "trc20" ? "transaction" : "tx"}/${tx}` : null;
};

const BANDEAU: Record<StatutParite, { tone: Tone; titre: string }> = {
  juste: { tone: "green", titre: "La parité tient, au franc près." },
  en_cours: { tone: "blue", titre: "La parité tient : des opérations sont en route vers la chaîne." },
  ecart: { tone: "red", titre: "Écart : quelque chose ne se rapproche pas." },
  incomplet: { tone: "amber", titre: "Pas encore conclu : une colonne manque." },
};

function Colonne({ titre, sous, valeur, unite, tone, children }: { titre: string; sous: string; valeur: string; unite: string; tone: Tone; children?: React.ReactNode }) {
  return (
    <Paper data-colonne={titre} sx={{ p: 2.5, borderRadius: 5, flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 1, borderTop: 6, borderColor: tones[tone].fg }}>
      <Typography variant="overline" sx={{ letterSpacing: 1.2, color: "text.secondary", lineHeight: 1.4 }}>{titre}</Typography>
      <Typography variant="body2">{sous}</Typography>
      <Typography variant="h4" sx={{ fontVariantNumeric: "tabular-nums", fontSize: valeur.length > 12 ? 26 : 32 }}>
        {valeur}<Typography component="span" sx={{ fontSize: 16, ml: 0.75, color: "text.secondary" }}>{unite}</Typography>
      </Typography>
      <Stack gap={0.75} sx={{ mt: 0.5 }}>{children}</Stack>
    </Paper>
  );
}

function Detail({ gauche, droite, aide }: { gauche: React.ReactNode; droite: React.ReactNode; aide?: React.ReactNode }) {
  return (
    <Box sx={{ borderTop: 1, borderColor: "divider", pt: 0.75 }}>
      <Stack direction="row" justifyContent="space-between" gap={1}>
        <Typography variant="body2" sx={{ minWidth: 0 }}>{gauche}</Typography>
        <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{droite}</Typography>
      </Stack>
      {aide && <Typography variant="caption" color="text.secondary">{aide}</Typography>}
    </Box>
  );
}

function Releve({ ouvert, floatId, onFermer }: { ouvert: boolean; floatId: number | null; onFermer: () => void }) {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const [solde, setSolde] = useState("");
  const [date, setDate] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
  const [fichier, setFichier] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [erreur, setErreur] = useState<unknown>(null);
  const [enCours, setEnCours] = useState(false);
  const champ = useRef<HTMLInputElement>(null);
  const montant = Number(solde.replace(/\s/g, "").replace(",", "."));
  const valider = async () => {
    if (floatId == null || !fichier) return;
    setErreur(null); setEnCours(true);
    try {
      const chemin = await guichet.deposerReleve(floatId, fichier);
      await guichet.saisirReleve(floatId, montant, new Date(date).toISOString(), chemin, note);
      await guichet.rapprocherMaintenant().catch(() => undefined);
      await rafraichir();
      setSolde(""); setFichier(null); setNote("");
      onFermer();
    } catch (e) { setErreur(e); } finally { setEnCours(false); }
  };
  return (
    <Dialogue ouvert={ouvert} titre="Saisir le relevé de l'opérateur" onFermer={onFermer} onValider={() => void valider()} libelle="Enregistrer le relevé"
      enCours={enCours} desactive={!fichier || !(montant >= 0) || solde.trim() === ""}>
      <Typography variant="body2">Le solde que dit le relevé officiel (l'export MTN ou Orange), à l'heure qu'il porte. Le fichier est exigé : c'est lui qui fait foi.</Typography>
      <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      <TextField label="Solde du relevé (XAF)" value={solde} onChange={(e) => setSolde(e.target.value)} inputProps={{ inputMode: "decimal", "aria-label": "solde du relevé" }} />
      <TextField label="Date et heure du relevé" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} InputLabelProps={{ shrink: true }} />
      <input ref={champ} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden onChange={(e) => setFichier(e.target.files?.[0] ?? null)} />
      <Button variant="outlined" startIcon={<AttachFileRounded />} onClick={() => champ.current?.click()}>{fichier ? fichier.name : "Joindre le relevé (image ou PDF)"}</Button>
      <TextField label="Note (facultatif)" value={note} onChange={(e) => setNote(e.target.value)} />
    </Dialogue>
  );
}

function Lignes({ p }: { p: LaParite }) {
  const [filtre, setFiltre] = useState<"tout" | "anomalies">("tout");
  const lignes = p.lignes.filter((l) => filtre === "tout" || !["concorde", "en_route"].includes(l.verdict));
  const montantVu = (l: LigneParite) => (l.montant_vu == null ? "pas encore lue" : `${l.genre === "frappe" ? "+" : "−"}${jeton(l.montant_vu)}`);
  return (
    <Section titre="Chaque opération, rapprochée" action={
      <TextField select size="small" value={filtre} onChange={(e) => setFiltre(e.target.value as "tout" | "anomalies")} inputProps={{ "aria-label": "filtrer les lignes" }}>
        <MenuItem value="tout">Toutes</MenuItem>
        <MenuItem value="anomalies">Seulement ce qui ne va pas</MenuItem>
      </TextField>
    }>
      <Tableau
        colonnes={["Quand", "Référence", "Opération", "Réseau", { label: "Registre", align: "right" }, { label: "Sur la chaîne", align: "right" }, "Transaction", "Verdict"]}
        vide={filtre === "tout" ? "Aucune opération encore : le premier dépôt crédité en fera une." : "Rien qui ne va pas."}
        lignes={lignes.map((l) => {
          const tx = l.tx_vu ?? l.tx_attendu ?? null;
          const href = tx ? lienTx(p, l.reseau, tx) : null;
          return [
            quand(l.depuis),
            <Typography key="r" fontFamily="Roboto Mono, monospace" fontSize={13}>{l.reference ?? "— aucune —"}</Typography>,
            `${l.genre === "frappe" ? "Frappe" : "Destruction"} · ${NATURES[l.nature]}`,
            RESEAUX[l.reseau] ?? l.reseau,
            l.montant == null ? "—" : `${l.genre === "frappe" ? "+" : "−"}${jeton(l.montant)}`,
            montantVu(l),
            href ? <Lien key="t" href={href} target="_blank" rel="noreferrer" sx={{ fontFamily: "Roboto Mono, monospace", fontSize: 13 }}>{court(tx)}</Lien> : "—",
            <Etat key="v" valeur={l.verdict} />,
          ];
        })}
      />
    </Section>
  );
}

function Reglages({ p }: { p: LaParite }) {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const { peut } = useSession();
  const [numero, setNumero] = useState(p.reglages?.alerte_numero ?? "");
  const [operateur, setOperateur] = useState<"mtn" | "om">(p.reglages?.alerte_operateur ?? "mtn");
  const [erreur, setErreur] = useState<unknown>(null);
  const [fait, setFait] = useState(false);
  if (!p.reglages) return null;
  const enregistrer = async () => {
    setErreur(null);
    try {
      await guichet.modifierParametre("parite", { ...p.reglages, alerte_numero: numero.trim() || null, alerte_operateur: operateur });
      setFait(true); setTimeout(() => setFait(false), 1500);
      await rafraichir();
    } catch (e) { setErreur(e); }
  };
  return (
    <Section titre="L'alarme par SMS">
      <Paper sx={{ p: 2.5, borderRadius: 5, display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Typography variant="body2">Un écart vu deux relevés de suite (dix minutes) part par SMS à ce numéro, une fois par alarme, depuis une puce de l'opérateur choisi. Sans numéro, l'alarme reste ici et sur le tableau de bord.</Typography>
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
        <Stack direction={{ xs: "column", sm: "row" }} gap={1.5}>
          <TextField label="Numéro qui reçoit l'alarme" value={numero} onChange={(e) => setNumero(e.target.value)} disabled={!peut("parametres")} sx={{ flex: 1 }} inputProps={{ inputMode: "tel" }} />
          <TextField select label="Envoyé par" value={operateur} onChange={(e) => setOperateur(e.target.value as "mtn" | "om")} disabled={!peut("parametres")} sx={{ minWidth: 180 }}>
            <MenuItem value="mtn">une puce MTN</MenuItem>
            <MenuItem value="om">une puce Orange</MenuItem>
          </TextField>
          {peut("parametres") && <Button variant="contained" onClick={() => void enregistrer()}>{fait ? "Enregistré" : "Enregistrer"}</Button>}
        </Stack>
      </Paper>
    </Section>
  );
}

export function Parite() {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const { peut } = useSession();
  const { data: p, error } = useParite();
  const [releve, setReleve] = useState<number | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  const [enCours, setEnCours] = useState(false);
  if (!p) return <Coquille titre="Parité">{error ? <Erreur erreur={error} onFermer={() => undefined} /> : <Typography variant="body2">Chargement…</Typography>}</Coquille>;
  const r = p.releve;
  const maintenant = async () => {
    setErreur(null); setEnCours(true);
    try { await guichet.rapprocherMaintenant(); await rafraichir(); } catch (e) { setErreur(e); } finally { setEnCours(false); }
  };
  const ouvertes = p.alertes.filter((a) => !a.close_le);
  const justes = p.historique.filter((h) => h.statut === "juste" || h.statut === "en_cours").length;
  return (
    <Coquille titre="Parité" actions={peut("rapprocher") ? <Button startIcon={<RefreshRounded />} onClick={() => void maintenant()} disabled={enCours}>{enCours ? "…" : "Refaire le relevé"}</Button> : undefined}>
      <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      {!r ? (
        <Alert severity="info" sx={{ borderRadius: 4 }}>Aucun relevé encore : le premier se fait dans les cinq minutes qui suivent la mise en service.</Alert>
      ) : (
        <Paper data-statut={r.statut} sx={{ p: 3, borderRadius: 6, bgcolor: tones[BANDEAU[r.statut].tone].bg, color: tones[BANDEAU[r.statut].tone].fg }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>{BANDEAU[r.statut].titre}</Typography>
          <Typography variant="body1" sx={{ mt: 0.75, color: "inherit" }}>
            Glisil doit <b>{xaf(r.registre)} XAFe</b>. {r.chaine != null ? <>La chaîne en montre <b>{jeton(r.chaine)}</b>{r.en_route !== 0 ? <>, et <b>{jeton(Math.abs(r.en_route))}</b> {r.en_route > 0 ? "sont en route" : "doivent encore être détruits"}</> : null}.</> : <>La lecture de la chaîne n'est pas encore à jour.</>}{" "}
            {r.floats != null ? <>Les floats tiennent <b>{xaf(r.floats)} XAF</b> : {r.couverture! >= 0 ? <>{xaf(r.couverture!)} de plus que ce qui est dû.</> : <>il manque <b>{xaf(-r.couverture!)} XAF</b>.</>}</> : <>Le solde d'un float n'est pas connu.</>}
          </Typography>
          <Typography variant="caption" sx={{ color: "inherit", opacity: 0.8 }}>Relevé {quand(r.fait_le)} · se refait seul toutes les cinq minutes{p.historique.length ? ` · ${justes} relevé${justes > 1 ? "s" : ""} horaire${justes > 1 ? "s" : ""} juste${justes > 1 ? "s" : ""} sur ${p.historique.length} ces sept derniers jours` : ""}</Typography>
        </Paper>
      )}

      {p.essai && <Alert severity="warning" sx={{ borderRadius: 4 }}>Réseau d'ESSAI : ces jetons n'ont pas de valeur. La parité se prouve ici comme elle se prouvera sur le vrai réseau.</Alert>}

      {ouvertes.length > 0 && (
        <Section titre="Alarmes ouvertes">
          <Stack gap={1}>
            {ouvertes.map((a) => (
              <Alert key={a.id} severity={a.gravite === "attention" ? "info" : a.gravite === "anomalie" ? "warning" : "error"} sx={{ borderRadius: 4 }}>
                <b>{a.message}</b>
                <Typography variant="caption" component="div">vue {a.vues} fois depuis {quand(a.ouverte_le)}{a.sms_le ? ` · SMS envoyé ${quand(a.sms_le)}` : ""}</Typography>
              </Alert>
            ))}
          </Stack>
        </Section>
      )}

      {r && (
        <Stack direction="row" gap={2} flexWrap="wrap">
          <Colonne titre="1 · Les floats" sous="L'argent posé chez MTN et Orange, tel que l'opérateur l'annonce." valeur={r.floats != null ? xaf(r.floats) : "non connu"} unite={r.floats != null ? "XAF" : ""} tone={r.couverture == null ? "amber" : r.couverture >= 0 ? "green" : "red"}>
            {p.floats.filter((f) => f.actif).map((f) => (
              <Detail key={f.id}
                gauche={<>{OPERATEURS[f.operateur] ?? f.operateur} {numeroEnTranches(f.numero)}{f.titulaire ? ` · ${f.titulaire}` : ""}</>}
                droite={f.dernier ? `${xaf(f.dernier.solde)} XAF` : "—"}
                aide={<Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
                  <span>{f.dernier ? `${SOURCES[f.dernier.source]}, ${quand(f.dernier.annonce_le)}` : "aucun solde annoncé"}</span>
                  {peut("rapprocher") && <Button size="small" onClick={() => setReleve(f.id)} sx={{ minWidth: 0, px: 1, whiteSpace: "nowrap", flexShrink: 0 }}>Saisir un relevé</Button>}
                </Stack>} />
            ))}
            <Typography variant="caption" color="text.secondary">Les floats portent aussi les frais gagnés et l'argent propre de l'entreprise : ils doivent COUVRIR ce qui est dû, pas l'égaler.</Typography>
          </Colonne>
          <Colonne titre="2 · Le registre" sous="Ce que Glisil doit : chaque XAFe émis contre des XAF reçus, moins chaque XAFe détruit contre des XAF payés." valeur={xaf(r.registre)} unite="XAFe" tone="blue">
            <Detail gauche="dans les comptes Glisil" droite={xaf(r.dans_comptes)} />
            <Detail gauche="sur les wallets des clients" droite={xaf(r.sur_wallets)} />
          </Colonne>
          <Colonne titre="3 · La chaîne" sous="Les XAFe qui existent, relus frappe par frappe sur la chaîne elle-même." valeur={r.chaine != null ? jeton(r.chaine) : "en lecture"} unite={r.chaine != null ? "XAFe" : ""} tone={r.ecart == null ? "amber" : r.ecart === 0 ? "green" : "red"}>
            {r.reseaux.map((n) => {
              const c = p.contrats.find((x) => x.reseau === n.reseau);
              return (
                <Detail key={n.reseau}
                  gauche={c?.contrat ? <Lien href={`${c.explorateur}/${n.reseau === "trc20" ? "token20" : "token"}/${c.contrat}`} target="_blank" rel="noreferrer" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>{RESEAUX[n.reseau]} <OpenInNewRounded sx={{ fontSize: 14 }} /></Lien> : RESEAUX[n.reseau]}
                  droite={n.offre != null ? `${jeton(n.offre)} XAFe` : "en lecture"}
                  aide={n.a_jour ? `lu au bloc ${enTranches(n.bloc ?? 0, 0)}, ${quand(n.lu_le ?? r.fait_le)} · dont ${jeton(n.reserve)} dans la réserve Glisil` : `lecture en cours, bloc ${enTranches(n.bloc ?? 0, 0)}`} />
              );
            })}
            <Detail gauche="écart, opérations en route comptées" droite={r.ecart == null ? "—" : `${jeton(r.ecart)} XAFe`} aide="zéro, toujours : sinon une alarme s'ouvre" />
          </Colonne>
        </Stack>
      )}

      <Lignes p={p} />

      <Section titre="Le vérifier soi-même">
        <Paper sx={{ p: 2.5, borderRadius: 5 }}>
          <Typography variant="body2" component="div">
            <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
              <li>Ouvrez le contrat XAFe dans l'explorateur ({p.contrats.map((c, i) => <span key={c.reseau}>{i ? " · " : ""}<Lien href={`${c.explorateur}/${c.reseau === "trc20" ? "token20" : "token"}/${c.contrat}`} target="_blank" rel="noreferrer">{RESEAUX[c.reseau]}</Lien></span>)}) : « Total supply » est l'offre de la colonne 3.</li>
              <li>Chaque transaction de la liste ci-dessus porte une <b>empreinte</b> : keccak256 du texte de sa référence (« XAFe-DP-000003 »). Le contrat refuse de frapper deux fois sous la même.</li>
              <li>La page publique <code>/preuve</code> de l'application montre les mêmes chiffres, à tout le monde, sans compte.</li>
            </ol>
          </Typography>
        </Paper>
      </Section>

      <Reglages p={p} />
      <Releve ouvert={releve != null} floatId={releve} onFermer={() => setReleve(null)} />
    </Coquille>
  );
}
