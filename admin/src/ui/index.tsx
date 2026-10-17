/*
 * Le kit de l'administration : une coquille (barre latérale + contenu), des
 * tuiles de chiffres, des tableaux, des pastilles d'état, une boîte de
 * dialogue d'action, et une erreur qui se dit en français.
 */
import AccountBalanceRounded from "@mui/icons-material/AccountBalanceRounded";
import AdminPanelSettingsRounded from "@mui/icons-material/AdminPanelSettingsRounded";
import AccountBalanceWalletRounded from "@mui/icons-material/AccountBalanceWalletRounded";
import BalanceRounded from "@mui/icons-material/BalanceRounded";
import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import HistoryRounded from "@mui/icons-material/HistoryRounded";
import LogoutRounded from "@mui/icons-material/LogoutRounded";
import MenuRounded from "@mui/icons-material/MenuRounded";
import PeopleRounded from "@mui/icons-material/PeopleRounded";
import RouterRounded from "@mui/icons-material/RouterRounded";
import ShowChartRounded from "@mui/icons-material/ShowChartRounded";
import TuneRounded from "@mui/icons-material/TuneRounded";
import {
  Alert, AppBar, Avatar, Box, Button, Chip, Dialog, IconButton, Toolbar, useMediaQuery, DialogActions, DialogContent, DialogTitle, Drawer, List, ListItemButton, ListItemIcon, ListItemText, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { NOMS_DES_ROLES, type Droit } from "../noyau/droits";
import { initiales } from "../noyau/format";
import { useSession } from "../session/session";
import { tones, type Tone } from "../theme";

const LARGEUR = 248;

const SECTIONS: { to: string; label: string; icone: ReactNode; droit: Droit }[] = [
  { to: "/", label: "Tableau", icone: <AccountBalanceRounded />, droit: "voir" },
  { to: "/entrees", label: "Entrées", icone: <ArrowDownwardRounded />, droit: "voir" },
  { to: "/sorties", label: "Sorties", icone: <ArrowUpwardRounded />, droit: "voir" },
  { to: "/terminaux", label: "Terminaux", icone: <RouterRounded />, droit: "voir" },
  { to: "/wallets", label: "Wallets", icone: <AccountBalanceWalletRounded />, droit: "voir" },
  { to: "/parite", label: "Parité", icone: <BalanceRounded />, droit: "voir" },
  { to: "/clients", label: "Clients", icone: <PeopleRounded />, droit: "clients" },
  { to: "/marche", label: "Marché", icone: <ShowChartRounded />, droit: "voir" },
  { to: "/parametres", label: "Paramètres", icone: <TuneRounded />, droit: "voir" },
  { to: "/journal", label: "Journal", icone: <HistoryRounded />, droit: "voir" },
  { to: "/equipe", label: "Équipe", icone: <AdminPanelSettingsRounded />, droit: "administrateurs" },
];

/*
 * Sur un ordinateur, le menu reste ouvert à gauche ; en dessous de 900 px
 * (une tablette, un téléphone), il se replie derrière un bouton dans une barre
 * en haut : un menu fixe de 248 px laissait 112 px au contenu sur un 360.
 */
export function Coquille({ titre, actions, children }: { titre: string; actions?: ReactNode; children: ReactNode }) {
  const { profil, peut, deconnecter } = useSession();
  const large = useMediaQuery("(min-width:900px)", { noSsr: true });
  const [ouvert, setOuvert] = useState(false);
  return (
    <Box sx={{ display: "flex", minHeight: "100dvh", bgcolor: "background.default" }}>
      {!large && (
        <AppBar position="fixed" elevation={0} color="inherit" sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.paper", pt: "env(safe-area-inset-top)" }}>
          <Toolbar sx={{ gap: 1 }}>
            <IconButton edge="start" aria-label="Ouvrir le menu" onClick={() => setOuvert(true)} size="large"><MenuRounded /></IconButton>
            <Marque size={32} />
            {/* le titre de la page est juste dessous : la barre dit où l'on est, pas deux fois la même chose */}
            <NomGlisil size={20} />
            <Typography variant="caption" sx={{ flex: 1, mt: 0.5 }}>Administration</Typography>
          </Toolbar>
        </AppBar>
      )}
      <Drawer variant={large ? "permanent" : "temporary"} open={large || ouvert} onClose={() => setOuvert(false)} ModalProps={{ keepMounted: true }}
        sx={{ width: large ? LARGEUR : 0, flexShrink: 0, "& .MuiDrawer-paper": { width: LARGEUR, boxSizing: "border-box", borderRight: 1, borderColor: "divider", bgcolor: "background.paper" } }}>
        <Stack direction="row" alignItems="center" gap={1.5} sx={{ px: 2.5, py: 2.5 }}>
          <Marque size={40} />
          <Box>
            <NomGlisil size={22} />
            <Typography variant="caption">Administration</Typography>
          </Box>
        </Stack>
        <List sx={{ px: 1.5 }}>
          {SECTIONS.filter((s) => peut(s.droit)).map((s) => (
            <ListItemButton key={s.to} component={NavLink} to={s.to} end={s.to === "/"} onClick={() => setOuvert(false)} sx={{ borderRadius: 3, mb: 0.5, "&.active": { bgcolor: tones.green.bg, color: tones.green.fg, "& .MuiListItemIcon-root": { color: tones.green.fg } } }}>
              <ListItemIcon sx={{ minWidth: 40 }}>{s.icone}</ListItemIcon>
              <ListItemText primary={s.label} primaryTypographyProps={{ fontWeight: 500 }} />
            </ListItemButton>
          ))}
        </List>
        <Box sx={{ flex: 1 }} />
        <Stack sx={{ p: 2, borderTop: 1, borderColor: "divider" }} gap={1}>
          <Stack direction="row" alignItems="center" gap={1.5}>
            <Avatar sx={{ width: 36, height: 36, bgcolor: tones.amber.bg, color: tones.amber.fg, fontSize: 14, fontWeight: 600 }}>{initiales(profil?.nom)}</Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography fontWeight={500} noWrap>{profil?.nom}</Typography>
              <Typography variant="caption" noWrap>{profil ? NOMS_DES_ROLES[profil.role] : ""}</Typography>
            </Box>
          </Stack>
          <Button size="small" variant="text" color="inherit" startIcon={<LogoutRounded />} onClick={() => void deconnecter()} sx={{ justifyContent: "flex-start", color: "text.secondary" }}>Se déconnecter</Button>
        </Stack>
      </Drawer>
      <Box component="main" sx={{ flex: 1, minWidth: 0, px: { xs: 2, md: 4 }, py: 3, pt: { xs: "calc(env(safe-area-inset-top) + 80px)", md: 3 }, maxWidth: 1280 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1.5} sx={{ mb: 3 }}>
          <Typography variant="h5" component="h1">{titre}</Typography>
          {actions}
        </Stack>
        <Stack gap={3}><LecturesEnPanne />{children}</Stack>
      </Box>
    </Box>
  );
}

/**
 * Une lecture qui échoue se DIT. Sans cela, une liste rendait son message vide
 * rassurant (« Aucun SMS retenu : tout a trouvé son dossier ») et une page à
 * objet restait sur « Chargement… » — pour un administrateur désactivé pendant
 * sa session, ou un réseau coupé. Branché sur le cache des requêtes : chaque
 * écran en hérite, aucun ne peut l'oublier.
 */
function useLecturesEnPanne(): string {
  const cache = useQueryClient().getQueryCache();
  const instantane = () =>
    cache.getAll().filter((q) => q.state.status === "error" && q.getObserversCount() > 0)
      .map((q) => `${q.queryHash}\u0000${q.state.error instanceof Error ? q.state.error.message : String(q.state.error)}`).join("\u0001");
  return useSyncExternalStore((cb) => cache.subscribe(cb), instantane, instantane);
}

function LecturesEnPanne() {
  const cache = useQueryClient().getQueryCache();
  const pannes = useLecturesEnPanne();
  if (!pannes) return null;
  const messages = [...new Set(pannes.split("\u0001").map((l) => l.split("\u0000")[1]))];
  return (
    <Paper role="alert" data-lecture-en-panne sx={{ p: 2, borderRadius: 4, bgcolor: tones.red.bg, color: tones.red.fg }}>
      <Stack direction="row" alignItems="center" gap={2}>
        <Box sx={{ flex: 1 }}>
          <Typography fontWeight={600} sx={{ color: "inherit" }}>Une lecture a échoué : ce qui s'affiche dessous peut être vide ou ancien.</Typography>
          <Typography variant="body2" sx={{ color: "inherit" }}>{messages.join(" · ")}</Typography>
        </Box>
        <Button variant="outlined" color="inherit" onClick={() => void cache.findAll({ predicate: (q) => q.state.status === "error" }).forEach((q) => void q.fetch())}>Réessayer</Button>
      </Stack>
    </Paper>
  );
}

export function Tuile({ label, valeur, unite, tone = "neutral", aide }: { label: string; valeur: string; unite?: string; tone?: Tone; aide?: string }) {
  return (
    <Paper data-tuile={label} sx={{ p: 2.5, borderRadius: 5, flex: 1, minWidth: 180, bgcolor: tones[tone].bg, color: tones[tone].fg }}>
      <Typography variant="body2" sx={{ color: "inherit", opacity: 0.8 }}>{label}</Typography>
      <Typography variant="h4" sx={{ fontVariantNumeric: "tabular-nums", mt: 0.5, fontSize: valeur.length > 12 ? 24 : 30 }}>
        {valeur}{unite && <Typography component="span" sx={{ fontSize: 16, ml: 0.75, opacity: 0.8 }}>{unite}</Typography>}
      </Typography>
      {aide && <Typography variant="caption" sx={{ color: "inherit", opacity: 0.75 }}>{aide}</Typography>}
    </Paper>
  );
}

export function Tableau({ colonnes, lignes, vide = "Rien ici." }: { colonnes: (string | { label: string; align?: "right" })[]; lignes: ReactNode[][]; vide?: string }) {
  /* une liste vide parce que la lecture a échoué n'est pas une liste vide : elle ne dit pas « tout va bien » */
  if (useLecturesEnPanne() && lignes.length === 0) vide = "Rien à montrer : la lecture a échoué (voir ci-dessus).";
  return (
    <TableContainer component={Paper} sx={{ borderRadius: 5 }}>
      <Table size="small" sx={{ "& td, & th": { py: 1.25, whiteSpace: "nowrap" }, "& th": { fontWeight: 600, color: "text.secondary", fontSize: 12, letterSpacing: 0.3 } }}>
        <TableHead>
          <TableRow>{colonnes.map((c, i) => (typeof c === "string" ? <TableCell key={i}>{c}</TableCell> : <TableCell key={i} align={c.align}>{c.label}</TableCell>))}</TableRow>
        </TableHead>
        <TableBody>
          {lignes.length === 0 ? (
            <TableRow><TableCell colSpan={colonnes.length} sx={{ color: "text.secondary", textAlign: "center", py: 4 }}>{vide}</TableCell></TableRow>
          ) : lignes.map((l, i) => (
            <TableRow key={i} hover>{l.map((c, j) => <TableCell key={j} align={typeof colonnes[j] === "object" ? (colonnes[j] as { align?: "right" }).align : undefined} sx={{ fontVariantNumeric: "tabular-nums" }}>{c}</TableCell>)}</TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

const ETATS: Record<string, { label: string; tone: Tone }> = {
  en_attente: { label: "en attente", tone: "amber" }, attendu: { label: "attend le SMS", tone: "amber" }, credite: { label: "crédité", tone: "green" }, expire: { label: "expiré", tone: "neutral" }, annule: { label: "annulé", tone: "neutral" }, annulee: { label: "annulée", tone: "neutral" },
  refuse: { label: "refusé", tone: "red" }, en_cours: { label: "en cours", tone: "blue" }, envoyee: { label: "envoyée", tone: "green" }, partielle: { label: "partielle", tone: "amber" }, echouee: { label: "échouée", tone: "red" },
  faite: { label: "fait", tone: "green" }, retenue: { label: "retenue", tone: "amber" }, rapprochee: { label: "rapprochée", tone: "green" }, remboursee: { label: "remboursée", tone: "blue" },
  concorde: { label: "concorde", tone: "green" }, en_route: { label: "en route", tone: "blue" }, en_retard: { label: "en retard", tone: "amber" },
  refusee: { label: "refusée par la chaîne", tone: "red" }, ecart: { label: "écart", tone: "red" }, inconnue: { label: "inconnue du registre", tone: "red" },
  pret: { label: "prêt", tone: "amber" }, ferme: { label: "fermé", tone: "neutral" },
  ouvert: { label: "ouvert", tone: "blue" }, partiel: { label: "partiel", tone: "amber" }, execute: { label: "exécuté", tone: "green" }, muet: { label: "muet", tone: "red" }, actif: { label: "actif", tone: "green" }, inactif: { label: "en pause", tone: "neutral" },
};

export function Etat({ valeur }: { valeur: string }) {
  const e = ETATS[valeur] ?? { label: valeur, tone: "neutral" as Tone };
  return <Chip label={e.label} size="small" sx={{ height: 24, bgcolor: tones[e.tone].bg, color: tones[e.tone].fg, fontWeight: 600 }} />;
}

export function Dialogue({ ouvert, titre, onFermer, onValider, libelle = "Valider", couleur = "primary", enCours, children, desactive }: {
  ouvert: boolean; titre: string; onFermer: () => void; onValider?: () => void; libelle?: string; couleur?: "primary" | "error"; enCours?: boolean; children: ReactNode; desactive?: boolean;
}) {
  return (
    <Dialog open={ouvert} onClose={onFermer} fullWidth maxWidth="sm" PaperProps={{ sx: { borderRadius: 6 } }}>
      <DialogTitle>{titre}</DialogTitle>
      <DialogContent><Stack gap={2} sx={{ pt: 1 }}>{children}</Stack></DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button variant="text" onClick={onFermer}>{onValider ? "Annuler" : "Fermer"}</Button>
        {onValider && <Button variant="contained" color={couleur} onClick={onValider} disabled={enCours || desactive}>{enCours ? "…" : libelle}</Button>}
      </DialogActions>
    </Dialog>
  );
}

export function Erreur({ erreur, onFermer }: { erreur: unknown; onFermer: () => void }) {
  if (!erreur) return null;
  const e = erreur as { message?: string; detail?: string };
  return <Alert severity="error" onClose={onFermer} sx={{ borderRadius: 4 }}>{e.message ?? String(erreur)}{e.detail ? ` — ${e.detail}` : ""}</Alert>;
}

export function Section({ titre, action, children }: { titre: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Typography variant="h6">{titre}</Typography>
        {action}
      </Stack>
      {children}
    </Box>
  );
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
export function NomGlisil({ size = 28 }: { size?: number }) {
  return (
    <Box component="span" sx={{ fontFamily: '"Sora", "Roboto", system-ui, sans-serif', fontWeight: 700, fontSize: size, letterSpacing: "-0.04em", lineHeight: 1, color: "text.primary" }}>
      glisil
    </Box>
  );
}
