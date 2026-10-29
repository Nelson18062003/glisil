/*
 * Les remboursements payés à la main (0014). Le client a demandé ; ses XAFe
 * sont déjà mis de côté. Ici, l'équipe :
 *   1. lit ce qu'il faut envoyer, à qui, et au nom de qui ;
 *   2. paie depuis la puce (TOTEM), en vérifiant le nom que l'opérateur affiche ;
 *   3. tape le transaction ID du SMS (et son montant, si l'opérateur plafonne
 *      un transfert : un gros remboursement se paie en plusieurs fois) ;
 *   4. la sortie passe « en preuve » : ses XAFe ne sont détruits que lorsque
 *      TOTEM a relevé, sur une puce de Glisil, le SMS qui montre CE paiement —
 *      même ID, même montant, même numéro (0038). Un écart se dit en mots, et
 *      se corrige (l'ID mal tapé) ; il ne se confirme pas ;
 *   5. au-delà du seuil (s'il y en a un), une AUTRE personne confirme.
 * Ce que la puce voit partir sans sortie en face se montre en bas : de
 * l'argent sorti du float que rien n'explique.
 */
import AttachFileRounded from "@mui/icons-material/AttachFileRounded";
import CheckRounded from "@mui/icons-material/CheckRounded";
import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded";
import { Alert, Box, Button, Chip, IconButton, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useGuichet, useRafraichir, useSorties, useSortiesNonExpliquees } from "../guichet";
import type { GesteSortie } from "../guichet/guichet";
import type { PreuvePaiement, Rapprochement, Sortie } from "../guichet/types";
import { heure, jourRelatif, numeroEnTranches, xaf } from "../noyau/format";
import { useSession } from "../session/session";
import { tones } from "../theme";
import { Dialogue, Erreur, Section, Tableau } from "../ui";

const OPERATEURS: Record<string, string> = { mtn: "MTN MoMo", om: "Orange Money" };
const MOTIFS = ["Le nom du compte Mobile Money ne correspond pas au compte Glisil.", "Le numéro ne reçoit pas : l'opérateur refuse le transfert."];

/** Deux noms « se ressemblent » s'ils partagent un mot de trois lettres au moins : l'opérateur abrège souvent. */
function nomsProches(a: string | null | undefined, b: string | null | undefined): boolean {
  const mots = (x: string) => new Set(x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z]+/).filter((m) => m.length >= 3));
  if (!a || !b) return true;
  const ma = mots(a);
  return [...mots(b)].some((m) => ma.has(m));
}

function Copier({ texte, label }: { texte: string; label: string }) {
  const [fait, setFait] = useState(false);
  return (
    <IconButton size="small" aria-label={label} onClick={async () => { try { await navigator.clipboard.writeText(texte); setFait(true); setTimeout(() => setFait(false), 1500); } catch { /* refusé : le texte reste lisible */ } }}>
      {fait ? <CheckRounded fontSize="small" color="primary" /> : <ContentCopyRounded fontSize="small" />}
    </IconButton>
  );
}

type Avis = Pick<Rapprochement, "etat" | "montant" | "numero" | "texte" | "reste"> | PreuvePaiement;

/** Ce que dit le SMS de la puce : d'une sortie entière, ou d'un seul de ses paiements. */
export function PuceDit({ r }: { r: Avis | null | undefined }) {
  if (!r) return null;
  const t = r.etat === "concorde" ? { label: "SMS de la puce : concorde", tone: tones.green }
    : r.etat === "ecart" ? { label: `SMS de la puce : écart${r.montant != null ? ` · ${xaf(r.montant)} XAF` : ""}${r.numero ? ` · ${numeroEnTranches(r.numero)}` : ""}`, tone: tones.red }
    : r.etat === "partiel" ? { label: `Payée en partie${"reste" in r && r.reste ? ` · reste ${xaf(r.reste)} XAF` : ""}`, tone: tones.amber }
    : { label: "SMS de la puce : pas encore reçu", tone: tones.amber };
  return <Chip size="small" label={t.label} title={r.texte ?? undefined} sx={{ height: 24, bgcolor: t.tone.bg, color: t.tone.fg, fontWeight: 600, alignSelf: "flex-start" }} />;
}

/** L'étiquette d'une demande : où elle en est, en un mot. */
function etiquette(s: Sortie): { label: string; tone: (typeof tones)[keyof typeof tones] } {
  if (s.etat === "en_preuve") {
    const r = s.rapprochement?.etat;
    if (r === "ecart") return { label: "écart", tone: tones.red };
    if (r === "partiel") return { label: `payée en partie · reste ${xaf(s.reste ?? 0)} XAF`, tone: tones.amber };
    if (r === "concorde" && s.a_confirmer) return { label: "à confirmer", tone: tones.blue };
    return { label: "payée · attend le SMS de la puce", tone: tones.amber };
  }
  return s.pris_par ? { label: `prise par ${s.pris_par}`, tone: tones.neutral } : { label: "à payer", tone: tones.amber };
}

/** Le message après un geste : ce que la base a fait, et pourquoi. */
function dire(reference: string, r: GesteSortie): { texte: string; bon: boolean } {
  const deja = r.deja ? "Déjà enregistré. " : "";
  const p = r.rapprochement;
  if (r.etat === "envoyee") return { texte: `${deja}${reference} envoyée : le SMS de la puce concorde, les XAFe sont détruits, le client est prévenu (notification et e-mail).`, bon: true };
  if (p?.etat === "ecart") return { texte: `${deja}${reference} reste ouverte : ${p.motif ?? "le SMS de la puce dit autre chose"}.`, bon: false };
  if (p?.etat === "partiel") return { texte: `${deja}${reference} payée en partie : il reste ${xaf(p.reste ?? r.reste ?? 0)} XAF.`, bon: false };
  if (p?.etat === "concorde" && r.a_confirmer) return { texte: `${deja}${reference} prouvée : une autre personne confirme.`, bon: true };
  return { texte: `${deja}${reference} en preuve : elle se clôt toute seule dès que TOTEM relève le SMS de la puce.`, bon: true };
}

/** L'ordre de la pile : d'abord ce qu'une personne peut finir, puis ce qui cloche, puis le plus ancien. */
const rang = (s: Sortie) => (s.a_confirmer && s.rapprochement?.etat === "concorde" ? 0 : s.etat === "en_preuve" && s.rapprochement?.etat === "ecart" ? 1 : s.cloture_erreur ? 2 : 3);

function Demande({ s, onPayer, onRefuser, onPrendre, onConfirmer, onVoir, onVerifier, onCorriger, onForcer }: {
  s: Sortie; onPayer: () => void; onRefuser: () => void; onPrendre: () => void; onConfirmer: () => void; onVoir: (chemin: string) => void;
  onVerifier: () => void; onCorriger: () => void; onForcer: () => void;
}) {
  const { peut } = useSession();
  const op = OPERATEURS[s.operateur] ?? s.operateur.toUpperCase();
  const proches = nomsProches(s.nom_beneficiaire, s.compte.nom);
  const e = etiquette(s);
  const preuve = s.etat === "en_preuve";
  const r = s.rapprochement;
  const avisDe = (id: string) => r?.paiements?.find((x) => x.transaction_id === id);
  const aCorriger = (s.paiements_equipe ?? []).some((p) => !p.retire_le && avisDe(p.transaction_id)?.etat !== "concorde");
  return (
    <Paper data-demande={s.reference} data-etat={s.etat} sx={{ p: 2, borderRadius: 5, display: "flex", flexDirection: "column", gap: 1.25, border: 1, borderColor: e.tone === tones.red ? tones.red.fg : s.a_confirmer ? tones.blue.fg : "divider" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
        <Typography fontFamily="Roboto Mono, monospace" fontWeight={600}>{s.reference}</Typography>
        <Chip size="small" label={e.label} sx={{ height: 24, fontWeight: 600, bgcolor: e.tone.bg, color: e.tone.fg }} />
      </Stack>
      <Stack direction="row" alignItems="baseline" gap={0.5}>
        <Typography variant="h5" fontWeight={700}>{xaf(s.montant_xaf)} XAF</Typography>
        <Copier texte={String(s.montant_xaf)} label="Copier le montant" />
      </Stack>
      <Stack direction="row" alignItems="center" gap={0.5}>
        <Typography>{op} · <b>{numeroEnTranches(s.numero)}</b></Typography>
        <Copier texte={s.numero} label="Copier le numéro" />
      </Stack>
      <Typography variant="body2">Au nom de <b>{s.nom_beneficiaire ?? "—"}</b> · compte Glisil : <Link to={`/clients/${s.compte.id}`} style={{ color: "inherit" }}>{s.compte.nom ?? numeroEnTranches(s.compte.telephone)}</Link></Typography>
      {!proches && <Alert severity="warning" sx={{ borderRadius: 3, py: 0 }}>Le nom donné ne ressemble pas au nom du compte Glisil : payer quelqu'un d'autre que le titulaire n'est pas permis.</Alert>}
      <Typography variant="caption">Demandée {jourRelatif(s.cree_le).toLowerCase()} à {heure(s.cree_le)} · {xaf(s.montant)} XAFe mis de côté, dont {xaf(s.frais)} de frais</Typography>

      {(s.paiements_equipe ?? []).length > 0 && (
        <Stack gap={0.75} data-paiements>
          <Typography variant="body2">Payée par <b>{s.payee_par}</b>{s.payee_le ? ` ${jourRelatif(s.payee_le).toLowerCase()} à ${heure(s.payee_le)}` : ""}</Typography>
          {(s.paiements_equipe ?? []).map((p) => (
            <Stack key={`${p.transaction_id}-${p.saisi_le}`} direction="row" alignItems="center" gap={0.75} flexWrap="wrap" sx={{ opacity: p.retire_le ? 0.55 : 1 }}>
              <Typography variant="body2" fontFamily="Roboto Mono, monospace" sx={{ textDecoration: p.retire_le ? "line-through" : "none" }}>{p.transaction_id}</Typography>
              {!p.retire_le && <Copier texte={p.transaction_id} label="Copier l'ID" />}
              <Typography variant="body2">{xaf(p.montant)} XAF</Typography>
              {p.retire_le ? <Typography variant="caption">remplacé : {p.retire_note}</Typography> : <PuceDit r={avisDe(p.transaction_id)} />}
            </Stack>
          ))}
        </Stack>
      )}
      {preuve && r?.motif && (
        <Alert severity={r.etat === "ecart" ? "error" : "info"} sx={{ borderRadius: 3, py: 0 }}>
          {r.etat === "ecart" ? "Les XAFe ne sont pas détruits : " : ""}{r.motif}.
        </Alert>
      )}
      {s.cloture_erreur && (
        <Alert severity="error" sx={{ borderRadius: 3, py: 0 }} action={peut("sorties") ? <Button color="inherit" size="small" onClick={onVerifier}>Revérifier</Button> : undefined}>
          La clôture a échoué : {s.cloture_erreur}
        </Alert>
      )}
      {s.forcee_le && <Alert severity="warning" sx={{ borderRadius: 3, py: 0 }}>Forcée par {s.forcee_par} : {s.forcee_note}</Alert>}

      {peut("sorties") && (
        <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 0.5 }}>
          {preuve ? (
            <>
              {s.a_confirmer && r?.etat === "concorde" && <Button variant="contained" onClick={onConfirmer} disabled={s.payee_par_moi}>Confirmer le paiement</Button>}
              {(s.reste ?? 0) > 0 && <Button variant="contained" onClick={onPayer}>Payer le reste</Button>}
              <Button variant="outlined" onClick={onVerifier}>Revérifier</Button>
              {aCorriger && <Button variant="outlined" onClick={onCorriger}>Corriger l'ID</Button>}
              {s.preuve && <Button variant="text" onClick={() => onVoir(s.preuve!)}>Voir la capture</Button>}
              {s.forcage_possible && peut("parametres") && <Button variant="text" color="error" onClick={onForcer}>Forcer</Button>}
              {s.a_confirmer && s.payee_par_moi && <Typography variant="caption" sx={{ alignSelf: "center" }}>Une autre personne confirme ce que vous avez payé.</Typography>}
            </>
          ) : (
            <>
              <Button variant="contained" onClick={onPayer}>J'ai payé</Button>
              {s.etat === "en_attente" && <Button variant="outlined" onClick={onPrendre}>Je m'en occupe</Button>}
              <Button variant="text" color="error" onClick={onRefuser}>Refuser</Button>
            </>
          )}
        </Stack>
      )}
    </Paper>
  );
}

const entier = (t: string) => { const n = Number(t.replace(/[^0-9]/g, "")); return t.trim() && Number.isSafeInteger(n) ? n : null; };
const ID_VALIDE = (t: string) => t.replace(/[^A-Za-z0-9]/g, "").length >= 6;

export function APayer() {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const { data } = useSorties(null);
  const { data: inexpliquees } = useSortiesNonExpliquees();
  const [aPayer, setAPayer] = useState<Sortie | null>(null);
  const [tx, setTx] = useState("");
  const [montant, setMontant] = useState("");
  const [fichier, setFichier] = useState<File | null>(null);
  const [aRefuser, setARefuser] = useState<Sortie | null>(null);
  const [motif, setMotif] = useState("");
  const [aCorriger, setACorriger] = useState<Sortie | null>(null);
  const [ancien, setAncien] = useState("");
  const [note, setNote] = useState("");
  const [aForcer, setAForcer] = useState<Sortie | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<unknown>(null);
  const [fait, setFait] = useState<{ texte: string; bon: boolean } | null>(null);
  const champFichier = useRef<HTMLInputElement>(null);

  const ouvertes = (data ?? []).filter((s) => s.mode === "manuel" && ["en_attente", "en_cours", "en_preuve"].includes(s.etat))
    .sort((a, b) => rang(a) - rang(b) || a.cree_le.localeCompare(b.cree_le));

  const fermer = () => { setAPayer(null); setARefuser(null); setACorriger(null); setAForcer(null); setTx(""); setMontant(""); setFichier(null); setMotif(""); setNote(""); setAncien(""); };
  const agir = async (geste: () => Promise<{ texte: string; bon: boolean }>) => {
    setEnCours(true); setErreur(null);
    try { setFait(await geste()); fermer(); await rafraichir(); }
    catch (e) { setErreur(e); } finally { setEnCours(false); }
  };
  const voir = async (chemin: string) => { try { window.open(await guichet.lienPreuve(chemin), "_blank", "noopener"); } catch (e) { setErreur(e); } };
  const ouvrirPaiement = (s: Sortie) => { setAPayer(s); setTx(""); setMontant(String(s.reste ?? s.montant_xaf)); setFichier(null); setErreur(null); };
  const nonProuves = (s: Sortie | null) => (s?.paiements_equipe ?? []).filter((p) => !p.retire_le && s?.rapprochement?.paiements?.find((x) => x.transaction_id === p.transaction_id)?.etat !== "concorde");
  const montantPaye = entier(montant);
  const resteAPayer = aPayer ? aPayer.reste ?? aPayer.montant_xaf : 0;
  const montantCorrige = montant.trim() ? entier(montant) : null;

  if (ouvertes.length === 0 && (inexpliquees ?? []).length === 0) return null;
  return (
    <Stack gap={2}>
      {ouvertes.length > 0 && (
        <Section titre={`À payer · ${ouvertes.filter((s) => s.etat !== "en_preuve").length}${ouvertes.some((s) => s.etat === "en_preuve") ? ` · en preuve · ${ouvertes.filter((s) => s.etat === "en_preuve").length}` : ""}`}>
          <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" } }}>
            {ouvertes.map((s) => (
              <Demande key={s.reference} s={s}
                onPayer={() => ouvrirPaiement(s)}
                onRefuser={() => { setARefuser(s); setMotif(""); setErreur(null); }}
                onPrendre={() => void agir(async () => { await guichet.prendreSortie(s.reference); return { texte: `${s.reference} : vous vous en occupez.`, bon: true }; })}
                onConfirmer={() => void agir(async () => dire(s.reference, await guichet.confirmerSortie(s.reference)))}
                onVerifier={() => void agir(async () => dire(s.reference, await guichet.verifierSortie(s.reference)))}
                onCorriger={() => { const p = nonProuves(s); setACorriger(s); setAncien(p[0]?.transaction_id ?? ""); setTx(""); setMontant(""); setNote(""); setErreur(null); }}
                onForcer={() => { setAForcer(s); setNote(""); setErreur(null); }}
                onVoir={(c) => void voir(c)} />
            ))}
          </Box>
        </Section>
      )}
      <Erreur erreur={!aPayer && !aRefuser && !aCorriger && !aForcer ? erreur : null} onFermer={() => setErreur(null)} />
      {fait && <Typography data-resultat variant="body2" sx={{ bgcolor: (fait.bon ? tones.green : tones.amber).bg, color: (fait.bon ? tones.green : tones.amber).fg, px: 2, py: 1, borderRadius: 3 }} onClick={() => setFait(null)}>{fait.texte}</Typography>}

      {(inexpliquees ?? []).length > 0 && (
        <Section titre="Sorti du float, sans sortie en face">
          <Tableau colonnes={["Puce", "Vers", { label: "Montant", align: "right" }, "Transaction ID", "Quand"]}
            lignes={(inexpliquees ?? []).map((k) => [
              `${k.operateur.toUpperCase()} ${k.float_numero ? numeroEnTranches(k.float_numero) : "?"} · ${k.terminal}`,
              k.numero ? numeroEnTranches(k.numero) : "—",
              k.montant != null ? `${xaf(k.montant)} XAF` : "—",
              <span key="t" style={{ fontFamily: "Roboto Mono, monospace" }}>{k.transaction_id ?? "—"}</span>,
              k.emis_le ? `${jourRelatif(k.emis_le)} ${heure(k.emis_le)}` : "—",
            ])} />
          <Typography variant="body2" sx={{ mt: 1 }}>Un paiement fait depuis la puce dont l'ID n'a été tapé sur aucune sortie. Si c'est un remboursement, tapez cet ID sur sa demande : la ligne disparaît d'ici.</Typography>
        </Section>
      )}

      <Dialogue ouvert={Boolean(aPayer)} titre={`${aPayer?.etat === "en_preuve" ? "Payer le reste de" : "J'ai payé"} ${aPayer?.reference ?? ""}`} onFermer={fermer} libelle="Enregistrer le paiement" enCours={enCours}
        desactive={!ID_VALIDE(tx) || montantPaye === null || montantPaye <= 0 || montantPaye > resteAPayer}
        onValider={() => aPayer && void agir(async () => {
          const chemin = fichier ? await guichet.deposerPreuve(aPayer.reference, fichier) : null;
          return dire(aPayer.reference, await guichet.payerSortie(aPayer.reference, tx, chemin, montantPaye));
        })}>
        {aPayer && (
          <>
            <Typography variant="body2">Vous avez envoyé au <b>{numeroEnTranches(aPayer.numero)}</b> ({OPERATEURS[aPayer.operateur]}), et l'opérateur affichait le nom <b>{aPayer.nom_beneficiaire}</b> ? {aPayer.etat === "en_preuve" ? <>Il reste <b>{xaf(resteAPayer)} XAF</b> à envoyer.</> : null}</Typography>
            {(aPayer.candidats ?? []).length > 0 && (
              <Stack gap={0.75}>
                <Typography variant="caption">La puce a relevé ces paiements vers ce numéro : touchez le vôtre.</Typography>
                <Stack direction="row" gap={1} flexWrap="wrap">
                  {(aPayer.candidats ?? []).map((k) => (
                    <Chip key={k.id} data-candidat={k.transaction_id} variant={tx === k.transaction_id ? "filled" : "outlined"}
                      label={`${k.emis_le ? heure(k.emis_le) : "—"} · ${k.transaction_id} · ${k.montant != null ? xaf(k.montant) : "?"} XAF`}
                      onClick={() => { setTx(k.transaction_id); if (k.montant != null) setMontant(String(k.montant)); }} />
                  ))}
                </Stack>
              </Stack>
            )}
            <TextField label="Transaction ID (du SMS de l'opérateur)" value={tx} onChange={(e) => setTx(e.target.value)} fullWidth autoFocus
              slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "characters", style: { fontFamily: "Roboto Mono, monospace" } } }} />
            <TextField label="Montant de ce paiement (XAF)" value={montant} onChange={(e) => setMontant(e.target.value)} fullWidth
              error={montantPaye !== null && (montantPaye <= 0 || montantPaye > resteAPayer)}
              helperText={montantPaye !== null && montantPaye > resteAPayer ? `${xaf(resteAPayer)} XAF au plus` : "Un seul transfert si l'opérateur le permet ; sinon payez en plusieurs fois et tapez chaque ID"}
              slotProps={{ htmlInput: { inputMode: "numeric" } }} />
            <input ref={champFichier} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden onChange={(e) => setFichier(e.target.files?.[0] ?? null)} />
            <Button variant="outlined" startIcon={<AttachFileRounded />} onClick={() => champFichier.current?.click()} sx={{ alignSelf: "flex-start" }}>
              {fichier ? fichier.name : "Joindre la capture (facultatif)"}
            </Button>
            <Typography variant="caption">Les XAFe du client ne sont détruits que lorsque le SMS de la puce montre ce paiement : même ID, même montant, même numéro. Sans lui, la demande reste « en preuve ». Un paiement enregistré ne se refuse plus.</Typography>
            <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
          </>
        )}
      </Dialogue>

      <Dialogue ouvert={Boolean(aCorriger)} titre={`Corriger un paiement de ${aCorriger?.reference ?? ""}`} onFermer={fermer} libelle="Remplacer" enCours={enCours}
        desactive={!ancien || !ID_VALIDE(tx) || note.trim().length < 3 || (montant.trim() !== "" && (montantCorrige === null || montantCorrige <= 0))}
        onValider={() => aCorriger && void agir(async () => dire(aCorriger.reference, await guichet.corrigerPaiement(aCorriger.reference, ancien, tx, note, montantCorrige)))}>
        {aCorriger && (
          <>
            <Typography variant="body2">Un ID ou un montant mal tapé : l'ancien reste au journal, barré. Un paiement que le SMS de la puce montre déjà ne se corrige pas.</Typography>
            <TextField select label="Paiement à corriger" value={ancien} onChange={(e) => setAncien(e.target.value)} fullWidth>
              {nonProuves(aCorriger).map((p) => <MenuItem key={p.transaction_id} value={p.transaction_id}>{p.transaction_id} · {xaf(p.montant)} XAF</MenuItem>)}
            </TextField>
            <TextField label="Le bon transaction ID" value={tx} onChange={(e) => setTx(e.target.value)} fullWidth autoFocus
              slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "characters", style: { fontFamily: "Roboto Mono, monospace" } } }} />
            <TextField label="Le bon montant (XAF, facultatif)" value={montant} onChange={(e) => setMontant(e.target.value)} fullWidth
              helperText="Vide : le montant ne change pas" slotProps={{ htmlInput: { inputMode: "numeric" } }} />
            <TextField label="Ce qui était mal tapé" value={note} onChange={(e) => setNote(e.target.value)} fullWidth />
            <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
          </>
        )}
      </Dialogue>

      <Dialogue ouvert={Boolean(aForcer)} titre={`Forcer ${aForcer?.reference ?? ""}`} onFermer={fermer} libelle="Clore sans le SMS" couleur="error" enCours={enCours} desactive={note.trim().length < 10}
        onValider={() => aForcer && void agir(async () => {
          const r = await guichet.forcerSortie(aForcer.reference, note);
          return r.etat === "envoyee" ? { texte: `${aForcer.reference} clôturée sans le SMS de la puce : c'est au journal, et une alerte est levée.`, bon: false } : dire(aForcer.reference, r);
        })}>
        <Alert severity="error" sx={{ borderRadius: 3 }}>Les XAFe seront détruits SANS le SMS de la puce. Réservé au cas où le paiement est prouvé autrement (relevé de l'opérateur). L'action est journalisée et lève une alerte.</Alert>
        <TextField label="Comment le paiement est prouvé" value={note} onChange={(e) => setNote(e.target.value)} fullWidth multiline minRows={2} />
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>

      <Dialogue ouvert={Boolean(aRefuser)} titre={`Refuser ${aRefuser?.reference ?? ""}`} onFermer={fermer} libelle="Refuser et rendre les XAFe" couleur="error" enCours={enCours} desactive={motif.trim().length < 3}
        onValider={() => aRefuser && void agir(async () => { await guichet.refuserSortie(aRefuser.reference, motif); return { texte: `${aRefuser.reference} refusée : ${xaf(aRefuser.montant)} XAFe revenus au client, prévenu par notification et e-mail.`, bon: true }; })}>
        <Typography variant="body2">Seulement si rien n'a été payé. Les {aRefuser ? xaf(aRefuser.montant) : ""} XAFe reviennent au client ; il lit le motif.</Typography>
        <Stack direction="row" gap={1} flexWrap="wrap">
          {MOTIFS.map((m) => <Chip key={m} label={m} onClick={() => setMotif(m)} variant={motif === m ? "filled" : "outlined"} sx={{ maxWidth: "100%", height: "auto", "& .MuiChip-label": { whiteSpace: "normal", py: 0.5 } }} />)}
        </Stack>
        <TextField label="Motif (montré au client)" value={motif} onChange={(e) => setMotif(e.target.value)} fullWidth multiline minRows={2} />
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>
    </Stack>
  );
}
