import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import CurrencyBitcoinRounded from "@mui/icons-material/CurrencyBitcoinRounded";
import NotificationsNoneRounded from "@mui/icons-material/NotificationsNoneRounded";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
import { Avatar, ButtonBase, Chip, IconButton, Stack, Typography } from "@mui/material";
import { Badge, Card, Screen, Sparkline, Tile } from "../ui";

export function Accueil() {
  return (
    <Screen tab="accueil" gap={2}>
      <Stack direction="row" alignItems="center" gap={1.5}>
        <Avatar sx={{ bgcolor: "primary.main", fontWeight: 600 }}>NS</Avatar>
        <Typography variant="subtitle1" sx={{ flex: 1 }}>
          Bonjour Nelson
        </Typography>
        <IconButton aria-label="Notifications">
          <NotificationsNoneRounded />
        </IconButton>
      </Stack>

      <Card onPrimary>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="body2" sx={{ color: "inherit", opacity: 0.85 }}>
            Solde total
          </Typography>
          <VisibilityOutlined fontSize="small" />
        </Stack>
        <Typography variant="h3">4 862 350 XAF</Typography>
        <Stack direction="row" gap={1.5} mt={0.5}>
          <Stack direction="row" alignItems="center" gap={1} sx={{ flex: 1, bgcolor: "rgba(255,255,255,0.14)", borderRadius: 3, p: 1.25 }}>
            <Badge kind="xafe" size={32} />
            <Stack>
              <Typography variant="caption" sx={{ color: "inherit", opacity: 0.85 }}>XAFe</Typography>
              <Typography fontWeight={600} sx={{ fontVariantNumeric: "tabular-nums" }}>3 250 000</Typography>
            </Stack>
          </Stack>
          <Stack direction="row" alignItems="center" gap={1} sx={{ flex: 1, bgcolor: "rgba(255,255,255,0.14)", borderRadius: 3, p: 1.25 }}>
            <Badge kind="usdt" size={32} />
            <Stack>
              <Typography variant="caption" sx={{ color: "inherit", opacity: 0.85 }}>USDT</Typography>
              <Typography fontWeight={600} sx={{ fontVariantNumeric: "tabular-nums" }}>2 608,05</Typography>
            </Stack>
          </Stack>
        </Stack>
      </Card>

      <Stack direction="row" gap={1.5}>
        <Tile icon={<ArrowDownwardRounded />} label="Entrer des XAF" href="/client/entrer/operateur" tone="green" />
        <Tile icon={<ArrowUpwardRounded />} label="Sortir des XAF" href="/client/sortir/montant" tone="amber" />
        <Tile icon={<CurrencyBitcoinRounded />} label="Crypto" href="/client/crypto" tone="blue" />
      </Stack>

      <ButtonBase href="/client/marche" sx={{ textAlign: "left", borderRadius: 6 }}>
        <Card sx={{ width: "100%" }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="body2">XAFe / USDT</Typography>
            <Chip label="+0,31 %" size="small" sx={{ bgcolor: "#CDEFD9", color: "#06331B", height: 28 }} />
          </Stack>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography variant="h4">618,40</Typography>
            <ChevronRightRounded sx={{ color: "text.secondary" }} />
          </Stack>
          <Sparkline />
        </Card>
      </ButtonBase>
    </Screen>
  );
}
