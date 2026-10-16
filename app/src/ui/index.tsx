/*
 * Le kit : les pièces que tous les écrans assemblent. Trois règles de design,
 * posées une fois ici — un écran, une chose ; un titre, une ligne ; une icône
 * dans un cercle tonal de 44 ou 56 px.
 */
import AccountBalanceWalletRounded from "@mui/icons-material/AccountBalanceWalletRounded";
import ArrowBackRounded from "@mui/icons-material/ArrowBackRounded";
import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import BackspaceOutlined from "@mui/icons-material/BackspaceOutlined";
import CheckRounded from "@mui/icons-material/CheckRounded";
import PriorityHighRounded from "@mui/icons-material/PriorityHighRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import HistoryRounded from "@mui/icons-material/HistoryRounded";
import PersonRounded from "@mui/icons-material/PersonRounded";
import ShowChartRounded from "@mui/icons-material/ShowChartRounded";
import WifiOffRounded from "@mui/icons-material/WifiOffRounded";
import {
  Avatar, BottomNavigation, BottomNavigationAction, Box, Button, ButtonBase, Chip, CircularProgress, Dialog, Drawer, IconButton, ListItemButton, ListItemText, Paper, Skeleton, Stack, Typography, useMediaQuery,
} from "@mui/material";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { lisible } from "../noyau/erreurs";
import { useSession } from "../session/session";
import { brand, tones, type Tone } from "../theme";

export type Tab = "accueil" | "marche" | "historique" | "compte";

/* Les couleurs de trading, celles que tout le monde connaît : vert achat, rouge vente — assez
   sombres pour se lire (4,5:1 au moins, sur blanc comme sur le fond) : le vert d'avant (#0B8F4D)
   tombait à 3,9 sur le fond, et c'est la couleur des prix du carnet. */
export const BUY = "#087A41";
export const SELL = "#C5221F";
/* les fonds des barres du carnet : à 8 %, le prix écrit dessus se lit encore (4,5:1), même sur le fond gris */
export const BUY_BG = "rgba(8,122,65,0.08)";
export const SELL_BG = "rgba(197,34,31,0.08)";

/* ------------------------------------------------------------ l'écran */

/*
 * TROIS FENÊTRES, UNE APPLICATION (les classes de fenêtre de Material 3) :
 *   compacte  < 600 px   un téléphone, même tenu à l'horizontale s'il est petit :
 *                        la barre d'onglets en bas, l'écran sur toute la largeur ;
 *   moyenne   600–1199   une tablette, un téléphone couché : un rail à gauche ;
 *   étendue   ≥ 1200     un ordinateur : un menu latéral avec la marque.
 * Dès 600 px, la navigation quitte le bas de l'écran pour le côté : sur un
 * écran large, un doigt ou une souris la trouve à gauche, et le contenu garde
 * toute la hauteur — sur un portable de 1366×768, il ne reste que 650 points.
 * Les parcours d'argent gardent une colonne étroite (560) : un formulaire étiré
 * sur 1 500 px ne se lit plus. Les écrans racines prennent la place (1 080).
 */
export type Fenetre = "compacte" | "moyenne" | "etendue";
export function useFenetre(): Fenetre {
  const moyenne = useMediaQuery("(min-width:600px)", { noSsr: true });
  const etendue = useMediaQuery("(min-width:1200px)", { noSsr: true });
  return etendue ? "etendue" : moyenne ? "moyenne" : "compacte";
}

/** Les quatre maisons, dans l'ordre de la barre ; `aussi` : les chemins qu'elles couvrent. */
export const ONGLETS: { tab: Tab; to: string; label: string; icone: ReactNode; aussi: RegExp }[] = [
  { tab: "accueil", to: "/", label: "Accueil", icone: <AccountBalanceWalletRounded />, aussi: /^\/($|notifications|entrer|sortir|crypto)/ },
  { tab: "marche", to: "/marche", label: "Marché", icone: <ShowChartRounded />, aussi: /^\/(marche|rapide)/ },
  { tab: "historique", to: "/historique", label: "Historique", icone: <HistoryRounded />, aussi: /^\/historique/ },
  { tab: "compte", to: "/compte", label: "Compte", icone: <PersonRounded />, aussi: /^\/compte/ },
];
export const ongletDuChemin = (chemin: string): Tab => ONGLETS.find((o) => o.aussi.test(chemin))?.tab ?? "accueil";

/* Posé par la garde : on est DANS l'application (une session, rien par-dessus). Hors d'elle — Bienvenue,
   le verrou, les textes publics — il n'y a pas de navigation à montrer. */
const DansLApplication = createContext(false);

/** Le cadre des écrans connectés : rien sur un téléphone, le rail ou le menu à partir d'une tablette. */
export function CadreApplication({ children }: { children: ReactNode }) {
  const fenetre = useFenetre();
  if (fenetre === "compacte") return <DansLApplication.Provider value>{children}</DansLApplication.Provider>;
  return (
    <DansLApplication.Provider value>
      <Box sx={{ display: "flex", minHeight: "100dvh", bgcolor: "background.default" }}>
        <NavigationLaterale large={fenetre === "etendue"} />
        <Box component="main" sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
      </Box>
    </DansLApplication.Provider>
  );
}

function NavigationLaterale({ large }: { large: boolean }) {
  const { pathname } = useLocation();
  const actif = ongletDuChemin(pathname);
  return (
    <Box component="nav" aria-label="Navigation principale"
      sx={{ position: "sticky", top: 0, height: "100dvh", flexShrink: 0, width: large ? 256 : 88, borderRight: 1, borderColor: "divider", bgcolor: "background.paper",
            display: "flex", flexDirection: "column", alignItems: large ? "stretch" : "center", gap: 1, px: large ? 1.5 : 0,
            pt: "calc(env(safe-area-inset-top) + 20px)", pb: 2, pl: large ? 1.5 : "env(safe-area-inset-left)", overflowY: "auto" }}>
      <ButtonBase component={Link} to="/" aria-label="Glisil, accueil" sx={{ borderRadius: 3, alignSelf: large ? "flex-start" : "center", px: large ? 1 : 0, py: 0.5, gap: 1, mb: 2 }}>
        <Marque size={40} />
        {large && <NomGlisil size={26} />}
      </ButtonBase>
      {/* le geste le plus fréquent, à portée de main sur tous les écrans */}
      <Button component={Link} to="/entrer/operateur" variant="contained" startIcon={large ? <ArrowDownwardRounded /> : undefined} aria-label="Entrer des XAF"
        sx={{ mb: 2, ...(large ? { justifyContent: "flex-start" } : { minWidth: 56, width: 56, height: 56, borderRadius: 4, px: 0 }) }}>
        {large ? "Entrer des XAF" : <ArrowDownwardRounded />}
      </Button>
      {ONGLETS.map((o) => {
        const choisi = o.tab === actif;
        return large ? (
          <ButtonBase key={o.tab} component={Link} to={o.to} aria-current={choisi ? "page" : undefined}
            sx={{ justifyContent: "flex-start", gap: 1.5, px: 2, minHeight: 56, borderRadius: 7, fontSize: 15, fontWeight: choisi ? 700 : 500,
                  bgcolor: choisi ? tones.green.bg : "transparent", color: choisi ? tones.green.fg : "text.secondary", "&:hover": { bgcolor: choisi ? tones.green.bg : "action.hover" } }}>
            {o.icone}{o.label}
          </ButtonBase>
        ) : (
          <ButtonBase key={o.tab} component={Link} to={o.to} aria-current={choisi ? "page" : undefined}
            sx={{ flexDirection: "column", gap: 0.5, width: 80, minHeight: 64, borderRadius: 4, color: choisi ? tones.green.fg : "text.secondary" }}>
            <Box sx={{ width: 56, height: 32, borderRadius: 4, display: "grid", placeItems: "center", bgcolor: choisi ? tones.green.bg : "transparent" }}>{o.icone}</Box>
            <Typography sx={{ fontSize: 12, fontWeight: choisi ? 700 : 500, color: "inherit" }}>{o.label}</Typography>
          </ButtonBase>
        );
      })}
    </Box>
  );
}

export function Screen({
  title, back, onBack, fermer, tab, large, actions, children, gap = 2,
}: {
  title?: string;
  /** où ramène la flèche */
  back?: string;
  /** à la place de `back`, quand la flèche doit demander quelque chose */
  onBack?: () => void;
  /** la croix d'un parcours : quitte sans rien défaire */
  fermer?: string;
  /** un écran racine : la barre d'onglets (sur un téléphone) */
  tab?: Tab;
  /** l'écran prend la largeur d'un grand écran (les racines : 1 080, ou la largeur donnée) ; sinon, une colonne lisible */
  large?: boolean | number;
  actions?: ReactNode;
  children: ReactNode;
  gap?: number;
}) {
  const navigate = useNavigate();
  const horsLigne = useHorsLigne();
  const dans = useContext(DansLApplication);
  const fenetre = useFenetre();
  const barreEnBas = Boolean(tab) && fenetre === "compacte";
  const flèche = back || onBack;
  return (
    /* Un parcours, sur un grand écran, garde sa hauteur naturelle : sans cela, le pavé tombait au pied
       d'une fenêtre de 960 px, à 500 px du montant qu'il remplit. Sur un téléphone, il reste sous le pouce. */
    <Box sx={{ width: "100%", maxWidth: { xs: 600, sm: large ? (typeof large === "number" ? large : 1080) : 600 }, mx: "auto", minHeight: { xs: "100dvh", sm: large || !dans ? "100dvh" : "auto" }, pb: { sm: dans && !large ? 4 : 0 },
               /* hors de l'application (Bienvenue, verrou…), sur un grand écran : une colonne centrée dans la hauteur */
               justifyContent: { sm: !dans && !large ? "center" : "flex-start" }, bgcolor: "background.default", display: "flex", flexDirection: "column",
               px: { sm: dans ? 2 : 0 }, pl: "env(safe-area-inset-left)", pr: "env(safe-area-inset-right)" }}>
      {horsLigne && (
        <Stack direction="row" alignItems="center" gap={1} sx={{ bgcolor: tones.amber.bg, color: tones.amber.fg, px: 2, py: 0.75, pt: "calc(env(safe-area-inset-top) + 6px)" }} role="status">
          <WifiOffRounded fontSize="small" />
          <Typography variant="body2" sx={{ color: "inherit" }}>Hors ligne : les chiffres datent du dernier relevé.</Typography>
        </Stack>
      )}
      {(title || flèche || fermer) && (
        <Stack direction="row" alignItems="center" sx={{ minHeight: 64, px: 1, pt: horsLigne ? 0 : "env(safe-area-inset-top)", mt: { sm: dans ? 1 : 0 } }}>
          {flèche && (
            <IconButton onClick={() => (onBack ? onBack() : navigate(back!))} aria-label="Retour" size="large">
              <ArrowBackRounded />
            </IconButton>
          )}
          <Typography variant="h6" component="h1" sx={{ flex: 1, ml: flèche ? 0.5 : 1.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: { sm: dans && !flèche ? 24 : 20 } }}>
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
      <Box sx={{ flex: { xs: 1, sm: !dans && !large ? "none" : 1 }, px: 2, pt: title || flèche ? 0 : "calc(env(safe-area-inset-top) + 16px)", pb: barreEnBas ? 2 : "calc(env(safe-area-inset-bottom) + 24px)", display: "flex", flexDirection: "column", gap }}>{children}</Box>
      {barreEnBas && <BottomNav tab={tab!} />}
    </Box>
  );
}

export function BottomNav({ tab }: { tab: Tab }) {
  return (
    <Paper component="nav" aria-label="Navigation principale" sx={{ borderRadius: 0, borderTop: 1, borderColor: "divider", position: "sticky", bottom: 0, zIndex: 2, pb: "env(safe-area-inset-bottom)" }}>
      <BottomNavigation value={tab} showLabels sx={{ height: 80 }}>
        {ONGLETS.map((o) => <BottomNavigationAction key={o.tab} component={Link} to={o.to} value={o.tab} label={o.label} icon={o.icone} />)}
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

/**
 * Le jeton XAFe, tel que les explorateurs et les wallets le montrent
 * (design/marque/jeton.py) : le client reconnaît dans son wallet ce qu'il voit ici.
 */
export function JetonXafe({ size = 44 }: { size?: number }) {
  return (
    <Box component="svg" viewBox="0 0 100 100" role="img" aria-label="XAFe" sx={{ width: size, height: size, flexShrink: 0, display: "block" }}>
      <circle cx="50" cy="50" r="50" fill="#0B6B3A" />
      <g stroke="#FFFFFF" strokeWidth="13" strokeLinecap="round"><line x1="31" y1="31" x2="69" y2="69" /><line x1="69" y1="31" x2="31" y2="69" /></g>
      <circle cx="50" cy="50" r="13.5" fill="#0B6B3A" />
      <circle cx="50" cy="50" r="10" fill="#E8A33D" />
    </Box>
  );
}

export function Badge({ kind, size = 44 }: { kind: keyof typeof brand; size?: number }) {
  if (kind === "xafe") return <JetonXafe size={size} />;
  const b = brand[kind];
  const label = { mtn: "MTN", om: "OM", usdt: "₮", xafe: "X" }[kind];
  return <Avatar sx={{ width: size, height: size, bgcolor: b.bg, color: b.fg, fontWeight: 700, fontSize: size / 3.2 }}>{label}</Avatar>;
}

export function Tile({ icon, label, to, tone, disabled, note }: { icon: ReactNode; label: string; to: string; tone: Tone; disabled?: boolean; note?: string }) {
  return (
    <ButtonBase component={Link} to={to} disabled={disabled} sx={{ flex: 1, flexDirection: "column", justifyContent: "flex-start", gap: 1.25, py: 2.25, borderRadius: 6, bgcolor: "background.paper", opacity: disabled ? 0.5 : 1 }}>
      <Icon tone={note ? "neutral" : tone} size={56}>{icon}</Icon>
      <Stack alignItems="center">
        <Typography variant="body1" fontWeight={500}>{label}</Typography>
        {note && <Typography variant="caption">{note}</Typography>}
      </Stack>
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
  /* Sur un ordinateur, on tape au clavier : les chiffres, la virgule, l'effacement. Pas quand un vrai
     champ a le focus (il reçoit déjà ses touches), et pas deux fois si deux pavés sont montés. */
  const derniere = useRef(onKey);
  derniere.current = onKey;
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const cible = e.target as HTMLElement | null;
      if (cible && (cible.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName))) return;
      const k = /^[0-9]$/.test(e.key) ? e.key : e.key === "Backspace" ? "⌫" : (e.key === "," || e.key === ".") && triple === "," ? "," : null;
      if (!k) return;
      e.preventDefault();
      derniere.current(k);
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [triple]);
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

/**
 * Un écran qui n'a rien à montrer ne se tait pas : il dit pourquoi, et mène
 * au geste qui le remplira. Une action principale, au plus une seconde.
 */
export function EtatVide({
  icone, tone = "neutral", titre, texte, action, secondaire,
}: {
  icone: ReactNode; tone?: Tone; titre: string; texte: string;
  action?: { label: string; to?: string; onClick?: () => void }; secondaire?: { label: string; to?: string; onClick?: () => void };
}) {
  const bouton = (a: { label: string; to?: string; onClick?: () => void }, variant: "contained" | "text") =>
    a.to ? <Button variant={variant} component={Link} to={a.to} onClick={a.onClick}>{a.label}</Button> : <Button variant={variant} onClick={a.onClick}>{a.label}</Button>;
  return (
    <Box data-etat-vide="1" sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1.5, textAlign: "center", py: 4, px: 1 }}>
      <Avatar sx={{ width: 72, height: 72, bgcolor: tones[tone].bg, color: tones[tone].fg }}>{icone}</Avatar>
      <Typography variant="h6" component="h2">{titre}</Typography>
      <Typography variant="body2" sx={{ maxWidth: 340 }}>{texte}</Typography>
      {(action || secondaire) && (
        <Stack gap={1} sx={{ mt: 1.5, width: "100%", maxWidth: 340 }}>
          {action && bouton(action, "contained")}
          {secondaire && bouton(secondaire, "text")}
        </Stack>
      )}
    </Box>
  );
}

export function Dot({ tone }: { tone: Tone }) {
  return <Box component="span" sx={{ width: 10, height: 10, borderRadius: 5, bgcolor: tones[tone].fg, display: "inline-block", mr: 1 }} />;
}

/** L'écran de fin d'un geste. La coche ne dit QUE la réussite : un échec ou un refus a son signe, jamais une coche. */
export function Success({
  title, amount, caption, children, primary, secondary, tone = "green", icone,
}: {
  title: string; amount: string; caption: string; children?: ReactNode; primary: { label: string; to: string }; secondary?: { label: string; to: string }; tone?: Tone; icone?: ReactNode;
}) {
  const signe = icone ?? (tone === "green" ? <CheckRounded sx={{ fontSize: 56 }} /> : tone === "red" ? <CloseRounded sx={{ fontSize: 56 }} /> : <PriorityHighRounded sx={{ fontSize: 56 }} />);
  return (
    <Screen>
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, textAlign: "center" }}>
        <Avatar sx={{ width: 96, height: 96, bgcolor: tones[tone].bg, color: tone === "green" ? "primary.main" : tones[tone].fg }}>
          {signe}
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
  /* sur un grand écran, une feuille collée en bas, à 1 000 px de l'endroit où l'on a cliqué, ne se voit pas */
  const fenetre = useFenetre();
  if (fenetre !== "compacte") {
    return (
      <Dialog open={ouverte} onClose={onFermer} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: 6, p: 3 } }}>
        {titre && <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>{titre}</Typography>}
        {children}
      </Dialog>
    );
  }
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

/**
 * Ce qu'un écran montre tant qu'il n'a pas sa donnée : des formes grises — ou,
 * si la lecture a échoué, ce qui s'est passé. Une référence qui n'est pas sur
 * ce compte (« dépôt inconnu ») laissait l'écran gris pour toujours.
 */
export function Attente({ erreur, hauteur = 300, title, back }: { erreur: unknown; hauteur?: number; title?: string; back?: string }) {
  if (!erreur) return <Screen title={title} back={back}><Squelette hauteur={hauteur} /></Screen>;
  const inconnu = erreur instanceof Error && / inconnue?$/.test(erreur.message);
  const l = lisible(erreur);
  return (
    <Screen title={inconnu ? "Introuvable" : l.titre} back={back ?? "/"}>
      <Typography variant="body2" data-attente-erreur="1">{inconnu ? "Cette opération n'est pas sur votre compte." : l.suite}</Typography>
    </Screen>
  );
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

const VERT_MARQUE = "#0B6B3A";
const OR_MARQUE = "#E8A33D";

/**
 * La marque Glisil : la comète — une pièce d'or lancée, sa traînée derrière elle.
 * `tuile` : sur le carré vert de l'icône (traînée blanche) ; sinon le symbole seul (traînée verte).
 * Même géométrie que coque/scripts/icones.py.
 */
export function Marque({ size = 44, tuile = true }: { size?: number; tuile?: boolean }) {
  const queue = tuile ? "#FFFFFF" : VERT_MARQUE;
  return (
    <Box component="svg" viewBox="0 0 100 100" role="img" aria-label="Glisil" sx={{ width: size, height: size, flexShrink: 0, display: "block" }}>
      {tuile && <rect width={100} height={100} rx={22} fill={VERT_MARQUE} />}
      <g transform={`translate(50 50) scale(${tuile ? 0.86 : 1}) translate(-50 -50) translate(3 -1) rotate(-35 50 50)`}>
        <path d="M6 50 C 28 46 44 36 60 34 A16 16 0 0 1 60 66 C 44 64 28 54 6 50 Z" fill={queue} />
        <circle cx={62} cy={50} r={12.5} fill={OR_MARQUE} />
      </g>
    </Box>
  );
}

/** Le nom, tel que la marque l'écrit : « glisil », en minuscules, en Sora. */
export function NomGlisil({ size = 28, couleur = "text.primary" }: { size?: number; couleur?: string }) {
  return (
    <Box component="span" sx={{ fontFamily: '"Sora", "Roboto", system-ui, sans-serif', fontWeight: 700, fontSize: size, letterSpacing: "-0.04em", lineHeight: 1, color: couleur }}>
      glisil
    </Box>
  );
}
