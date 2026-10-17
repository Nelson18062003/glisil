/*
 * LA PREUVE DE RÉSERVE — publique, sans compte. 1 XAFe = 1 XAF se dit
 * partout ; ici, il se VÉRIFIE, à trois colonnes qui ne se connaissent pas :
 *   les floats   l'argent posé chez MTN et Orange, tel que l'opérateur l'annonce ;
 *   le registre  ce que Glisil doit à ses clients ;
 *   la chaîne    les XAFe qui existent sur la blockchain, relus transaction par transaction.
 * Puis chaque transaction, avec son lien dans l'explorateur : n'importe qui
 * peut refaire le calcul sans croire Glisil sur parole. Aucun nom, aucun
 * numéro de client — des totaux et des transactions déjà publiques.
 */
import OpenInNewRounded from "@mui/icons-material/OpenInNewRounded";
import { Box, Button, Chip, Link as LienMui, Paper, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { Link } from "react-router-dom";
import { usePreuve } from "../../guichet";
import type { LignePreuve, PreuveDeReserve, StatutParite } from "../../guichet/types";
import { operateur as opDe } from "../../noyau/argent";
import { hashCourt, lienContrat, lienTransaction, NOMS_RESEAUX } from "../../noyau/chaine";
import { enTranches, quand, xaf } from "../../noyau/format";
import { tones, type Tone } from "../../theme";
import { Badge, Card, JetonXafe, Line, Marque, NomGlisil, Squelette } from "../../ui";

const STATUTS: Record<StatutParite, { tone: Tone; titre: string; phrase: string }> = {
  juste: { tone: "green", titre: "La parité tient, au franc près", phrase: "Chaque XAFe dû existe sur la blockchain, et l'argent posé chez les opérateurs le couvre." },
  en_cours: { tone: "green", titre: "La parité tient", phrase: "Quelques opérations sont en route vers la blockchain : elles y entrent en général en moins d'une minute." },
  ecart: { tone: "red", titre: "Un écart est en cours d'examen", phrase: "Une opération ne se rapproche pas encore. L'équipe est alertée ; cette page le montre tant que ce n'est pas résolu." },
  incomplet: { tone: "amber", titre: "Vérification incomplète", phrase: "Une des trois colonnes n'est pas encore à jour : le relevé reprend dans quelques minutes." },
};
const VERDICTS: Record<LignePreuve["verdict"], { label: string; tone: Tone }> = {
  concorde: { label: "vérifiée", tone: "green" }, en_route: { label: "en route", tone: "blue" }, en_retard: { label: "en retard", tone: "amber" },
  refusee: { label: "refusée", tone: "red" }, ecart: { label: "écart", tone: "red" }, inconnue: { label: "inexpliquée", tone: "red" },
};

/** Un montant de jeton : entier s'il l'est, sinon jusqu'aux six décimales de la chaîne. */
const jeton = (n: number | null | undefined) => (n == null ? "—" : Number.isInteger(n) ? xaf(n) : enTranches(n, 6).replace(/0+$/, ""));

function Colonne({ numero, titre, phrase, valeur, unite, tone, children }: { numero: number; titre: string; phrase: string; valeur: string; unite: string; tone: Tone; children?: React.ReactNode }) {
  return (
    <Card sx={{ flex: "1 1 260px", minWidth: 0, gap: 1, borderTop: 6, borderColor: tones[tone].fg }}>
      <Typography variant="overline" sx={{ letterSpacing: 1.2, lineHeight: 1.4, color: "text.secondary" }}>{numero} · {titre}</Typography>
      <Typography variant="body2">{phrase}</Typography>
      <Typography variant="h4" component="p" sx={{ fontVariantNumeric: "tabular-nums", fontSize: valeur.length > 12 ? 26 : 32 }} data-colonne={titre}>
        {valeur} <Typography component="span" variant="h6" color="text.secondary">{unite}</Typography>
      </Typography>
      <Stack gap={1}>{children}</Stack>
    </Card>
  );
}

function Historique({ p }: { p: PreuveDeReserve }) {
  if (!p.historique.length) return null;
  const justes = p.historique.filter((h) => h.statut === "juste" || h.statut === "en_cours").length;
  return (
    <Card sx={{ gap: 1 }}>
      <Typography variant="subtitle1" component="h2">Les sept derniers jours</Typography>
      <Typography variant="body2">{justes} relevé{justes > 1 ? "s" : ""} horaire{justes > 1 ? "s" : ""} juste{justes > 1 ? "s" : ""} sur {p.historique.length}.</Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: "3px" }} aria-hidden>
        {p.historique.map((h) => {
          const t = STATUTS[h.statut].tone;
          return <Box key={h.fait_le} title={`${quand(h.fait_le)} · ${STATUTS[h.statut].titre}`} sx={{ width: 10, height: 18, borderRadius: 1, bgcolor: t === "green" ? "primary.main" : tones[t].fg, opacity: t === "green" ? 0.85 : 1 }} />;
        })}
      </Box>
    </Card>
  );
}

function Transactions({ p }: { p: PreuveDeReserve }) {
  const [toutes, setToutes] = useState(false);
  const lignes = toutes ? p.lignes : p.lignes.slice(0, 12);
  return (
    <Card sx={{ gap: 0.5, p: { xs: 1.5, sm: 2.5 } }}>
      <Typography variant="subtitle1" component="h2" sx={{ px: 1 }}>Chaque opération, et sa transaction</Typography>
      <Typography variant="body2" sx={{ px: 1, mb: 1 }}>Un dépôt crédité crée des XAFe ; un retrait payé en détruit. La référence de l'opération est scellée dans la transaction.</Typography>
      {lignes.length === 0 && <Typography variant="body2" sx={{ px: 1, py: 2 }}>Aucune opération encore.</Typography>}
      {lignes.map((l, i) => {
        const c = p.contrats.find((x) => x.reseau === l.reseau);
        const lien = lienTransaction(c?.explorateur, l.reseau, l.tx_vu);
        const v = VERDICTS[l.verdict];
        const signe = l.genre === "frappe" ? "+" : "−";
        return (
          <Stack key={`${l.reference}-${i}`} direction="row" alignItems="center" gap={1.5} data-ligne={l.verdict}
            sx={{ px: 1, py: 1.25, borderTop: i ? 1 : 0, borderColor: "divider" }}>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography fontWeight={600} sx={{ fontFamily: "Roboto Mono, monospace", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }}>{l.reference ?? "sans référence"}</Typography>
              <Typography variant="caption" component="div">
                {l.genre === "frappe" ? "Création" : "Destruction"} · {NOMS_RESEAUX[l.reseau].nom} · {quand(l.depuis)}
              </Typography>
              {lien && <LienMui href={lien} target="_blank" rel="noreferrer" sx={{ fontFamily: "Roboto Mono, monospace", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 0.5 }}>{hashCourt(l.tx_vu)} <OpenInNewRounded sx={{ fontSize: 13 }} /></LienMui>}
            </Box>
            <Stack alignItems="flex-end" gap={0.5} sx={{ flexShrink: 0 }}>
              <Typography fontWeight={600} sx={{ fontVariantNumeric: "tabular-nums", color: l.genre === "frappe" ? "primary.main" : "text.primary" }}>{signe}{jeton(l.montant ?? l.montant_vu)}</Typography>
              <Chip size="small" label={v.label} sx={{ height: 22, bgcolor: tones[v.tone].bg, color: tones[v.tone].fg, fontWeight: 600 }} />
            </Stack>
          </Stack>
        );
      })}
      {p.lignes.length > 12 && !toutes && <Button onClick={() => setToutes(true)}>Voir les {p.lignes.length} opérations</Button>}
    </Card>
  );
}

export function Preuve() {
  const { data: p, error, refetch } = usePreuve();
  const r = p?.releve ?? null;
  const s = r ? STATUTS[r.statut] : null;
  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default", pb: "calc(32px + env(safe-area-inset-bottom))" }}>
      <Box sx={{ maxWidth: 1080, mx: "auto", px: 2, pt: "calc(16px + env(safe-area-inset-top))", display: "flex", flexDirection: "column", gap: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ minHeight: 56 }}>
          <Stack direction="row" alignItems="center" gap={1.25} component={Link} to="/" sx={{ textDecoration: "none", color: "inherit" }}>
            <Marque size={36} />
            <NomGlisil size={24} />
          </Stack>
          <Button component={Link} to="/" variant="text">Ouvrir l'application</Button>
        </Stack>

        <Stack gap={1} sx={{ mt: 1 }}>
          <Stack direction="row" alignItems="center" gap={1.5}>
            <JetonXafe size={44} />
            <Typography variant="h4" component="h1">Preuve de réserve</Typography>
          </Stack>
          <Typography variant="body1" sx={{ maxWidth: 720 }}>
            1 XAFe = 1 XAF. Chaque XAFe crédité à un client existe sur la blockchain, et l'argent posé chez les opérateurs le couvre. Cette page le montre à tout le monde, et dit comment le vérifier sans nous croire sur parole.
          </Typography>
        </Stack>

        {!p && !error && <><Squelette hauteur={140} /><Squelette hauteur={260} /></>}
        {!p && error && (
          <Card>
            <Typography variant="body1">La preuve ne se lit pas pour le moment.</Typography>
            <Button variant="contained" onClick={() => void refetch()}>Réessayer</Button>
          </Card>
        )}

        {p && p.essai && (
          <Paper sx={{ p: 2, borderRadius: 5, bgcolor: tones.amber.bg, color: tones.amber.fg }}>
            <Typography variant="body2" sx={{ color: "inherit" }}><b>Réseau d'essai.</b> Les contrats XAFe tournent encore sur les réseaux de test de la BNB Smart Chain et de Tron : sur la blockchain, ces jetons n'ont pas encore de valeur. La méthode, elle, est celle du vrai réseau.</Typography>
          </Paper>
        )}

        {p && !r && <Card><Typography variant="body1">Le premier relevé se fait dans les cinq minutes qui suivent la mise en service.</Typography></Card>}

        {p && r && s && (
          <>
            <Paper data-statut={r.statut} sx={{ p: { xs: 2.5, sm: 3.5 }, borderRadius: 7, bgcolor: tones[s.tone].bg, color: tones[s.tone].fg }}>
              <Typography variant="h5" component="h2" sx={{ fontWeight: 700, color: "inherit" }}>{s.titre}</Typography>
              <Typography variant="body1" sx={{ mt: 0.75, color: "inherit", maxWidth: 760 }}>{s.phrase}</Typography>
              <Typography variant="caption" sx={{ display: "block", mt: 1, color: "inherit", opacity: 0.8 }}>Relevé {quand(r.fait_le)} · refait toutes les cinq minutes</Typography>
            </Paper>

            <Stack direction="row" gap={2} flexWrap="wrap">
              <Colonne numero={1} titre="Les floats" phrase="L'argent posé chez MTN et Orange, tel que l'opérateur l'annonce." valeur={r.floats != null ? xaf(r.floats) : "non connu"} unite={r.floats != null ? "XAF" : ""}
                tone={r.couverture == null ? "amber" : r.couverture >= 0 ? "green" : "red"}>
                {(r.floats_detail ?? []).map((f) => (
                  <Stack key={f.operateur} direction="row" alignItems="center" gap={1}>
                    <Badge kind={f.operateur} size={28} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Line label={opDe(f.operateur).nom} value={f.solde != null ? `${xaf(f.solde)} XAF` : "—"} />
                      {f.annonce_le && <Typography variant="caption">annoncé {quand(f.annonce_le)}</Typography>}
                    </Box>
                  </Stack>
                ))}
                {r.couverture != null && <Typography variant="caption">{r.couverture >= 0 ? `${xaf(r.couverture)} XAF de plus que ce qui est dû : les frais gagnés et les fonds propres de Glisil.` : `Il manque ${xaf(-r.couverture)} XAF.`}</Typography>}
              </Colonne>
              <Colonne numero={2} titre="Le registre" phrase="Ce que Glisil doit à ses clients : chaque XAFe crédité, moins chaque XAFe payé." valeur={xaf(r.registre)} unite="XAFe" tone="blue">
                <Line label="dans les comptes Glisil" value={xaf(r.dans_comptes)} />
                <Line label="sur les wallets des clients" value={xaf(r.sur_wallets)} />
              </Colonne>
              <Colonne numero={3} titre="La blockchain" phrase="Les XAFe qui existent, relus transaction par transaction." valeur={r.chaine != null ? jeton(r.chaine) : "en lecture"} unite={r.chaine != null ? "XAFe" : ""}
                tone={r.ecart == null ? "amber" : r.ecart === 0 ? "green" : "red"}>
                {r.reseaux.map((n) => {
                  const c = p.contrats.find((x) => x.reseau === n.reseau);
                  const lien = lienContrat(c?.explorateur, n.reseau, c?.contrat);
                  return (
                    <Box key={n.reseau}>
                      <Line label={NOMS_RESEAUX[n.reseau].nom} value={n.offre != null ? `${jeton(n.offre)} XAFe` : "en lecture"} />
                      {lien && <LienMui href={lien} target="_blank" rel="noreferrer" variant="caption" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>le contrat sur {NOMS_RESEAUX[n.reseau].explorateur} <OpenInNewRounded sx={{ fontSize: 12 }} /></LienMui>}
                    </Box>
                  );
                })}
                {r.en_route !== 0 && <Line label="en route" value={`${r.en_route > 0 ? "+" : "−"}${jeton(Math.abs(r.en_route))}`} />}
                <Line label="Écart avec le registre" value={r.ecart == null ? "—" : `${jeton(r.ecart)} XAFe`} strong color={r.ecart === 0 ? tones.green.fg : undefined} />
              </Colonne>
            </Stack>

            <Historique p={p} />
            <Transactions p={p} />

            <Card sx={{ gap: 1 }}>
              <Typography variant="subtitle1" component="h2">Le vérifier vous-même</Typography>
              <Box component="ol" sx={{ m: 0, pl: 2.5, "& li": { mb: 1 } }}>
                <li><Typography variant="body2">Ouvrez le contrat XAFe dans l'explorateur ({p.contrats.map((c, i) => <span key={c.reseau}>{i ? " · " : ""}<LienMui href={lienContrat(c.explorateur, c.reseau, c.contrat) ?? undefined} target="_blank" rel="noreferrer">{NOMS_RESEAUX[c.reseau].nom}</LienMui></span>)}) : son « total supply » est la colonne 3.</Typography></li>
                <li><Typography variant="body2">Chaque transaction porte une <b>empreinte</b> : le keccak256 du texte de la référence (« XAFe-DP-000003 »). Le contrat refuse de créer deux fois des XAFe sous la même.</Typography></li>
                <li><Typography variant="body2">Chaque client retrouve dans son reçu PDF la transaction qui a créé ses XAFe, et un code à scanner qui l'ouvre.</Typography></li>
              </Box>
            </Card>
          </>
        )}

        <Typography variant="caption" sx={{ textAlign: "center", mt: 1 }}>
          Glisil · <LienMui component={Link} to="/conditions">Conditions</LienMui> · <LienMui component={Link} to="/confidentialite">Confidentialité</LienMui>
        </Typography>
      </Box>
    </Box>
  );
}
