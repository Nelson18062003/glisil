import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import ArrowOutwardRounded from "@mui/icons-material/ArrowOutwardRounded";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded";
import { Box, Button, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { Card, List, Row, Screen } from "../ui";

export function Crypto() {
  return (
    <Screen title="Crypto" back="/client/accueil">
      <List>
        <Row icon={<ArrowDownwardRounded />} tone="blue" primary="Déposer des USDT" secondary="BEP20 ou TRC20" href="/client/crypto/deposer" />
        <Row icon={<ArrowUpwardRounded />} tone="blue" primary="Retirer des USDT" secondary="Vers un wallet externe" href="/client/crypto/deposer" />
        <Row icon={<ArrowOutwardRounded />} tone="green" primary="Retirer des XAFe" secondary="Vers mon propre wallet, BEP20 ou TRC20" href="/client/crypto/deposer" />
      </List>
    </Screen>
  );
}

export function CryptoDeposer() {
  return (
    <Screen title="Déposer des USDT" back="/client/crypto">
      <ToggleButtonGroup value="bep20" exclusive fullWidth>
        <ToggleButton value="bep20">BEP20</ToggleButton>
        <ToggleButton value="trc20">TRC20</ToggleButton>
      </ToggleButtonGroup>
      <Card sx={{ alignItems: "center", gap: 2 }}>
        <Paper sx={{ p: 1.5, bgcolor: "background.default", borderRadius: 4 }}>
          <Qr />
        </Paper>
        <Stack alignItems="center" gap={0.5} sx={{ width: "100%" }}>
          <Typography variant="caption">Votre adresse USDT · BEP20</Typography>
          <Typography sx={{ fontFamily: "Roboto Mono, monospace", fontSize: 14, wordBreak: "break-all", textAlign: "center" }}>
            0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21
          </Typography>
        </Stack>
        <Button variant="contained" startIcon={<ContentCopyRounded />} fullWidth>
          Copier l'adresse
        </Button>
      </Card>
      <Typography variant="body2" textAlign="center">
        USDT sur BNB Smart Chain uniquement. Crédit automatique après 15 confirmations.
      </Typography>
      <Box sx={{ flex: 1 }} />
    </Screen>
  );
}

function Qr() {
  const cells = [
    [0, 0, 7, 7], [14, 0, 7, 7], [0, 14, 7, 7],
    [8, 0, 1, 1], [10, 0, 2, 1], [8, 2, 2, 1], [11, 2, 1, 2], [9, 4, 1, 1], [8, 6, 1, 1], [10, 6, 1, 1], [12, 5, 1, 2],
    [0, 8, 2, 1], [3, 8, 1, 2], [5, 9, 2, 1], [1, 10, 1, 1], [4, 11, 2, 1], [0, 12, 1, 1], [2, 12, 3, 1],
    [8, 8, 2, 2], [11, 8, 1, 1], [12, 9, 2, 1], [9, 11, 1, 2], [11, 11, 2, 1], [8, 13, 1, 1], [10, 13, 3, 1],
    [14, 8, 1, 1], [16, 8, 2, 1], [19, 8, 2, 1], [15, 10, 1, 2], [17, 10, 1, 1], [19, 10, 1, 2], [14, 12, 2, 1], [18, 12, 1, 1], [20, 13, 1, 1],
    [8, 14, 1, 2], [10, 15, 2, 1], [13, 14, 1, 1], [15, 15, 1, 1], [17, 14, 2, 2], [20, 15, 1, 1],
    [9, 17, 2, 1], [12, 17, 1, 2], [14, 17, 1, 1], [16, 18, 2, 1], [19, 17, 1, 1], [8, 19, 1, 2], [10, 20, 2, 1], [13, 20, 2, 1], [16, 20, 1, 1], [18, 19, 3, 1],
  ];
  return (
    <svg width="168" height="168" viewBox="0 0 21 21" role="img" aria-label="Code QR de l'adresse (illustration)" shapeRendering="crispEdges">
      {cells.map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} fill="#191C1A" />
      ))}
      {[[1, 1], [15, 1], [1, 15]].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <rect x={x} y={y} width={5} height={5} fill="#FFFFFF" />
          <rect x={x + 1} y={y + 1} width={3} height={3} fill="#191C1A" />
        </g>
      ))}
    </svg>
  );
}
