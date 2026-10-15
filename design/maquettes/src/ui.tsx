import AccountBalanceWalletRounded from "@mui/icons-material/AccountBalanceWalletRounded";
import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import BackspaceOutlined from "@mui/icons-material/BackspaceOutlined";
import CheckRounded from "@mui/icons-material/CheckRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import HistoryRounded from "@mui/icons-material/HistoryRounded";
import PersonRounded from "@mui/icons-material/PersonRounded";
import ShowChartRounded from "@mui/icons-material/ShowChartRounded";
import {
  Avatar,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Button,
  ButtonBase,
  Chip,
  IconButton,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import { brand, tones, type Tone } from "./theme";

export type Tab = "accueil" | "marche" | "historique" | "compte";

/* ------------------------------------------------------------ l'écran */

export function Screen({
  title,
  back,
  tab,
  actions,
  children,
  gap = 2,
}: {
  title?: string;
  back?: string;
  tab?: Tab;
  actions?: ReactNode;
  children: ReactNode;
  gap?: number;
}) {
  return (
    <Box
      sx={{
        width: 412,
        minHeight: 915,
        bgcolor: "background.default",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {(title || back) && (
        <Stack direction="row" alignItems="center" sx={{ minHeight: 64, px: 1 }}>
          {back && (
            <IconButton href={back} aria-label="Retour" size="large">
              <ArrowBackRounded />
            </IconButton>
          )}
          <Typography variant="h6" sx={{ flex: 1, ml: back ? 0.5 : 1.5 }}>
            {title}
          </Typography>
          {actions}
        </Stack>
      )}
      <Box sx={{ flex: 1, px: 2, pt: title ? 0 : 2, pb: 3, display: "flex", flexDirection: "column", gap }}>
        {children}
      </Box>
      {tab && <BottomNav tab={tab} />}
    </Box>
  );
}

export function BottomNav({ tab }: { tab: Tab }) {
  return (
    <Paper sx={{ borderRadius: 0, borderTop: 1, borderColor: "divider" }}>
      <BottomNavigation value={tab} showLabels sx={{ height: 80 }}>
        <BottomNavigationAction value="accueil" label="Accueil" icon={<AccountBalanceWalletRounded />} href="/client/accueil" />
        <BottomNavigationAction value="marche" label="Marché" icon={<ShowChartRounded />} href="/client/marche" />
        <BottomNavigationAction value="historique" label="Historique" icon={<HistoryRounded />} href="/client/historique" />
        <BottomNavigationAction value="compte" label="Compte" icon={<PersonRounded />} href="/client/compte" />
      </BottomNavigation>
    </Paper>
  );
}

/* -------------------------------------------------------------- blocs */

export function Card({ children, sx, onPrimary }: { children: ReactNode; sx?: object; onPrimary?: boolean }) {
  return (
    <Paper
      sx={{
        p: 2.5,
        borderRadius: 6,
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        ...(onPrimary ? { bgcolor: "primary.main", color: "primary.contrastText" } : {}),
        ...sx,
      }}
    >
      {children}
    </Paper>
  );
}

export function Icon({ children, tone = "neutral", size = 44 }: { children: ReactNode; tone?: Tone; size?: number }) {
  return (
    <Avatar sx={{ width: size, height: size, bgcolor: tones[tone].bg, color: tones[tone].fg }}>
      {children}
    </Avatar>
  );
}

export function Badge({ kind, size = 44 }: { kind: keyof typeof brand; size?: number }) {
  const b = brand[kind];
  const label = { mtn: "MTN", om: "OM", usdt: "₮", xafe: "X" }[kind];
  return (
    <Avatar sx={{ width: size, height: size, bgcolor: b.bg, color: b.fg, fontWeight: 700, fontSize: size / 3.2 }}>
      {label}
    </Avatar>
  );
}

export function Tile({ icon, label, href, tone }: { icon: ReactNode; label: string; href: string; tone: Tone }) {
  return (
    <ButtonBase
      href={href}
      sx={{
        flex: 1,
        flexDirection: "column",
        gap: 1.25,
        py: 2.25,
        borderRadius: 6,
        bgcolor: "background.paper",
      }}
    >
      <Icon tone={tone} size={56}>
        {icon}
      </Icon>
      <Typography variant="body1" fontWeight={500}>
        {label}
      </Typography>
    </ButtonBase>
  );
}

export function Row({
  icon,
  tone = "neutral",
  badge,
  primary,
  secondary,
  right,
  rightColor,
  href,
  selected,
}: {
  icon?: ReactNode;
  tone?: Tone;
  badge?: keyof typeof brand;
  primary: string;
  secondary?: string;
  right?: ReactNode;
  rightColor?: string;
  href?: string;
  selected?: boolean;
}) {
  return (
    <ListItemButton
      component="a"
      href={href ?? "#"}
      selected={selected}
      sx={{ px: 1.5, py: 1.25, gap: 1.75, "&.Mui-selected": { bgcolor: tones.green.bg } }}
    >
      {badge ? <Badge kind={badge} /> : <Icon tone={tone}>{icon}</Icon>}
      <ListItemText
        primary={primary}
        secondary={secondary}
        primaryTypographyProps={{ fontWeight: 500 }}
        sx={{ my: 0 }}
      />
      {right !== undefined ? (
        <Typography fontWeight={600} sx={{ color: rightColor, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {right}
        </Typography>
      ) : selected ? (
        <CheckRounded color="primary" />
      ) : (
        <ChevronRightRounded sx={{ color: "text.secondary" }} />
      )}
    </ListItemButton>
  );
}

export function List({ children }: { children: ReactNode }) {
  return (
    <Paper sx={{ p: 1, borderRadius: 6, display: "flex", flexDirection: "column", gap: 0.5 }}>
      {children}
    </Paper>
  );
}

export function Line({ label, value, strong, color }: { label: string; value: ReactNode; strong?: boolean; color?: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={2}>
      <Typography variant="body2">{label}</Typography>
      <Typography fontWeight={strong ? 700 : 500} sx={{ color, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
        {value}
      </Typography>
    </Stack>
  );
}

export function Section({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
      <Typography variant="subtitle1">{title}</Typography>
      {action}
    </Stack>
  );
}

export function Amount({ value, unit, hint }: { value: string; unit: string; hint?: string }) {
  return (
    <Box textAlign="center" py={3}>
      <Typography variant="h3">
        {value}{" "}
        <Typography component="span" variant="h5" color="text.secondary">
          {unit}
        </Typography>
      </Typography>
      {hint && (
        <Typography variant="body2" mt={0.5}>
          {hint}
        </Typography>
      )}
    </Box>
  );
}

export function Chips({ items, selected }: { items: string[]; selected?: string }) {
  return (
    <Stack direction="row" gap={1} justifyContent="center" flexWrap="wrap">
      {items.map((it) => (
        <Chip key={it} label={it} color={it === selected ? "primary" : undefined} variant={it === selected ? "filled" : "outlined"} />
      ))}
    </Stack>
  );
}

export function Keypad() {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0", "⌫"];
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1 }}>
      {keys.map((k) => (
        <ButtonBase
          key={k}
          aria-label={k === "⌫" ? "Effacer" : k}
          sx={{ height: 60, borderRadius: 4, fontSize: 24, fontWeight: 500, bgcolor: "background.paper" }}
        >
          {k === "⌫" ? <BackspaceOutlined /> : k}
        </ButtonBase>
      ))}
    </Box>
  );
}

export function Dot({ tone }: { tone: Tone }) {
  return <Box component="span" sx={{ width: 10, height: 10, borderRadius: 5, bgcolor: tones[tone].fg, display: "inline-block", mr: 1 }} />;
}

export function Success({
  title,
  amount,
  caption,
  children,
  primary,
  secondary,
}: {
  title: string;
  amount: string;
  caption: string;
  children?: ReactNode;
  primary: { label: string; href: string };
  secondary?: { label: string; href: string };
}) {
  return (
    <Screen>
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, textAlign: "center" }}>
        <Avatar sx={{ width: 96, height: 96, bgcolor: tones.green.bg, color: "primary.main" }}>
          <CheckRounded sx={{ fontSize: 56 }} />
        </Avatar>
        <Typography variant="h6">{title}</Typography>
        <Typography variant="h4" color="primary.main">
          {amount}
        </Typography>
        <Typography variant="body2">{caption}</Typography>
        {children && <Box sx={{ width: "100%", mt: 2 }}>{children}</Box>}
      </Box>
      <Stack gap={1}>
        <Button variant="contained" href={primary.href}>
          {primary.label}
        </Button>
        {secondary && (
          <Button variant="text" href={secondary.href}>
            {secondary.label}
          </Button>
        )}
      </Stack>
    </Screen>
  );
}

export function Sparkline({ color = "#0B6B3A" }: { color?: string }) {
  const pts = "0,52 24,46 48,48 72,40 96,43 120,32 144,35 168,26 192,28 216,20 240,22 264,14 288,17 312,10 336,12 360,6";
  return (
    <svg width="100%" height="64" viewBox="0 0 360 64" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={`0,64 ${pts} 360,64`} fill={color} opacity="0.12" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}
