/*
 * Les remboursements payés à la main (0014). Le client a demandé ; ses XAFe
 * sont déjà mis de côté. Ici, l'équipe :
 *   1. lit ce qu'il faut envoyer, à qui, et au nom de qui ;
 *   2. paie depuis la puce (TOTEM), en vérifiant le nom que l'opérateur affiche ;
 *   3. tape le transaction ID du SMS et joint la capture ;
 *   4. au-delà du seuil, une AUTRE personne confirme.
 * Le SMS que la puce reçoit pour ce paiement se rapproche tout seul : même ID,
 * même montant, même numéro. Ce que la puce voit partir sans sortie en face
 * se montre en bas : de l'argent sorti du float que rien n'explique.
 */
import AttachFileRounded from "@mui/icons-material/AttachFileRounded";
import CheckRounded from "@mui/icons-material/CheckRounded";
import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded";
import { Alert, Box, Button, Chip, IconButton, Paper, Stack, TextField, Typography } from "@mui/material";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useGuichet, useRafraichir, useSorties, useSortiesNonExpliquees } from "../guichet";
import type { Rapprochement, Sortie } from "../guichet/types";
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

export function PuceDit({ r }: { r: Rapprochement | null | undefined }) {
  if (!r) return null;
  const t = r.etat === "concorde" ? { label: "SMS de la puce : concorde", tone: tones.green }
    : r.etat === "ecart" ? { label: `SMS de la puce : écart${r.montant != null ? ` · ${xaf(r.montant)} XAF` : ""}${r.numero ? ` · ${numeroEnTranches(r.numero)}` : ""}`, tone: tones.red }
    : { label: "SMS de la puce : pas encore reçu", tone: tones.amber };
  return <Chip size="small" label={t.label} title={r.texte ?? undefined} sx={{ height: 24, bgcolor: t.tone.bg, color: t.tone.fg, fontWeight: 600, alignSelf: "flex-start" }} />;
}

function Demande({ s, onPayer, onRefuser, onPrendre, onConfirmer, onVoir }: {
  s: Sortie; onPayer: () => void; onRefuser: () => void; onPrendre: () => void; onConfirmer: () => void; onVoir: (chemin: string) => void;
}) {
  const { peut } = useSession();
  const op = OPERATEURS[s.operateur] ?? s.operateur.toUpperCase();
  const proches = nomsProches(s.nom_beneficiaire, s.compte.nom);
  return (
    <Paper data-demande={s.reference} sx={{ p: 2, borderRadius: 5, display: "flex", flexDirection: "column", gap: 1.25, border: 1, borderColor: s.a_confirmer ? tones.blue.fg : "divider" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
        <Typography fontFamily="Roboto Mono, monospace" fontWeight={600}>{s.reference}</Typography>
        <Chip size="small" label={s.a_confirmer ? "à confirmer" : s.pris_par ? `prise par ${s.pris_par}` : "à payer"}
          sx={{ height: 24, fontWeight: 600, bgcolor: (s.a_confirmer ? tones.blue : s.pris_par ? tones.neutral : tones.amber).bg, color: (s.a_confirmer ? tones.blue : s.pris_par ? tones.neutral : tones.amber).fg }} />
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
      {s.a_confirmer && (
        <Stack gap={0.75}>
          <Typography variant="body2">Payée par <b>{s.payee_par}</b> · ID <span style={{ fontFamily: "Roboto Mono, monospace" }}>{s.transaction_id}</span></Typography>
          <PuceDit r={s.rapprochement} />
        </Stack>
      )}
      {peut("sorties") && (
        <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 0.5 }}>
          {s.a_confirmer ? (
            <>
              <Button variant="contained" onClick={onConfirmer} disabled={s.payee_par_moi}>Confirmer le paiement</Button>
              {s.preuve && <Button variant="outlined" onClick={() => onVoir(s.preuve!)}>Voir la capture</Button>}
              {s.payee_par_moi && <Typography variant="caption" sx={{ alignSelf: "center" }}>Une autre personne confirme ce que vous avez payé.</Typography>}
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

export function APayer() {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const { data } = useSorties(null);
  const { data: inexpliquees } = useSortiesNonExpliquees();
  const [aPayer, setAPayer] = useState<Sortie | null>(null);
  const [tx, setTx] = useState("");
  const [fichier, setFichier] = useState<File | null>(null);
  const [aRefuser, setARefuser] = useState<Sortie | null>(null);
  const [motif, setMotif] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<unknown>(null);
  const [fait, setFait] = useState<string | null>(null);
  const champFichier = useRef<HTMLInputElement>(null);

  const ouvertes = (data ?? []).filter((s) => s.mode === "manuel" && (s.etat === "en_attente" || s.etat === "en_cours"))
    .sort((a, b) => Number(Boolean(b.a_confirmer)) - Number(Boolean(a.a_confirmer)) || a.cree_le.localeCompare(b.cree_le));

  const agir = async (geste: () => Promise<string>) => {
    setEnCours(true); setErreur(null);
    try { setFait(await geste()); setAPayer(null); setARefuser(null); setTx(""); setFichier(null); setMotif(""); await rafraichir(); }
    catch (e) { setErreur(e); } finally { setEnCours(false); }
  };
  const direPuce = (r: Rapprochement | null | undefined) =>
    r?.etat === "concorde" ? " Le SMS de la puce concorde." : r?.etat === "ecart" ? " Attention : le SMS de la puce dit autre chose." : " Le SMS de la puce n'est pas encore arrivé.";
  const voir = async (chemin: string) => { try { window.open(await guichet.lienPreuve(chemin), "_blank", "noopener"); } catch (e) { setErreur(e); } };

  if (ouvertes.length === 0 && (inexpliquees ?? []).length === 0) return null;
  return (
    <Stack gap={2}>
      {ouvertes.length > 0 && (
        <Section titre={`À payer · ${ouvertes.length}`}>
          <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))", xl: "repeat(3, minmax(0, 1fr))" } }}>
            {ouvertes.map((s) => (
              <Demande key={s.reference} s={s}
                onPayer={() => { setAPayer(s); setTx(""); setFichier(null); setErreur(null); }}
                onRefuser={() => { setARefuser(s); setMotif(""); setErreur(null); }}
                onPrendre={() => void agir(async () => { await guichet.prendreSortie(s.reference); return `${s.reference} : vous vous en occupez.`; })}
                onConfirmer={() => void agir(async () => { const r = await guichet.confirmerSortie(s.reference); return `${s.reference} confirmée : les XAFe sont détruits, le client est prévenu.${direPuce(r.rapprochement)}`; })}
                onVoir={(c) => void voir(c)} />
            ))}
          </Box>
        </Section>
      )}
      <Erreur erreur={!aPayer && !aRefuser ? erreur : null} onFermer={() => setErreur(null)} />
      {fait && <Typography variant="body2" sx={{ bgcolor: tones.green.bg, color: tones.green.fg, px: 2, py: 1, borderRadius: 3 }} onClick={() => setFait(null)}>{fait}</Typography>}

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

      <Dialogue ouvert={Boolean(aPayer)} titre={`J'ai payé ${aPayer?.reference ?? ""}`} onFermer={() => setAPayer(null)} libelle="Enregistrer le paiement" enCours={enCours}
        desactive={tx.replace(/[^A-Za-z0-9]/g, "").length < 6}
        onValider={() => aPayer && void agir(async () => {
          const chemin = fichier ? await guichet.deposerPreuve(aPayer.reference, fichier) : null;
          const r = await guichet.payerSortie(aPayer.reference, tx, chemin);
          return r.a_confirmer
            ? `${aPayer.reference} payée : elle attend qu'une autre personne confirme.${direPuce(r.rapprochement)}`
            : `${aPayer.reference} payée : les XAFe sont détruits, le client est prévenu avec l'ID.${direPuce(r.rapprochement)}`;
        })}>
        {aPayer && (
          <>
            <Typography variant="body2">Vous avez envoyé <b>{xaf(aPayer.montant_xaf)} XAF</b> au <b>{numeroEnTranches(aPayer.numero)}</b> ({OPERATEURS[aPayer.operateur]}), et l'opérateur affichait le nom <b>{aPayer.nom_beneficiaire}</b> ?</Typography>
            <TextField label="Transaction ID (du SMS de l'opérateur)" value={tx} onChange={(e) => setTx(e.target.value)} fullWidth autoFocus
              slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "characters", style: { fontFamily: "Roboto Mono, monospace" } } }} />
            <input ref={champFichier} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden onChange={(e) => setFichier(e.target.files?.[0] ?? null)} />
            <Button variant="outlined" startIcon={<AttachFileRounded />} onClick={() => champFichier.current?.click()} sx={{ alignSelf: "flex-start" }}>
              {fichier ? fichier.name : "Joindre la capture (facultatif)"}
            </Button>
            <Typography variant="caption">Une fois enregistré, le paiement ne s'annule plus. Les XAFe du client sont détruits tout de suite, ou, au-delà du seuil fixé dans Paramètres, quand une autre personne a confirmé.</Typography>
            <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
          </>
        )}
      </Dialogue>

      <Dialogue ouvert={Boolean(aRefuser)} titre={`Refuser ${aRefuser?.reference ?? ""}`} onFermer={() => setARefuser(null)} libelle="Refuser et rendre les XAFe" couleur="error" enCours={enCours} desactive={motif.trim().length < 3}
        onValider={() => aRefuser && void agir(async () => { await guichet.refuserSortie(aRefuser.reference, motif); return `${aRefuser.reference} refusée : ${xaf(aRefuser.montant)} XAFe revenus au client.`; })}>
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
