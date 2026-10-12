/*
 * Le kit : les pièces que tous les écrans assemblent. Trois règles de design,
 * posées une fois ici — un écran, une chose ; un titre, une ligne ; une icône
 * dans un cercle tonal de 44 ou 56 px.
 */
import AccountBalanceWalletRounded from "@mui/icons-material/AccountBalanceWalletRounded";
import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import BackspaceOutlined from "@mui/icons-material/BackspaceOutlined";
import CheckRounded from "@mui/icons-material/CheckRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import HistoryRounded from "@mui/icons-material/HistoryRounded";
import PersonRounded from "@mui/icons-material/PersonRounded";
import ShowChartRounded from "@mui/icons-material/ShowChartRounded";
import WifiOffRounded from "@mui/icons-material/WifiOffRounded";
import {
  Avatar, BottomNavigation, BottomNavigationAction, Box, Button, ButtonBase, Chip, CircularProgress, Drawer, IconButton, ListItemButton, ListItemText, Paper, Skeleton, Stack, Typography,
} from "@mui/material";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { lisible } from "../noyau/erreurs";
import { useSession } from "../session/session";
import { brand, tones, type Tone } from "../theme";

export type Tab = "accueil" | "marche" | "historique" | "compte";

/* Les couleurs de trading, celles que tout le monde connaît : vert achat, rouge vente. */
export const BUY = "#0B8F4D";
export const SELL = "#D93025";
export const BUY_BG = "rgba(11,143,77,0.12)";
export const SELL_BG = "rgba(217,48,37,0.12)";

/* ------------------------------------------------------------ l'écran */

export function Screen({
  title, back, onBack, fermer, tab, actions, children, gap = 2,
}: {
  title?: string;
  /** où ramène la flèche */
  back?: string;
  /** à la place de `back`, quand la flèche doit demander quelque chose */
  onBack?: () => void;
  /** la croix d'un parcours : quitte sans rien défaire */
  fermer?: string;
  tab?: Tab;
  actions?: ReactNode;
  children: ReactNode;
  gap?: number;
}) {
  const navigate = useNavigate();
  const horsLigne = useHorsLigne();
  const flèche = back || onBack;
  return (
    <Box sx={{ width: "100%", maxWidth: 480, mx: "auto", minHeight: "100dvh", bgcolor: "background.default", display: "flex", flexDirection: "column" }}>
      {horsLigne && (
        <Stack direction="row" alignItems="center" gap={1} sx={{ bgcolor: tones.amber.bg, color: tones.amber.fg, px: 2, py: 0.75 }}>
          <WifiOffRounded fontSize="small" />
          <Typography variant="body2" sx={{ color: "inherit" }}>Hors ligne : les chiffres datent du dernier relevé.</Typography>
        </Stack>
      )}
      {(title || flèche || fermer) && (
        <Stack direction="row" alignItems="center" sx={{ minHeight: 64, px: 1 }}>
          {flèche && (
            <IconButton onClick={() => (onBack ? onBack() : navigate(back!))} aria-label="Retour" size="large">
              <ArrowBackRounded />
            </IconButton>
          )}
          <Typography variant="h6" sx={{ flex: 1, ml: flèche ? 0.5 : 1.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title}
          </Typography>
          {actions}
          {fermer && (
            <IconButton component={Link} to={fermer} aria-label="Fermer" size="large">
              <CloseRounded />
            </IconButton>
          )}
        </Stack>
      )}
      <Box sx={{ flex: 1, px: 2, pt: title || flèche ? 0 : 2, pb: tab ? 2 : 3, display: "flex", flexDirection: "column", gap }}>{children}</Box>
      {tab && <BottomNav tab={tab} />}
    </Box>
  );
}

export function BottomNav({ tab }: { tab: Tab }) {
  return (
    <Paper sx={{ borderRadius: 0, borderTop: 1, borderColor: "divider", position: "sticky", bottom: 0, zIndex: 2, pb: "env(safe-area-inset-bottom)" }}>
      <BottomNavigation value={tab} showLabels sx={{ height: 80 }}>
        <BottomNavigationAction component={Link} to="/" value="accueil" label="Accueil" icon={<AccountBalanceWalletRounded />} />
        <BottomNavigationAction component={Link} to="/marche" value="marche" label="Marché" icon={<ShowChartRounded />} />
        <BottomNavigationAction component={Link} to="/historique" value="historique" label="Historique" icon={<HistoryRounded />} />
        <BottomNavigationAction component={Link} to="/compte" value="compte" label="Compte" icon={<PersonRounded />} />
      </BottomNavigation>
    </Paper>
  );
}

/* -------------------------------------------------------------- blocs */

export function Card({ children, sx, onPrimary }: { children: ReactNode; sx?: object; onPrimary?: boolean }) {
  return (
    <Paper sx={{ p: 2.5, borderRadius: 6, display: "flex", flexDirection: "column", gap: 1.5, ...(onPrimary ? { bgcolor: "primary.main", color: "primary.contrastText" } : {}), ...sx }}>
      {children}
    </Paper>
  );
}

export function Icon({ children, tone = "neutral", size = 44 }: { children: ReactNode; tone?: Tone; size?: number }) {
  return <Avatar sx={{ width: size, height: size, bgcolor: tones[tone].bg, color: tones[tone].fg }}>{children}</Avatar>;
}

export function Badge({ kind, size = 44 }: { kind: keyof typeof brand; size?: number }) {
  const b = brand[kind];
  const label = { mtn: "MTN", om: "OM", usdt: "₮", xafe: "X" }[kind];
  return <Avatar sx={{ width: size, height: size, bgcolor: b.bg, color: b.fg, fontWeight: 700, fontSize: size / 3.2 }}>{label}</Avatar>;
}

export function Tile({ icon, label, to, tone, disabled }: { icon: ReactNode; label: string; to: string; tone: Tone; disabled?: boolean }) {
  return (
    <ButtonBase component={Link} to={to} disabled={disabled} sx={{ flex: 1, flexDirection: "column", gap: 1.25, py: 2.25, borderRadius: 6, bgcolor: "background.paper", opacity: disabled ? 0.5 : 1 }}>
      <Icon tone={tone} size={56}>{icon}</Icon>
      <Typography variant="body1" fontWeight={500}>{label}</Typography>
    </ButtonBase>
  );
}

export function Row({
  icon, tone = "neutral", badge, primary, secondary, right, rightColor, to, onClick, selected, disabled, chevron = true,
}: {
  icon?: ReactNode; tone?: Tone; badge?: keyof typeof brand; primary: string; secondary?: string; right?: ReactNode; rightColor?: string;
  to?: string; onClick?: () => void; selected?: boolean; disabled?: boolean; chevron?: boolean;
}) {
  const props = to ? { component: Link, to } : {};
  return (
    <ListItemButton {...props} onClick={onClick} selected={selected} disabled={disabled} sx={{ px: 1.5, py: 1.25, gap: 1.75, "&.Mui-selected": { bgcolor: tones.green.bg } }}>
      {badge ? <Badge kind={badge} /> : <Icon tone={tone}>{icon}</Icon>}
      <ListItemText primary={primary} secondary={secondary} primaryTypographyProps={{ fontWeight: 500, noWrap: true }} secondaryTypographyProps={{ noWrap: true }} sx={{ my: 0, minWidth: 0 }} />
      {right !== undefined ? (
        <Typography fontWeight={600} sx={{ color: rightColor, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{right}</Typography>
      ) : selected ? (
        <CheckRounded color="primary" />
      ) : chevron && (to || onClick) ? (
        <ChevronRightRounded sx={{ color: "text.secondary" }} />
      ) : null}
    </ListItemButton>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <Paper sx={{ p: 1, borderRadius: 6, display: "flex", flexDirection: "column", gap: 0.5 }}>{children}</Paper>;
}

export function Line({ label, value, strong, color, mono }: { label: string; value: ReactNode; strong?: boolean; color?: string; mono?: boolean }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" gap={2}>
      <Typography variant="body2" sx={{ flexShrink: 0 }}>{label}</Typography>
      <Typography fontWeight={strong ? 700 : 500} sx={{ color, fontVariantNumeric: "tabular-nums", textAlign: "right", fontFamily: mono ? "Roboto Mono, monospace" : undefined, fontSize: mono ? 14 : undefined, wordBreak: "break-all" }}>
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

export function Amount({ value, unit, hint, hintColor }: { value: string; unit: string; hint?: ReactNode; hintColor?: string }) {
  return (
    <Box textAlign="center" py={3}>
      <Typography variant="h3" sx={{ fontSize: value.length > 11 ? 32 : 40 }}>
        {value}{" "}
        <Typography component="span" variant="h5" color="text.secondary">{unit}</Typography>
      </Typography>
      {hint && <Typography variant="body2" mt={0.5} sx={{ color: hintColor }}>{hint}</Typography>}
    </Box>
  );
}

export function Chips({ items, selected, onSelect }: { items: string[]; selected?: string; onSelect?: (it: string) => void }) {
  return (
    <Stack direction="row" gap={1} justifyContent="center" flexWrap="wrap">
      {items.map((it) => (
        <Chip key={it} label={it} onClick={onSelect ? () => onSelect(it) : undefined} color={it === selected ? "primary" : undefined} variant={it === selected ? "filled" : "outlined"} />
      ))}
    </Stack>
  );
}

export function Keypad({ onKey, triple = "000" }: { onKey: (k: string) => void; triple?: string | null }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", triple ?? "", "0", "⌫"];
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1 }}>
      {keys.map((k, i) => (
        <ButtonBase key={i} disabled={k === ""} onClick={() => onKey(k)} aria-label={k === "⌫" ? "Effacer" : k || undefined}
          sx={{ height: 60, borderRadius: 4, fontSize: 24, fontWeight: 500, bgcolor: k === "" ? "transparent" : "background.paper" }}>
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
  title, amount, caption, children, primary, secondary, tone = "green",
}: {
  title: string; amount: string; caption: string; children?: ReactNode; primary: { label: string; to: string }; secondary?: { label: string; to: string }; tone?: Tone;
}) {
  return (
    <Screen>
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, textAlign: "center" }}>
        <Avatar sx={{ width: 96, height: 96, bgcolor: tones[tone].bg, color: tone === "green" ? "primary.main" : tones[tone].fg }}>
          <CheckRounded sx={{ fontSize: 56 }} />
        </Avatar>
        <Typography variant="h6">{title}</Typography>
        <Typography variant="h4" color={tone === "green" ? "primary.main" : tones[tone].fg}>{amount}</Typography>
        <Typography variant="body2">{caption}</Typography>
        {children && <Box sx={{ width: "100%", mt: 2 }}>{children}</Box>}
      </Box>
      <Stack gap={1}>
        <Button variant="contained" component={Link} to={primary.to} replace>{primary.label}</Button>
        {secondary && <Button variant="text" component={Link} to={secondary.to} replace>{secondary.label}</Button>}
      </Stack>
    </Screen>
  );
}

export function Sparkline({ points, color = "#0B6B3A" }: { points: number[]; color?: string }) {
  if (points.length < 2) return <Box sx={{ height: 64 }} />;
  const min = Math.min(...points), max = Math.max(...points);
  const y = (p: number) => (max === min ? 32 : 6 + ((max - p) / (max - min)) * 52);
  const pts = points.map((p, i) => `${(i / (points.length - 1)) * 360},${y(p).toFixed(1)}`).join(" ");
  return (
    <svg width="100%" height="64" viewBox="0 0 360 64" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={`0,64 ${pts} 360,64`} fill={color} opacity="0.12" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------ feuilles */

export function Feuille({ ouverte, onFermer, titre, children }: { ouverte: boolean; onFermer: () => void; titre?: string; children: ReactNode }) {
  return (
    <Drawer anchor="bottom" open={ouverte} onClose={onFermer} PaperProps={{ sx: { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxWidth: 480, mx: "auto", p: 2.5, pb: "calc(20px + env(safe-area-inset-bottom))" } }}>
      <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: "divider", mx: "auto", mb: 2 }} />
      {titre && <Typography variant="h6" sx={{ mb: 1.5 }}>{titre}</Typography>}
      {children}
    </Drawer>
  );
}

/** Une erreur se dit en trois lignes : ce qui s'est passé, ce que ça change pour l'argent, quoi faire. */
export function FeuilleErreur({ erreur, onFermer, onRecommencer }: { erreur: unknown; onFermer: () => void; onRecommencer?: () => void }) {
  const e = erreur ? lisible(erreur) : null;
  return (
    <Feuille ouverte={Boolean(erreur)} onFermer={onFermer} titre={e?.titre}>
      {e && (
        <Stack gap={2}>
          <Stack gap={0.5}>
            <Typography variant="body1">{e.argent}</Typography>
            <Typography variant="body2">{e.suite}</Typography>
          </Stack>
          <Stack gap={1}>
            {onRecommencer && e.recommencer && <Button variant="contained" onClick={() => { onFermer(); onRecommencer(); }}>Réessayer</Button>}
            <Button variant={onRecommencer && e.recommencer ? "text" : "contained"} onClick={onFermer}>Compris</Button>
          </Stack>
        </Stack>
      )}
    </Feuille>
  );
}

/* ----------------------------------------------------------- attente */

export function Squelette({ hauteur = 120, radius = 24 }: { hauteur?: number; radius?: number }) {
  return <Skeleton variant="rounded" height={hauteur} sx={{ borderRadius: radius / 4, bgcolor: "#E6EAE6" }} data-squelette="1" />;
}

export function Roue({ taille = 20 }: { taille?: number }) {
  return <CircularProgress size={taille} thickness={5} sx={{ color: "inherit" }} />;
}

/* -------------------------------------------------------- code secret */

/** Six cases (ou quatre) qui se remplissent : code SMS, code secret. */
export function Cases({ longueur, valeur, erreur }: { longueur: number; valeur: string; erreur?: boolean }) {
  return (
    <Stack direction="row" gap={1} justifyContent="center" my={2}>
      {Array.from({ length: longueur }, (_, i) => (
        <Paper key={i} sx={{ width: longueur > 4 ? 48 : 56, height: 64, borderRadius: 3, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 600, border: 2, borderColor: erreur ? "error.main" : i === valeur.length ? "primary.main" : "transparent" }}>
          {valeur[i] ?? ""}
        </Paper>
      ))}
    </Stack>
  );
}

/** Des points à la place des chiffres : un code secret ne s'affiche jamais. */
export function Points({ longueur, saisis, erreur }: { longueur: number; saisis: number; erreur?: boolean }) {
  return (
    <Stack direction="row" gap={2} justifyContent="center" my={3}>
      {Array.from({ length: longueur }, (_, i) => (
        <Box key={i} sx={{ width: 18, height: 18, borderRadius: 9, border: 2, borderColor: erreur ? "error.main" : "primary.main", bgcolor: i < saisis ? (erreur ? "error.main" : "primary.main") : "transparent", transition: "background-color 120ms" }} />
      ))}
    </Stack>
  );
}

/* --------------------------------------------------------- montants */

/** Un montant qui respecte l'œil de l'Accueil : masqué partout, jusqu'au prochain appui. */
export function Masquable({ children }: { children: string }) {
  const { montantsMasques } = useSession();
  return <>{montantsMasques ? "••••••" : children}</>;
}

/* ---------------------------------------------------------- réseau */

export function useHorsLigne(): boolean {
  const [horsLigne, setHorsLigne] = useState(typeof navigator !== "undefined" && !navigator.onLine);
  useEffect(() => {
    const on = () => setHorsLigne(false);
    const off = () => setHorsLigne(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return horsLigne;
}

/** Une minuterie qui descend : « 29:41 ». */
export function useCompteARebours(jusqua: string | undefined): number {
  const [reste, setReste] = useState(0);
  useEffect(() => {
    if (!jusqua) return;
    const calc = () => setReste(Math.max(0, Math.round((new Date(jusqua).getTime() - Date.now()) / 1000)));
    calc();
    const h = setInterval(calc, 1000);
    return () => clearInterval(h);
  }, [jusqua]);
  return reste;
}
