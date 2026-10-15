import AddRounded from "@mui/icons-material/AddRounded";
import ArrowDropDownRounded from "@mui/icons-material/ArrowDropDownRounded";
import CandlestickChartOutlined from "@mui/icons-material/CandlestickChartOutlined";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import MoreHorizRounded from "@mui/icons-material/MoreHorizRounded";
import RemoveRounded from "@mui/icons-material/RemoveRounded";
import ViewHeadlineRounded from "@mui/icons-material/ViewHeadlineRounded";
import { Box, Button, ButtonBase, Chip, IconButton, Paper, Slider, Stack, Tab, Tabs, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { Card, Line, Screen, Success } from "../ui";

/* Couleurs de trading, celles que tout le monde connaît : vert achat, rouge vente. */
const BUY = "#0B8F4D";
const SELL = "#D93025";
const BUY_BG = "rgba(11,143,77,0.12)";
const SELL_BG = "rgba(217,48,37,0.12)";

const ASKS: [string, string, number][] = [
  ["620,40", "3 400", 28],
  ["620,00", "6 100", 51],
  ["619,40", "1 800", 15],
  ["619,00", "12 000", 100],
  ["618,90", "2 600", 22],
  ["618,55", "483", 4],
  ["618,40", "341", 3],
];
const BIDS: [string, string, number][] = [
  ["617,90", "4 954", 33],
  ["617,85", "2 200", 15],
  ["617,50", "15 000", 100],
  ["617,20", "1 100", 7],
  ["617,00", "8 300", 55],
  ["616,80", "3 000", 20],
  ["616,50", "10 500", 70],
];
const TRADES: [string, string, string, "b" | "s"][] = [
  ["14:05:12", "618,40", "250", "b"],
  ["14:04:58", "618,30", "1 200", "s"],
  ["14:04:31", "618,40", "3 000", "b"],
  ["14:03:47", "618,35", "640", "b"],
  ["14:02:09", "618,20", "5 000", "s"],
  ["14:01:55", "618,25", "800", "s"],
  ["14:01:10", "618,30", "2 100", "b"],
  ["14:00:42", "618,10", "900", "s"],
];

/* --------------------------------------------------------- en-tête paire */

function PairHeader({ chart = true }: { chart?: boolean }) {
  return (
    <Stack direction="row" alignItems="center" sx={{ px: 2, minHeight: 56 }}>
      <ButtonBase sx={{ gap: 0.25, borderRadius: 2, px: 0.5 }}>
        <Typography variant="h6">USDT/XAFe</Typography>
        <ArrowDropDownRounded />
      </ButtonBase>
      <Typography sx={{ ml: 1, color: BUY, fontWeight: 600, fontSize: 15, fontVariantNumeric: "tabular-nums" }}>
        +0,31 %
      </Typography>
      <Box sx={{ flex: 1 }} />
      {chart && (
        <IconButton aria-label="Graphique" href="/client/marche/graphique">
          <CandlestickChartOutlined />
        </IconButton>
      )}
      <IconButton aria-label="Plus">
        <MoreHorizRounded />
      </IconButton>
    </Stack>
  );
}

/* --------------------------------------------------------- carnet compact */

function BookRow({ price, qty, width, side }: { price: string; qty: string; width: number; side: "b" | "s" }) {
  return (
    <Box sx={{ position: "relative", display: "flex", justifyContent: "space-between", height: 24, alignItems: "center", px: 0.5 }}>
      <Box sx={{ position: "absolute", top: 1, bottom: 1, right: 0, width: `${width}%`, bgcolor: side === "b" ? BUY_BG : SELL_BG }} />
      <Typography sx={{ position: "relative", fontSize: 13, fontWeight: 500, color: side === "b" ? BUY : SELL, fontVariantNumeric: "tabular-nums" }}>
        {price}
      </Typography>
      <Typography sx={{ position: "relative", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{qty}</Typography>
    </Box>
  );
}

function MidPrice({ big }: { big?: boolean }) {
  return (
    <Stack direction="row" alignItems="baseline" gap={0.75} sx={{ py: 0.75 }}>
      <Typography sx={{ fontSize: big ? 22 : 18, fontWeight: 700, color: BUY, fontVariantNumeric: "tabular-nums" }}>618,40 ↑</Typography>
      <Typography variant="caption">≈ 1,09 $</Typography>
    </Stack>
  );
}

function CompactBook() {
  return (
    <Stack sx={{ flex: 1, minWidth: 0 }}>
      <Stack direction="row" justifyContent="space-between" sx={{ px: 0.5, mb: 0.5 }}>
        <Typography variant="caption">Prix (XAFe)</Typography>
        <Typography variant="caption">Qté (USDT)</Typography>
      </Stack>
      {ASKS.map(([p, q, w]) => (
        <BookRow key={p} price={p} qty={q} width={w} side="s" />
      ))}
      <MidPrice />
      {BIDS.map(([p, q, w]) => (
        <BookRow key={p} price={p} qty={q} width={w} side="b" />
      ))}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
        <ButtonBase sx={{ borderRadius: 2, px: 0.75, py: 0.25, bgcolor: "background.default", gap: 0.25 }}>
          <Typography variant="body2" sx={{ color: "text.primary" }}>0,05</Typography>
          <ArrowDropDownRounded fontSize="small" />
        </ButtonBase>
        <IconButton size="small" aria-label="Affichage du carnet">
          <ViewHeadlineRounded fontSize="small" />
        </IconButton>
      </Stack>
    </Stack>
  );
}

/* ------------------------------------------------------ formulaire d'ordre */

function Field({ label, value, unit, stepper = true }: { label: string; value: string; unit?: string; stepper?: boolean }) {
  return (
    <Paper sx={{ bgcolor: "background.default", borderRadius: 2, height: 48, display: "flex", alignItems: "center", px: 0.5 }}>
      {stepper ? (
        <IconButton size="small" aria-label="Moins">
          <RemoveRounded fontSize="small" />
        </IconButton>
      ) : (
        <Box sx={{ width: 8 }} />
      )}
      <Stack sx={{ flex: 1, alignItems: "center" }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
          {value}
          {unit && (
            <Typography component="span" sx={{ fontSize: 11, color: "text.secondary", ml: 0.5 }}>
              {unit}
            </Typography>
          )}
        </Typography>
        <Typography sx={{ fontSize: 10, color: "text.secondary", lineHeight: 1.1 }}>{label}</Typography>
      </Stack>
      {stepper ? (
        <IconButton size="small" aria-label="Plus">
          <AddRounded fontSize="small" />
        </IconButton>
      ) : (
        <Box sx={{ width: 8 }} />
      )}
    </Paper>
  );
}

function SideToggle({ side }: { side: "b" | "s" }) {
  return (
    <Stack direction="row" sx={{ height: 36, borderRadius: 2, overflow: "hidden", bgcolor: "background.default" }}>
      <ButtonBase sx={{ flex: 1, fontWeight: 700, fontSize: 14, bgcolor: side === "b" ? BUY : "transparent", color: side === "b" ? "#fff" : "text.secondary", clipPath: "polygon(0 0, 100% 0, 88% 100%, 0 100%)", mr: -1 }}>
        Acheter
      </ButtonBase>
      <ButtonBase sx={{ flex: 1, fontWeight: 700, fontSize: 14, bgcolor: side === "s" ? SELL : "transparent", color: side === "s" ? "#fff" : "text.secondary", clipPath: "polygon(12% 0, 100% 0, 100% 100%, 0 100%)", ml: -1 }}>
        Vendre
      </ButtonBase>
    </Stack>
  );
}

function OrderForm() {
  return (
    <Stack gap={1} sx={{ width: 212, flexShrink: 0 }}>
      <SideToggle side="b" />
      <Paper sx={{ bgcolor: "background.default", borderRadius: 2, height: 40, display: "flex", alignItems: "center", px: 1.25, gap: 0.5 }}>
        <InfoOutlined sx={{ fontSize: 16, color: "text.secondary" }} />
        <Typography sx={{ flex: 1, fontSize: 14, fontWeight: 500, textAlign: "center" }}>Limite</Typography>
        <ArrowDropDownRounded fontSize="small" />
      </Paper>
      <Field label="Prix (XAFe)" value="618,40" />
      <Field label="Quantité (USDT)" value="1 500" />
      <Box sx={{ px: 1 }}>
        <Slider
          value={28}
          step={null}
          marks={[0, 25, 50, 75, 100].map((v) => ({ value: v }))}
          size="small"
          sx={{ color: "text.secondary", "& .MuiSlider-mark": { width: 8, height: 8, borderRadius: 4, bgcolor: "background.paper", border: 2, borderColor: "text.secondary" }, "& .MuiSlider-thumb": { width: 16, height: 16, bgcolor: "background.paper", border: 2, borderColor: "text.primary" } }}
        />
      </Box>
      <Field label="Total (XAFe)" value="927 600" stepper={false} />
      <Stack gap={0.25} sx={{ px: 0.25 }}>
        <Small label="Dispo" value="3 250 000 XAFe" plus />
        <Small label="Achat max" value="5 255 USDT" />
        <Small label="Frais est." value="928 XAFe" />
      </Stack>
      <Button variant="contained" sx={{ bgcolor: BUY, minHeight: 44, borderRadius: 2, "&:hover": { bgcolor: BUY } }} href="/client/marche/ordre-place">
        Acheter USDT
      </Button>
    </Stack>
  );
}

function Small({ label, value, plus }: { label: string; value: string; plus?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center">
      <Typography sx={{ fontSize: 11, color: "text.secondary" }}>{label}</Typography>
      <Stack direction="row" alignItems="center" gap={0.5}>
        <Typography sx={{ fontSize: 11, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
        {plus && <AddRounded sx={{ fontSize: 14, color: BUY, bgcolor: BUY_BG, borderRadius: 2 }} />}
      </Stack>
    </Stack>
  );
}

/* --------------------------------------------------------- ordres ouverts */

function OpenOrder({ side, type, time, price, qty, filled, total }: { side: "b" | "s"; type: string; time: string; price: string; qty: string; filled: string; total: string }) {
  return (
    <Stack gap={1} sx={{ py: 1.5, borderTop: 1, borderColor: "divider" }}>
      <Stack direction="row" alignItems="center" gap={1}>
        <Chip label={side === "b" ? "Achat" : "Vente"} size="small" sx={{ height: 22, fontSize: 12, bgcolor: side === "b" ? BUY_BG : SELL_BG, color: side === "b" ? BUY : SELL, fontWeight: 600 }} />
        <Typography sx={{ fontWeight: 600, fontSize: 14 }}>USDT/XAFe</Typography>
        <Typography variant="caption">{type}</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption">{time}</Typography>
        <Button size="small" variant="text" sx={{ minHeight: 28, px: 1, fontSize: 13 }}>
          Annuler
        </Button>
      </Stack>
      <Stack direction="row" justifyContent="space-between">
        <Cell label="Prix" value={price} />
        <Cell label="Quantité" value={qty} />
        <Cell label="Exécuté" value={filled} />
        <Cell label="Total" value={total} align="right" />
      </Stack>
    </Stack>
  );
}

function Cell({ label, value, align }: { label: string; value: string; align?: "right" }) {
  return (
    <Stack sx={{ textAlign: align }}>
      <Typography sx={{ fontSize: 11, color: "text.secondary" }}>{label}</Typography>
      <Typography sx={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
    </Stack>
  );
}

/* ================================================== 1 · écran de trading */

export function Marche() {
  return (
    <Screen tab="marche" gap={0}>
      <Box sx={{ mx: -2 }}>
        <PairHeader />
      </Box>
      <Paper sx={{ p: 1.5, borderRadius: 4 }}>
        <Stack direction="row" gap={1.5}>
          <OrderForm />
          <CompactBook />
        </Stack>
      </Paper>
      <Box sx={{ mt: 1.5 }}>
        <Stack direction="row" alignItems="center">
          <Tabs value="ouverts" sx={{ minHeight: 40, flex: 1 }}>
            <Tab value="ouverts" label="Ordres ouverts (2)" sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
            <Tab value="actifs" label="Actifs" sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
          </Tabs>
          <Button size="small" variant="text" href="/client/marche/ordres" sx={{ minHeight: 32, fontSize: 13 }}>
            Tout voir
          </Button>
        </Stack>
        <OpenOrder side="b" type="Limite" time="13:58" price="617,50" qty="15 000" filled="0 %" total="9 262 500" />
        <OpenOrder side="s" type="Limite" time="11:02" price="619,00" qty="2 000" filled="40 %" total="1 238 000" />
      </Box>
    </Screen>
  );
}

/* ====================================================== 2 · graphique */

const CANDLES: [number, number, number, number][] = [
  [616.2, 616.6, 616.9, 616.0], [616.6, 616.4, 616.8, 616.2], [616.4, 617.1, 617.3, 616.3], [617.1, 617.0, 617.4, 616.8],
  [617.0, 617.6, 617.8, 616.9], [617.6, 617.3, 617.7, 617.1], [617.3, 617.9, 618.1, 617.2], [617.9, 618.4, 618.6, 617.8],
  [618.4, 618.1, 618.7, 618.0], [618.1, 618.5, 618.8, 617.9], [618.5, 619.2, 619.4, 618.4], [619.2, 618.9, 619.5, 618.7],
  [618.9, 619.6, 619.9, 618.8], [619.6, 620.3, 620.6, 619.5], [620.3, 621.05, 621.2, 620.1], [621.05, 620.4, 621.1, 620.2],
  [620.4, 619.8, 620.6, 619.6], [619.8, 619.1, 619.9, 618.9], [619.1, 618.6, 619.3, 618.3], [618.6, 618.9, 619.1, 618.4],
  [618.9, 618.3, 619.0, 618.1], [618.3, 617.8, 618.5, 617.6], [617.8, 618.2, 618.4, 617.7], [618.2, 618.0, 618.5, 617.9],
  [618.0, 618.4, 618.6, 617.9], [618.4, 618.7, 618.9, 618.3], [618.7, 618.3, 618.8, 618.1], [618.3, 618.4, 618.6, 618.2],
];
const VOLS = [12, 8, 18, 6, 15, 9, 17, 22, 10, 14, 26, 12, 24, 30, 36, 28, 20, 24, 16, 11, 19, 15, 9, 7, 13, 12, 10, 8];

function Candles() {
  const W = 376, H = 200, VH = 44, top = 8, bottom = 8;
  const min = 615.5, max = 621.5;
  const y = (p: number) => top + ((max - p) / (max - min)) * (H - top - bottom);
  const step = W / CANDLES.length;
  const vmax = Math.max(...VOLS);
  return (
    <svg width="100%" height={H + VH + 24} viewBox={`0 0 ${W + 44} ${H + VH + 24}`} role="img" aria-label="Chandeliers d'une heure sur 28 heures, de 616 à 621 XAFe">
      {[616, 618, 620].map((g) => (
        <g key={g}>
          <line x1="0" y1={y(g)} x2={W} y2={y(g)} stroke="#E3E7E3" />
          <text x={W + 6} y={y(g) + 4} fontSize="11" fill="#5B615E">{g}</text>
        </g>
      ))}
      <line x1="0" y1={y(618.4)} x2={W} y2={y(618.4)} stroke={BUY} strokeDasharray="3 3" />
      <rect x={W + 2} y={y(618.4) - 8} width="42" height="16" rx="3" fill={BUY} />
      <text x={W + 23} y={y(618.4) + 4} fontSize="11" fill="#fff" textAnchor="middle">618,4</text>
      {CANDLES.map(([o, c, h, l], i) => {
        const x = i * step + step / 2;
        const up = c >= o;
        const col = up ? BUY : SELL;
        const bodyTop = y(Math.max(o, c));
        const bodyH = Math.max(1.5, Math.abs(y(o) - y(c)));
        return (
          <g key={i}>
            <line x1={x} y1={y(h)} x2={x} y2={y(l)} stroke={col} strokeWidth="1.2" />
            <rect x={x - step * 0.3} y={bodyTop} width={step * 0.6} height={bodyH} fill={col} />
            <rect x={x - step * 0.3} y={H + 12 + (VH - (VOLS[i] / vmax) * VH)} width={step * 0.6} height={(VOLS[i] / vmax) * VH} fill={col} opacity="0.45" />
          </g>
        );
      })}
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Stack>
      <Typography sx={{ fontSize: 11, color: "text.secondary" }}>{label}</Typography>
      <Typography sx={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
    </Stack>
  );
}

export function MarcheGraphique() {
  return (
    <Screen back="/client/marche" title="USDT/XAFe" gap={1.5}>
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between">
        <Stack>
          <Typography sx={{ fontSize: 30, fontWeight: 700, color: BUY, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>618,40</Typography>
          <Typography variant="body2">≈ 1,09 $ <Box component="span" sx={{ color: BUY, fontWeight: 600 }}>+1,90 (+0,31 %)</Box></Typography>
        </Stack>
        <Stack direction="row" gap={2.5}>
          <Stat label="Haut 24 h" value="621,05" />
          <Stat label="Bas 24 h" value="616,20" />
          <Stat label="Vol 24 h (USDT)" value="412 980" />
        </Stack>
      </Stack>
      <Stack direction="row" gap={0.5}>
        {["15 min", "1 h", "4 h", "1 j", "1 sem", "Plus"].map((t) => (
          <Chip key={t} label={t} size="small" variant={t === "1 h" ? "filled" : "outlined"} color={t === "1 h" ? "primary" : undefined} sx={{ height: 28, fontSize: 12 }} />
        ))}
      </Stack>
      <Paper sx={{ p: 1, borderRadius: 3 }}>
        <Candles />
      </Paper>
      <Tabs value="carnet" sx={{ minHeight: 40 }}>
        <Tab value="carnet" label="Carnet" sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
        <Tab value="trades" label="Transactions" sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} href="/client/marche/carnet" />
        <Tab value="infos" label="Infos" sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
      </Tabs>
      <Stack direction="row" gap={2}>
        <Stack sx={{ flex: 1 }}>
          <Stack direction="row" justifyContent="space-between"><Typography variant="caption">Qté</Typography><Typography variant="caption">Achat</Typography></Stack>
          {BIDS.slice(0, 5).map(([p, q, w]) => (
            <Box key={p} sx={{ position: "relative", display: "flex", justifyContent: "space-between", height: 24, alignItems: "center" }}>
              <Box sx={{ position: "absolute", top: 1, bottom: 1, right: 0, width: `${w}%`, bgcolor: BUY_BG }} />
              <Typography sx={{ position: "relative", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{q}</Typography>
              <Typography sx={{ position: "relative", fontSize: 13, fontWeight: 500, color: BUY, fontVariantNumeric: "tabular-nums" }}>{p}</Typography>
            </Box>
          ))}
        </Stack>
        <Stack sx={{ flex: 1 }}>
          <Stack direction="row" justifyContent="space-between"><Typography variant="caption">Vente</Typography><Typography variant="caption">Qté</Typography></Stack>
          {[...ASKS].reverse().slice(0, 5).map(([p, q, w]) => (
            <Box key={p} sx={{ position: "relative", display: "flex", justifyContent: "space-between", height: 24, alignItems: "center" }}>
              <Box sx={{ position: "absolute", top: 1, bottom: 1, left: 0, width: `${w}%`, bgcolor: SELL_BG }} />
              <Typography sx={{ position: "relative", fontSize: 13, fontWeight: 500, color: SELL, fontVariantNumeric: "tabular-nums" }}>{p}</Typography>
              <Typography sx={{ position: "relative", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{q}</Typography>
            </Box>
          ))}
        </Stack>
      </Stack>
      <Box sx={{ flex: 1 }} />
      <Stack direction="row" gap={1.5}>
        <Button fullWidth variant="contained" href="/client/marche" sx={{ bgcolor: BUY, borderRadius: 2, "&:hover": { bgcolor: BUY } }}>Acheter</Button>
        <Button fullWidth variant="contained" href="/client/marche" sx={{ bgcolor: SELL, borderRadius: 2, "&:hover": { bgcolor: SELL } }}>Vendre</Button>
      </Stack>
    </Screen>
  );
}

/* ========================================= 3 · carnet complet + transactions */

export function MarcheCarnet() {
  return (
    <Screen back="/client/marche" title="USDT/XAFe" gap={1}>
      <Tabs value="carnet" sx={{ minHeight: 40 }}>
        <Tab value="carnet" label="Carnet d'ordres" sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
        <Tab value="trades" label="Transactions" sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
      </Tabs>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Stack direction="row" gap={0.5}>
          {["Tout", "Achats", "Ventes"].map((t) => (
            <Chip key={t} label={t} size="small" variant={t === "Tout" ? "filled" : "outlined"} color={t === "Tout" ? "primary" : undefined} sx={{ height: 28, fontSize: 12 }} />
          ))}
        </Stack>
        <ButtonBase sx={{ borderRadius: 2, px: 1, py: 0.5, bgcolor: "background.paper", gap: 0.25 }}>
          <Typography variant="body2" sx={{ color: "text.primary" }}>Pas 0,05</Typography>
          <ArrowDropDownRounded fontSize="small" />
        </ButtonBase>
      </Stack>
      <Paper sx={{ p: 1.5, borderRadius: 3 }}>
        <Stack direction="row" gap={2}>
          <Stack sx={{ flex: 1 }}>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}><Typography variant="caption">Qté (USDT)</Typography><Typography variant="caption">Achat (XAFe)</Typography></Stack>
            {[...BIDS, ["616,20", "2 400", 16], ["616,00", "7 800", 52], ["615,50", "5 100", 34], ["615,00", "9 000", 60], ["614,50", "1 300", 9]].map(([p, q, w]) => (
              <Box key={String(p)} sx={{ position: "relative", display: "flex", justifyContent: "space-between", height: 26, alignItems: "center", px: 0.5 }}>
                <Box sx={{ position: "absolute", top: 1, bottom: 1, right: 0, width: `${w}%`, bgcolor: BUY_BG }} />
                <Typography sx={{ position: "relative", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{q}</Typography>
                <Typography sx={{ position: "relative", fontSize: 13, fontWeight: 500, color: BUY, fontVariantNumeric: "tabular-nums" }}>{p}</Typography>
              </Box>
            ))}
          </Stack>
          <Stack sx={{ flex: 1 }}>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}><Typography variant="caption">Vente (XAFe)</Typography><Typography variant="caption">Qté (USDT)</Typography></Stack>
            {[...[...ASKS].reverse(), ["620,72", "4 954", 41], ["621,00", "2 000", 17], ["621,50", "6 300", 52], ["622,00", "3 100", 26], ["622,40", "900", 8]].map(([p, q, w]) => (
              <Box key={String(p)} sx={{ position: "relative", display: "flex", justifyContent: "space-between", height: 26, alignItems: "center", px: 0.5 }}>
                <Box sx={{ position: "absolute", top: 1, bottom: 1, left: 0, width: `${w}%`, bgcolor: SELL_BG }} />
                <Typography sx={{ position: "relative", fontSize: 13, fontWeight: 500, color: SELL, fontVariantNumeric: "tabular-nums" }}>{p}</Typography>
                <Typography sx={{ position: "relative", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{q}</Typography>
              </Box>
            ))}
          </Stack>
        </Stack>
        <Stack direction="row" alignItems="center" gap={1} sx={{ mt: 1.5 }}>
          <Typography sx={{ fontSize: 12, color: BUY, fontWeight: 600 }}>A 63 %</Typography>
          <Box sx={{ flex: 1, height: 6, borderRadius: 3, overflow: "hidden", display: "flex" }}>
            <Box sx={{ width: "63%", bgcolor: BUY }} />
            <Box sx={{ width: "37%", bgcolor: SELL }} />
          </Box>
          <Typography sx={{ fontSize: 12, color: SELL, fontWeight: 600 }}>37 % V</Typography>
        </Stack>
      </Paper>
      <Typography variant="subtitle1" sx={{ mt: 0.5 }}>Dernières transactions</Typography>
      <Paper sx={{ p: 1.5, borderRadius: 3 }}>
        <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
          <Typography variant="caption">Heure</Typography>
          <Typography variant="caption">Prix (XAFe)</Typography>
          <Typography variant="caption">Qté (USDT)</Typography>
        </Stack>
        {TRADES.map(([t, p, q, s]) => (
          <Stack key={t} direction="row" justifyContent="space-between" sx={{ height: 26, alignItems: "center" }}>
            <Typography sx={{ fontSize: 13, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>{t}</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 500, color: s === "b" ? BUY : SELL, fontVariantNumeric: "tabular-nums" }}>{p}</Typography>
            <Typography sx={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{q}</Typography>
          </Stack>
        ))}
      </Paper>
    </Screen>
  );
}

/* ================================================= 4 · ordres (page) */

export function MarcheOrdres() {
  return (
    <Screen back="/client/marche" title="Ordres" gap={1}>
      <Tabs value="ouverts" sx={{ minHeight: 40 }}>
        <Tab value="ouverts" label="Ouverts (2)" sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
        <Tab value="historique" label="Historique" sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
        <Tab value="executions" label="Exécutions" sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
      </Tabs>
      <Paper sx={{ px: 2, borderRadius: 3 }}>
        <OpenOrder side="b" type="Limite" time="13:58" price="617,50" qty="15 000" filled="0 %" total="9 262 500" />
        <OpenOrder side="s" type="Limite" time="11:02" price="619,00" qty="2 000" filled="40 %" total="1 238 000" />
      </Paper>
      <Button variant="outlined" color="error">Tout annuler</Button>
      <Typography variant="subtitle1" sx={{ mt: 1 }}>Aujourd'hui</Typography>
      <Paper sx={{ px: 2, borderRadius: 3 }}>
        <Done side="b" time="13:41" price="618,20" qty="1 500" total="927 300" />
        <Done side="s" time="11:08" price="618,90" qty="800" total="495 120" />
      </Paper>
    </Screen>
  );
}

function Done({ side, time, price, qty, total }: { side: "b" | "s"; time: string; price: string; qty: string; total: string }) {
  return (
    <Stack gap={0.75} sx={{ py: 1.5, borderTop: 1, borderColor: "divider" }}>
      <Stack direction="row" alignItems="center" gap={1}>
        <Chip label={side === "b" ? "Achat" : "Vente"} size="small" sx={{ height: 22, fontSize: 12, bgcolor: side === "b" ? BUY_BG : SELL_BG, color: side === "b" ? BUY : SELL, fontWeight: 600 }} />
        <Typography sx={{ fontWeight: 600, fontSize: 14 }}>USDT/XAFe</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption">{time}</Typography>
        <Chip label="Exécuté" size="small" sx={{ height: 22, fontSize: 12 }} />
      </Stack>
      <Stack direction="row" justifyContent="space-between">
        <Cell label="Prix moyen" value={price} />
        <Cell label="Quantité" value={qty} />
        <Cell label="Total (XAFe)" value={total} align="right" />
      </Stack>
    </Stack>
  );
}

/* ================================================ 5 · ordre exécuté */

export function MarcheOrdrePlace() {
  return (
    <Success
      title="Ordre exécuté"
      amount="+1 500 USDT"
      caption="Pour 927 600 XAFe, au prix moyen de 618,40."
      primary={{ label: "Retour au marché", href: "/client/marche" }}
      secondary={{ label: "Voir mon portefeuille", href: "/client/accueil" }}
    >
      <Card>
        <Line label="Frais" value="928 XAFe" />
        <Line label="Référence" value="ORD-A-20931" />
      </Card>
    </Success>
  );
}

