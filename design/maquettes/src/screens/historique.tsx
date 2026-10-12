import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import DownloadRounded from "@mui/icons-material/DownloadRounded";
import SwapHorizRounded from "@mui/icons-material/SwapHorizRounded";
import { Box, Button, Typography } from "@mui/material";
import { tones } from "../theme";
import { Card, Chips, Line, List, Row, Screen, Section } from "../ui";

export function Historique() {
  return (
    <Screen tab="historique" title="Historique">
      <Chips items={["Tout", "Entrées", "Sorties", "Ordres"]} selected="Tout" />
      <Section title="Aujourd'hui" />
      <List>
        <Row icon={<ArrowDownwardRounded />} tone="green" primary="Entrée MTN MoMo" secondary="14:02 · crédité" right="+1 000 000" rightColor={tones.green.fg} href="/client/historique/detail" />
        <Row icon={<SwapHorizRounded />} tone="blue" primary="Achat 1 500 USDT" secondary="13:41 · à 618,20" right="−927 300" href="/client/historique/detail" />
        <Row icon={<ArrowUpwardRounded />} tone="amber" primary="Sortie Orange Money" secondary="en cours" right="−500 000" href="/client/historique/detail" />
        <Row icon={<SwapHorizRounded />} tone="blue" primary="Vente 800 USDT" secondary="11:08 · à 618,90" right="+495 120" rightColor={tones.green.fg} href="/client/historique/detail" />
      </List>
      <Section title="Hier" />
      <List>
        <Row icon={<ArrowUpwardRounded />} tone="neutral" primary="Retrait USDT · BEP20" secondary="18:52 · confirmé" right="−2 000 USDT" href="/client/historique/detail" />
        <Row icon={<ArrowDownwardRounded />} tone="green" primary="Entrée MTN MoMo" secondary="09:14 · 3 transferts" right="+3 000 000" rightColor={tones.green.fg} href="/client/historique/detail" />
      </List>
    </Screen>
  );
}

export function HistoriqueDetail() {
  return (
    <Screen title="Entrée MTN MoMo" back="/client/historique">
      <Box textAlign="center" py={2}>
        <Typography variant="h3" color="primary.main">
          +1 000 000
        </Typography>
        <Typography variant="body2">XAFe · aujourd'hui à 14:02</Typography>
      </Box>
      <Card>
        <Line label="Depuis" value="MTN · 6 77 12 34 56" />
        <Line label="Lu par TOTEM" value="14:02:11" />
        <Line label="Crédité" value="14:02:13" />
        <Line label="Référence XAFe" value="XAFe-DP-000418" />
        <Line label="Référence MTN" value="1234567890" />
      </Card>
      <Box sx={{ flex: 1 }} />
      <Button variant="outlined" startIcon={<DownloadRounded />}>
        Télécharger le reçu
      </Button>
    </Screen>
  );
}
