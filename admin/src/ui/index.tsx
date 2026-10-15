/*
 * Le kit de l'administration : une coquille (barre latérale + contenu), des
 * tuiles de chiffres, des tableaux, des pastilles d'état, une boîte de
 * dialogue d'action, et une erreur qui se dit en français.
 */
import AccountBalanceRounded from "@mui/icons-material/AccountBalanceRounded";
import AccountBalanceWalletRounded from "@mui/icons-material/AccountBalanceWalletRounded";
import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import HistoryRounded from "@mui/icons-material/HistoryRounded";
import LogoutRounded from "@mui/icons-material/LogoutRounded";
import PeopleRounded from "@mui/icons-material/PeopleRounded";
import RouterRounded from "@mui/icons-material/RouterRounded";
import ShowChartRounded from "@mui/icons-material/ShowChartRounded";
import TuneRounded from "@mui/icons-material/TuneRounded";
import {
  Alert, Avatar, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, List, ListItemButton, ListItemIcon, ListItemText, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore, type ReactNode } from "react";
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
  { to: "/clients", label: "Clients", icone: <PeopleRounded />, droit: "clients" },
  { to: "/marche", label: "Marché", icone: <ShowChartRounded />, droit: "voir" },
  { to: "/parametres", label: "Paramètres", icone: <TuneRounded />, droit: "voir" },
  { to: "/journal", label: "Journal", icone: <HistoryRounded />, droit: "voir" },
];

export function Coquille({ titre, actions, children }: { titre: string; actions?: ReactNode; children: ReactNode }) {
  const { profil, peut, deconnecter } = useSession();
  return (
    <Box sx={{ display: "flex", minHeight: "100dvh", bgcolor: "background.default" }}>
      <Drawer variant="permanent" sx={{ width: LARGEUR, flexShrink: 0, "& .MuiDrawer-paper": { width: LARGEUR, boxSizing: "border-box", borderRight: 1, borderColor: "divider", bgcolor: "background.paper" } }}>
        <Stack direction="row" alignItems="center" gap={1.5} sx={{ px: 2.5, py: 2.5 }}>
          <Avatar sx={{ bgcolor: "primary.main", fontWeight: 700 }}>X</Avatar>
          <Box>
            <Typography fontWeight={700} lineHeight={1.1}>XAFe Exchange</Typography>
            <Typography variant="caption">Administration</Typography>
          </Box>
        </Stack>
        <List sx={{ px: 1.5 }}>
          {SECTIONS.filter((s) => peut(s.droit)).map((s) => (
            <ListItemButton key={s.to} component={NavLink} to={s.to} end={s.to === "/"} sx={{ borderRadius: 3, mb: 0.5, "&.active": { bgcolor: tones.green.bg, color: tones.green.fg, "& .MuiListItemIcon-root": { color: tones.green.fg } } }}>
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
      <Box component="main" sx={{ flex: 1, minWidth: 0, px: 4, py: 3, maxWidth: 1280 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 3 }}>
          <Typography variant="h5">{titre}</Typography>
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
