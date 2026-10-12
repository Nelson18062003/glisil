import MenuBookRounded from "@mui/icons-material/MenuBookRounded";
import ReceiptLongRounded from "@mui/icons-material/ReceiptLongRounded";
import { Box, Button, Chip, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { Amount, Card, Chips, Keypad, Line, List, Row, Screen, Sparkline, Success } from "../ui";
import { tones } from "../theme";

export function Marche() {
  return (
    <Screen tab="marche" title="Marché">
      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="body2">XAFe / USDT</Typography>
          <Chip label="+0,31 % · 24 h" size="small" sx={{ bgcolor: tones.green.bg, color: tones.green.fg, height: 28 }} />
        </Stack>
        <Typography variant="h3">618,40</Typography>
        <Sparkline />
        <Stack direction="row" justifyContent="space-between">
          <Stat label="Haut" value="621,05" />
          <Stat label="Bas" value="616,20" />
          <Stat label="Volume" value="413 k USDT" />
        </Stack>
      </Card>

      <Stack direction="row" gap={1.5}>
        <Button variant="contained" fullWidth href="/client/marche/acheter">
          Acheter USDT
        </Button>
        <Button variant="contained" fullWidth color="error" href="/client/marche/acheter" sx={{ bgcolor: tones.red.bg, color: tones.red.fg }}>
          Vendre USDT
        </Button>
      </Stack>

      <List>
        <Row icon={<MenuBookRounded />} tone="green" primary="Carnet d'ordres" secondary="Achat 617,90 · Vente 618,40" href="/client/marche/carnet" />
        <Row icon={<ReceiptLongRounded />} tone="neutral" primary="Mes ordres" secondary="2 en cours" href="/client/historique" />
      </List>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Stack>
      <Typography variant="caption">{label}</Typography>
      <Typography fontWeight={600} sx={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
    </Stack>
  );
}

const BIDS: [string, string, number][] = [
  ["617,90", "4 954", 33],
  ["617,85", "2 200", 15],
  ["617,50", "15 000", 100],
  ["617,20", "1 100", 7],
  ["617,00", "8 300", 55],
  ["616,80", "3 000", 20],
];
const ASKS: [string, string, number][] = [
  ["618,40", "341", 3],
  ["618,55", "483", 4],
  ["618,90", "2 600", 22],
  ["619,00", "12 000", 100],
  ["619,40", "1 800", 15],
  ["620,00", "6 100", 51],
];

export function MarcheCarnet() {
  return (
    <Screen title="Carnet d'ordres" back="/client/marche">
      <Card sx={{ gap: 0.75 }}>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="caption">Achats · XAFe</Typography>
          <Typography variant="caption">Qté USDT</Typography>
        </Stack>
        {BIDS.map(([p, q, w]) => (
          <BookRow key={p} price={p} qty={q} width={w} tone="green" />
        ))}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 1.5, my: 0.5, borderTop: 1, borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="h5" color="primary.main" sx={{ fontVariantNumeric: "tabular-nums" }}>
            618,40 ▲
          </Typography>
          <Typography variant="body2">écart 0,50</Typography>
        </Stack>
        {ASKS.map(([p, q, w]) => (
          <BookRow key={p} price={p} qty={q} width={w} tone="red" />
        ))}
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="caption">Ventes · XAFe</Typography>
          <Typography variant="caption">Qté USDT</Typography>
        </Stack>
      </Card>
    </Screen>
  );
}

function BookRow({ price, qty, width, tone }: { price: string; qty: string; width: number; tone: "green" | "red" }) {
  return (
    <Box sx={{ position: "relative", display: "flex", justifyContent: "space-between", px: 1.5, py: 0.75, borderRadius: 2, fontVariantNumeric: "tabular-nums", overflow: "hidden" }}>
      <Box sx={{ position: "absolute", top: 0, bottom: 0, right: 0, width: `${width}%`, bgcolor: tones[tone].bg, borderRadius: 2 }} />
      <Typography fontWeight={600} sx={{ position: "relative", color: tones[tone].fg }}>
        {price}
      </Typography>
      <Typography sx={{ position: "relative" }}>{qty}</Typography>
    </Box>
  );
}

export function MarcheAcheter() {
  return (
    <Screen title="Acheter des USDT" back="/client/marche" gap={1.5}>
      <ToggleButtonGroup value="marche" exclusive fullWidth>
        <ToggleButton value="marche">Au prix du marché</ToggleButton>
        <ToggleButton value="limite">À mon prix</ToggleButton>
      </ToggleButtonGroup>
      <Amount value="1 500" unit="USDT" hint="≈ 927 600 XAFe au prix de 618,40" />
      <Chips items={["25 %", "50 %", "75 %", "Max"]} />
      <Box sx={{ flex: 1 }} />
      <Keypad />
      <Button variant="contained" href="/client/marche/ordre-place">
        Acheter 1 500 USDT
      </Button>
    </Screen>
  );
}

export function MarcheOrdrePlace() {
  return (
    <Success
      title="Ordre exécuté"
      amount="+1 500 USDT"
      caption="Pour 927 600 XAFe, au prix moyen de 618,40."
      primary={{ label: "Voir mon portefeuille", href: "/client/accueil" }}
      secondary={{ label: "Nouvel ordre", href: "/client/marche" }}
    >
      <Card>
        <Line label="Frais" value="928 XAFe" />
        <Line label="Référence" value="ORD-A-20931" />
      </Card>
    </Success>
  );
}
