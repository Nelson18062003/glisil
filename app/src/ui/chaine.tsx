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
import { etatDeTrace, hashCourt, lienTransaction, NOMS_RESEAUX } from "../noyau/chaine";
import { tones } from "../theme";
import { Card, JetonXafe, Line } from "./index";

export function SurLaChaine({ traces }: { traces: TraceChaine[] | undefined }) {
  const [explique, setExplique] = useState(false);
  if (!traces?.length) return null;
  return (
    <>
      {traces.map((t) => {
        const e = etatDeTrace(t);
        const lien = lienTransaction(t.explorateur, t.reseau, t.txHash);
        return (
          <Card key={`${t.reseau}:${t.reference}`} sx={{ gap: 1.25 }}>
            <Stack direction="row" alignItems="center" gap={1.5} data-chaine={t.etat}>
              <JetonXafe size={40} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle1" component="h2" sx={{ lineHeight: 1.25 }}>Sur la blockchain</Typography>
                <Chip size="small" label={e.titre} sx={{ mt: 0.5, height: 22, bgcolor: tones[e.ton].bg, color: tones[e.ton].fg, fontWeight: 600, maxWidth: "100%" }} />
              </Box>
              <IconButton aria-label="Qu'est-ce que c'est ?" onClick={() => setExplique((x) => !x)} size="small"><InfoOutlined /></IconButton>
            </Stack>
            <Collapse in={explique}>
              <Typography variant="body2" sx={{ bgcolor: "background.default", p: 1.5, borderRadius: 3 }}>
                Le XAFe est un jeton sur la blockchain : chaque XAFe crédité sur votre compte y est créé, au même instant, par le contrat XAFe, dans la réserve de Glisil. 1 XAFe = 1 XAF, et le total sur la blockchain vaut toujours ce que Glisil doit à ses clients —{" "}
                <LienMui component={Link} to="/preuve">la preuve est publique</LienMui>.
              </Typography>
            </Collapse>
            <Typography variant="body2">{e.phrase}</Typography>
            <Line label="Réseau" value={`${NOMS_RESEAUX[t.reseau].nom}${t.essai ? " · essai" : ""}`} />
            <Line label="Transaction" value={t.txHash ? hashCourt(t.txHash) : "pas encore signée"} mono />
            {t.bloc != null && <Line label="Bloc" value={t.bloc.toLocaleString("fr-FR")} />}
            <Line label="Référence scellée" value={t.reference} mono />
            {lien && (
              <Button variant="outlined" href={lien} target="_blank" rel="noreferrer" endIcon={<OpenInNewRounded />}>
                Voir sur {NOMS_RESEAUX[t.reseau].explorateur}
              </Button>
            )}
            {t.essai && <Typography variant="caption">Réseau d'essai : sur la blockchain, ces jetons n'ont pas encore de valeur ; votre solde Glisil, lui, est réel.</Typography>}
          </Card>
        );
      })}
    </>
  );
}
