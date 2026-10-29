/*
 * « Sur la blockchain » : la transaction qui a créé (ou détruit) ces XAFe,
 * dite à un client. L'état d'abord, en une phrase ; puis ce qui se vérifie —
 * le réseau, la transaction, le bloc, la référence scellée — et le bouton qui
 * l'ouvre dans l'explorateur. Personne n'a à croire l'écran sur parole.
 */
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import OpenInNewRounded from "@mui/icons-material/OpenInNewRounded";
import { Box, Button, Chip, Collapse, IconButton, Link as LienMui, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { TraceChaine } from "../guichet/types";
import { etatDeTrace, hashCourt, lienTransaction, nomsReseau } from "../noyau/chaine";
import { enTranches } from "../noyau/format";
import { t } from "../noyau/langue";
import { tones } from "../theme";
import { Card, JetonXafe, Line } from "./index";

export function SurLaChaine({ traces }: { traces: TraceChaine[] | undefined }) {
  const [explique, setExplique] = useState(false);
  if (!traces?.length) return null;
  return (
    <>
      {traces.map((trace) => {
        const e = etatDeTrace(trace);
        const lien = lienTransaction(trace.explorateur, trace.reseau, trace.txHash);
        return (
          <Card key={`${trace.reseau}:${trace.reference}`} sx={{ gap: 1.25 }}>
            <Stack direction="row" alignItems="center" gap={1.5} data-chaine={trace.etat}>
              <JetonXafe size={40} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle1" component="h2" sx={{ lineHeight: 1.25 }}>{t("Sur la blockchain", "On the blockchain")}</Typography>
                <Chip size="small" label={e.titre} sx={{ mt: 0.5, height: 22, bgcolor: tones[e.ton].bg, color: tones[e.ton].fg, fontWeight: 600, maxWidth: "100%" }} />
              </Box>
              <IconButton aria-label={t("Qu'est-ce que c'est ?", "What is this?")} onClick={() => setExplique((x) => !x)} size="small"><InfoOutlined /></IconButton>
            </Stack>
            <Collapse in={explique}>
              <Typography variant="body2" sx={{ bgcolor: "background.default", p: 1.5, borderRadius: 3 }}>
                {t("Le XAFe est un jeton sur la blockchain : chaque XAFe crédité sur votre compte y est créé, au même instant, par le contrat XAFe, dans la réserve de Glisil — une réserve que le contrat tient lui-même et que personne ne peut en sortir. 1 XAFe = 1 XAF, et le total sur la blockchain vaut toujours ce que Glisil doit à ses clients —",
                  "XAFe is a token on the blockchain: every XAFe credited to your account is minted there at the same moment, by the XAFe contract, in Glisil's reserve — a reserve the contract holds itself, which no one can move out of it. 1 XAFe = 1 XAF, and the total on the blockchain always equals what Glisil owes its customers —")}{" "}
                <LienMui component={Link} to="/preuve">{t("la preuve est publique", "the proof is public")}</LienMui>.
              </Typography>
            </Collapse>
            <Typography variant="body2">{e.phrase}</Typography>
            <Line label={t("Réseau", "Network")} value={`${nomsReseau(trace.reseau).nom}${trace.essai ? t(" · essai", " · test") : ""}`} />
            <Line label={t("Transaction", "Transaction")} value={trace.txHash ? hashCourt(trace.txHash) : t("pas encore signée", "not signed yet")} mono />
            {trace.bloc != null && <Line label={t("Bloc", "Block")} value={enTranches(trace.bloc)} />}
            <Line label={t("Référence scellée", "Sealed reference")} value={trace.reference} mono />
            {lien && (
              <Button variant="outlined" href={lien} target="_blank" rel="noreferrer" endIcon={<OpenInNewRounded />}>
                {t(`Voir sur ${nomsReseau(trace.reseau).explorateur}`, `View on ${nomsReseau(trace.reseau).explorateur}`)}
              </Button>
            )}
            {trace.essai && <Typography variant="caption">{t("Réseau d'essai : sur la blockchain, ces jetons n'ont pas encore de valeur ; votre solde Glisil, lui, est réel.", "Test network: on the blockchain, these tokens have no value yet; your Glisil balance, however, is real.")}</Typography>}
          </Card>
        );
      })}
    </>
  );
}
