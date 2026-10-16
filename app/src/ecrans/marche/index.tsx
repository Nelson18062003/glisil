/*
 * Le Marché : un vrai spot mobile, sur le modèle de Binance et OKX. L'onglet
 * s'ouvre sur le trading (formulaire + carnet + ordres ouverts) ; le
 * graphique, le carnet complet et la page des ordres sont à un geste.
 * Le formulaire garde son état quand on change d'onglet.
 */
import AddRounded from "@mui/icons-material/AddRounded";
import ArrowDropDownRounded from "@mui/icons-material/ArrowDropDownRounded";
import CandlestickChartOutlined from "@mui/icons-material/CandlestickChartOutlined";
import FormatListBulletedRounded from "@mui/icons-material/FormatListBulletedRounded";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import MoreHorizRounded from "@mui/icons-material/MoreHorizRounded";
import RemoveRounded from "@mui/icons-material/RemoveRounded";
import { Box, Button, ButtonBase, Chip, Divider, IconButton, Menu, MenuItem, Paper, Slider, Snackbar, Stack, Tab, Tabs, Typography, useMediaQuery } from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useCarnet, useChandelles, useCotation, useGuichet, useMesOrdres, useOrdre, useRafraichir, useSoldes, useTransactions } from "../../guichet";
import type { Chandelle, Cote, Execution, Niveau, Ordre, TypeOrdre } from "../../guichet/types";
import { achatMax, arrondi2, FRAIS, fraisOrdre, MARCHE, prixValide, quantiteValide, simulerMarche, totalOrdre } from "../../noyau/argent";
import { enTranches, heure, heureSecondes, jourRelatif, pourcent, prix as fPrix, usdt as fUsdt, xaf } from "../../noyau/format";
import { useParcours } from "../../navigation/parcours";
import { Attente, Badge, BUY, BUY_BG, Card, Feuille, FeuilleErreur, Line, Screen, SELL, SELL_BG, Squelette, Success } from "../../ui";
import { useGesteUnique } from "../../ui/gestes";

const couleur = (c: Cote) => (c === "achat" ? BUY : SELL);
const fond = (c: Cote) => (c === "achat" ? BUY_BG : SELL_BG);

/* --------------------------------------------------------- en-tête paire */

function PairHeader({ chart = true }: { chart?: boolean }) {
  const { data: c } = useCotation();
  const [paire, setPaire] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const v = c?.variation24h ?? 0;
  return (
    <Stack direction="row" alignItems="center" sx={{ px: 2, minHeight: 56 }}>
      <ButtonBase sx={{ gap: 0.25, borderRadius: 2, px: 0.5, minHeight: 44 }} onClick={() => setPaire(true)}>
        <Typography variant="h6">{MARCHE.paire}</Typography>
        <ArrowDropDownRounded />
      </ButtonBase>
      {c?.variation24h != null && (
        <Typography sx={{ ml: 1, color: v >= 0 ? BUY : SELL, fontWeight: 600, fontSize: 15, fontVariantNumeric: "tabular-nums" }}>
          {v >= 0 ? "+" : ""}{enTranches(v, 2)} %
        </Typography>
      )}
      <Box sx={{ flex: 1 }} />
      {chart && (
        <IconButton aria-label="Graphique" component={Link} to="/marche/graphique">
          <CandlestickChartOutlined />
        </IconButton>
      )}
      {chart && (
        <IconButton aria-label="Plus" onClick={(e) => setMenu(e.currentTarget)}>
          <MoreHorizRounded />
        </IconButton>
      )}
      <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
        <MenuItem component={Link} to="/rapide" onClick={() => setMenu(null)}>Achat rapide</MenuItem>
        <MenuItem component={Link} to="/marche/carnet" onClick={() => setMenu(null)}>Tout le carnet</MenuItem>
        <MenuItem component={Link} to="/marche/ordres" onClick={() => setMenu(null)}>Mes ordres</MenuItem>
      </Menu>
      <Feuille ouverte={paire} onFermer={() => setPaire(false)} titre="Paires">
        <Stack gap={1}>
          <Paper sx={{ p: 1.5, borderRadius: 3, bgcolor: "#CDEFD9", display: "flex", justifyContent: "space-between" }}>
            <Typography fontWeight={600}>USDT/XAFe</Typography>
            <Typography sx={{ fontVariantNumeric: "tabular-nums" }}>{c?.dernier != null ? fPrix(c.dernier) : "—"}</Typography>
          </Paper>
          <Typography variant="body2">Une seule paire aujourd'hui. D'autres suivront quand le carnet sera assez profond.</Typography>
          <Button variant="contained" onClick={() => setPaire(false)}>Fermer</Button>
        </Stack>
      </Feuille>
    </Stack>
  );
}

/* --------------------------------------------------------- carnet compact */

function BookRow({ n, max, side, onPick, align = "right" }: { n: Niveau; max: number; side: Cote; onPick?: (p: number) => void; align?: "left" | "right" }) {
  const w = Math.min(100, Math.round((n.quantite / max) * 100));
  return (
    <ButtonBase onClick={onPick ? () => onPick(n.prix) : undefined} sx={{ position: "relative", display: "flex", justifyContent: "space-between", height: 24, alignItems: "center", px: 0.5, width: "100%", borderRadius: 1 }}>
      <Box sx={{ position: "absolute", top: 1, bottom: 1, [align]: 0, width: `${w}%`, bgcolor: fond(side) }} />
      <Typography sx={{ position: "relative", fontSize: 12, "@media (min-width:360px)": { fontSize: 13 }, fontWeight: 500, color: couleur(side), fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fPrix(n.prix)}</Typography>
      <Typography sx={{ position: "relative", fontSize: 12, "@media (min-width:360px)": { fontSize: 13 }, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", ml: 0.5 }}>{fUsdt(n.quantite)}</Typography>
    </ButtonBase>
  );
}

function MidPrice({ big }: { big?: boolean }) {
  const { data: c } = useCotation();
  const [precedent, setPrecedent] = useState<number | null>(null);
  const [sens, setSens] = useState<"haut" | "bas">("haut");
  useEffect(() => {
    if (c?.dernier == null) return;
    if (precedent !== null && c.dernier !== precedent) setSens(c.dernier > precedent ? "haut" : "bas");
    setPrecedent(c.dernier);
  }, [c?.dernier, precedent]);
  const col = sens === "haut" ? BUY : SELL;
  return (
    <Stack direction="row" alignItems="baseline" gap={0.75} sx={{ py: 0.75 }}>
      <Typography sx={{ fontSize: big ? 22 : 18, fontWeight: 700, color: col, fontVariantNumeric: "tabular-nums" }}>
        {c?.dernier != null ? fPrix(c.dernier) : "—"} {sens === "haut" ? "↑" : "↓"}
      </Typography>
    </Stack>
  );
}

function CompactBook({ onPick }: { onPick: (p: number) => void }) {
  const [pas, setPas] = useState(MARCHE.pasPrix);
  const [menuPas, setMenuPas] = useState<HTMLElement | null>(null);
  const { data: brut } = useCarnet(pas > MARCHE.pasPrix ? 60 : 7);
  const carnet = useMemo(() => (brut ? { achats: regrouper(brut.achats, pas, "achat").slice(0, 7), ventes: regrouper(brut.ventes, pas, "vente").slice(0, 7) } : undefined), [brut, pas]);
  const max = useMemo(() => Math.max(1, ...(carnet?.achats ?? []).map((n) => n.quantite), ...(carnet?.ventes ?? []).map((n) => n.quantite)), [carnet]);
  return (
    <Stack sx={{ flex: 1, minWidth: 0 }}>
      <Stack direction="row" justifyContent="space-between" sx={{ px: 0.5, mb: 0.5 }}>
        {/* « Prix (XAFe) » et « Qté (USDT) » ne tenaient pas sur un écran de 320 : l'unité passe dessous */}
        <Typography variant="caption" sx={{ lineHeight: 1.2 }}>Prix<br />XAFe</Typography>
        <Typography variant="caption" sx={{ lineHeight: 1.2, textAlign: "right" }}>Qté<br />USDT</Typography>
      </Stack>
      {!carnet ? <Squelette hauteur={360} radius={8} /> : (
        <>
          {[...carnet.ventes].reverse().map((n) => <BookRow key={`v${n.prix}`} n={n} max={max} side="vente" onPick={onPick} />)}
          <MidPrice />
          {carnet.achats.map((n) => <BookRow key={`a${n.prix}`} n={n} max={max} side="achat" onPick={onPick} />)}
        </>
      )}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
        <ButtonBase onClick={(e) => setMenuPas(e.currentTarget)} aria-label="Pas du carnet" sx={{ borderRadius: 2, px: 1, py: 0.25, bgcolor: "background.default", gap: 0.25 }}>
          <Typography variant="body2" sx={{ color: "text.primary", fontSize: 13 }}>{fPrix(pas)}</Typography>
          <ArrowDropDownRounded fontSize="small" />
        </ButtonBase>
        <Menu anchorEl={menuPas} open={Boolean(menuPas)} onClose={() => setMenuPas(null)}>
          {[MARCHE.pasPrix, 0.5, 1, 5].filter((x, i, t) => t.indexOf(x) === i).map((x) => (
            <MenuItem key={x} selected={x === pas} onClick={() => { setPas(x); setMenuPas(null); }}>{fPrix(x)}</MenuItem>
          ))}
        </Menu>
        <IconButton size="small" aria-label="Tout le carnet" component={Link} to="/marche/carnet"><FormatListBulletedRounded fontSize="small" /></IconButton>
      </Stack>
    </Stack>
  );
}

/* ------------------------------------------------------ formulaire d'ordre */

function Field({ label, value, unit, onChange, onStep, placeholder }: { label: string; value: string; unit?: string; onChange?: (v: string) => void; onStep?: (d: 1 | -1) => void; placeholder?: string }) {
  return (
    <Paper sx={{ bgcolor: "background.default", borderRadius: 2, height: 48, display: "flex", alignItems: "center", px: 0.5 }}>
      {onStep ? <IconButton size="small" aria-label="Moins" onClick={() => onStep(-1)}><RemoveRounded fontSize="small" /></IconButton> : <Box sx={{ width: 8 }} />}
      <Stack sx={{ flex: 1, alignItems: "center", minWidth: 0 }}>
        {onChange ? (
          <Box component="input" value={value} onChange={(e) => onChange((e.target as HTMLInputElement).value)} inputMode="decimal" placeholder={placeholder} aria-label={label}
            sx={{ width: "100%", height: 26, textAlign: "center", border: 0, outline: 0, bgcolor: "transparent", fontSize: 16, fontWeight: 600, fontFamily: "inherit", fontVariantNumeric: "tabular-nums", lineHeight: 1.1, p: 0, color: "text.primary" }} />
        ) : (
          <Typography sx={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
            {value}{unit && <Typography component="span" sx={{ fontSize: 11, color: "text.secondary", ml: 0.5 }}>{unit}</Typography>}
          </Typography>
        )}
        <Typography sx={{ fontSize: 11, color: "text.secondary", lineHeight: 1.1 }}>{label}</Typography>
      </Stack>
      {onStep ? <IconButton size="small" aria-label="Plus" onClick={() => onStep(1)}><AddRounded fontSize="small" /></IconButton> : <Box sx={{ width: 8 }} />}
    </Paper>
  );
}

function SideToggle({ side, onChange }: { side: Cote; onChange: (c: Cote) => void }) {
  return (
    <Stack direction="row" sx={{ height: 36, borderRadius: 2, overflow: "hidden", bgcolor: "background.default" }}>
      <ButtonBase onClick={() => onChange("achat")} sx={{ flex: 1, fontWeight: 700, fontSize: 14, bgcolor: side === "achat" ? BUY : "transparent", color: side === "achat" ? "#fff" : "text.secondary", clipPath: "polygon(0 0, 100% 0, 88% 100%, 0 100%)", mr: -1 }}>Acheter</ButtonBase>
      <ButtonBase onClick={() => onChange("vente")} sx={{ flex: 1, fontWeight: 700, fontSize: 14, bgcolor: side === "vente" ? SELL : "transparent", color: side === "vente" ? "#fff" : "text.secondary", clipPath: "polygon(12% 0, 100% 0, 100% 100%, 0 100%)", ml: -1 }}>Vendre</ButtonBase>
    </Stack>
  );
}

function Small({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center">
      <Typography sx={{ fontSize: 11, color: "text.secondary" }}>{label}</Typography>
      <Typography sx={{ fontSize: 11, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
    </Stack>
  );
}

const lireNombre = (s: string): number => {
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Ce que l'écran dit d'un ordre qui n'est pas entièrement exécuté. Le moteur
 * annule un ordre pour DEUX raisons : il aurait croisé l'un de vos ordres, ou
 * c'est un ordre au marché qui n'a rien (ou plus rien) trouvé en face — le
 * cas courant quand le carnet est mince. L'écran disait toujours la première.
 */
export function messageDOrdre(o: { etat: string; executee: number; restant: number; type: string; autoNegociation?: boolean; deja?: boolean }): string {
  const m =
    o.etat === "annule" || (o.type === "marche" && o.restant > 0 && o.executee === 0)
      ? o.autoNegociation
        ? "Ordre arrêté : il aurait croisé l'un de vos propres ordres."
        : "Ordre au marché annulé : il n'y avait personne en face. Placez un ordre limite pour attendre au carnet."
      : o.executee > 0
        ? o.type === "marche"
          ? "Ordre au marché exécuté en partie : le carnet n'avait pas assez en face, le reste est annulé."
          : "Ordre partiellement exécuté, le reste attend au carnet."
        : "Ordre placé au carnet.";
  /* une réponse perdue puis rejouée : le moteur rend l'ordre déjà parti, on le dit */
  return o.deja ? `Cet ordre était déjà parti. ${m}` : m;
}

function OrderForm({ onPlace }: { onPlace: (o: Ordre & { rempli: boolean; autoNegociation: boolean; deja: boolean }) => void }) {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const [f, poser] = useParcours("marche");
  const { data: soldes } = useSoldes();
  const { data: cotation } = useCotation();
  const { data: carnet } = useCarnet(30);
  const [typeOuvert, setTypeOuvert] = useState(false);
  const [confirme, setConfirme] = useState(false);
  /* l'intention de l'ordre : un prix ou une quantité changés font un autre ordre, avec sa propre clé */
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique("ord", { cote: f.cote, type: f.type, quantite: f.quantite, prix: f.type === "limite" ? f.prix : null });

  /* un prix par défaut : le meilleur en face, tant que rien n'a été tapé */
  useEffect(() => {
    if (f.prix === "" && cotation) {
      const p = f.cote === "achat" ? cotation.meilleureVente ?? cotation.dernier : cotation.meilleurAchat ?? cotation.dernier;
      if (p != null) poser({ prix: fPrix(p) });
    }
  }, [cotation, f.prix, f.cote, poser]);

  const prix = lireNombre(f.prix);
  const quantite = lireNombre(f.quantite);
  const dispoXafe = soldes?.XAFe.disponible ?? 0;
  const dispoUsdt = soldes?.USDT.disponible ?? 0;
  const prixRef = f.type === "limite" ? prix : (f.cote === "achat" ? cotation?.meilleureVente : cotation?.meilleurAchat) ?? cotation?.dernier ?? 0;
  const maxQ = f.cote === "achat" ? achatMax(dispoXafe, prixRef || 1) : arrondi2(dispoUsdt);
  const total = f.type === "limite" ? totalOrdre(quantite, prix) : simulerMarche(f.cote, quantite, (f.cote === "achat" ? carnet?.ventes : carnet?.achats) ?? [], f.cote === "achat" ? dispoXafe : Infinity).total;
  const frais = fraisOrdre(f.cote, quantite, prixRef || 0);
  const pct = maxQ > 0 ? Math.min(100, Math.round((quantite / maxQ) * 100)) : 0;
  const valide = quantiteValide(quantite) && (f.type === "marche" || prixValide(prix)) && quantite <= maxQ + 1e-9;

  const step = (champ: "prix" | "quantite", d: 1 | -1) => {
    if (champ === "prix") poser({ prix: fPrix(Math.max(MARCHE.pasPrix, arrondi2(prix + d * MARCHE.pasPrix))) });
    else poser({ quantite: String(Math.max(0, arrondi2(quantite + d * 10))) });
  };

  const placer = () =>
    lancer(async (cle) => {
      const r = await guichet.placerOrdre({ cote: f.cote, type: f.type, quantite, prix: f.type === "limite" ? prix : undefined, cle });
      setConfirme(false);
      poser({ quantite: "" });
      await rafraichir();
      onPlace({ ...r.ordre, rempli: r.ordre.executee > 0 && r.ordre.restant === 0, autoNegociation: r.autoNegociation, deja: Boolean(r.deja) });
    });

  return (
    /* 212 px de formulaire laissaient 40 px au carnet sur un écran de 320 : en dessous de 360, il prend 56 % */
    <Stack gap={1} sx={{ width: 212, flexShrink: 0, "@media (max-width:359px)": { width: "56%" } }}>
      <SideToggle side={f.cote} onChange={(c) => poser({ cote: c, prix: "" })} />
      <ButtonBase onClick={() => setTypeOuvert(true)} sx={{ borderRadius: 2 }}>
        <Paper sx={{ bgcolor: "background.default", borderRadius: 2, height: 40, display: "flex", alignItems: "center", px: 1.25, gap: 0.5, width: "100%" }}>
          <InfoOutlined sx={{ fontSize: 16, color: "text.secondary" }} />
          <Typography sx={{ flex: 1, fontSize: 14, fontWeight: 500, textAlign: "center" }}>{f.type === "limite" ? "Limite" : "Marché"}</Typography>
          <ArrowDropDownRounded fontSize="small" />
        </Paper>
      </ButtonBase>
      {f.type === "limite" ? (
        <Field label="Prix (XAFe)" value={f.prix} onChange={(v) => poser({ prix: v })} onStep={(d) => step("prix", d)} placeholder="618,40" />
      ) : (
        <Field label="Prix (XAFe)" value="Prix du marché" />
      )}
      <Field label="Quantité (USDT)" value={f.quantite} onChange={(v) => poser({ quantite: v })} onStep={(d) => step("quantite", d)} placeholder="0" />
      <Box sx={{ px: 1 }}>
        <Slider aria-label="Part du disponible" getAriaValueText={(v) => `${v} %`} value={pct} onChange={(_, v) => poser({ quantite: String(arrondi2((maxQ * (v as number)) / 100)) })} step={null} marks={[0, 25, 50, 75, 100].map((v) => ({ value: v }))} size="small"
          sx={{ color: "text.secondary", "& .MuiSlider-mark": { width: 8, height: 8, borderRadius: 4, bgcolor: "background.paper", border: 2, borderColor: "text.secondary" }, "& .MuiSlider-thumb": { width: 28, height: 28, bgcolor: "background.paper", border: 2, borderColor: "text.primary" } }} />
      </Box>
      <Field label="Total (XAFe)" value={total > 0 ? xaf(total) : "—"} />
      <Stack gap={0.25} sx={{ px: 0.25 }}>
        <Small label="Dispo" value={f.cote === "achat" ? `${xaf(dispoXafe)} XAFe` : `${enTranches(dispoUsdt, 2)} USDT`} />
        <Small label={f.cote === "achat" ? "Achat max" : "Vente max"} value={`${fUsdt(maxQ)} USDT`} />
        <Small label="Frais est." value={quantite > 0 ? `${frais.actif === "USDT" ? enTranches(frais.montant, 2) : xaf(frais.montant)} ${frais.actif}` : "—"} />
      </Stack>
      <Button variant="contained" disabled={!valide || enCours} onClick={() => setConfirme(true)} sx={{ bgcolor: couleur(f.cote), minHeight: 44, borderRadius: 2, "&:hover": { bgcolor: couleur(f.cote) } }}>
        {f.cote === "achat" ? "Acheter USDT" : "Vendre USDT"}
      </Button>

      <Feuille ouverte={typeOuvert} onFermer={() => setTypeOuvert(false)} titre="Type d'ordre">
        <Stack gap={1}>
          {([["limite", "Limite", `Vous fixez le prix. L'ordre attend au carnet jusqu'à trouver preneur. Frais ${pourcent(FRAIS.placeur)} s'il attend, ${pourcent(FRAIS.preneur)} s'il prend.`], ["marche", "Marché", `Exécuté tout de suite au meilleur prix disponible, jusqu'à ce que vos fonds soient épuisés. Frais ${pourcent(FRAIS.preneur)}.`]] as [TypeOrdre, string, string][]).map(([t, nom, aide]) => (
            <ButtonBase key={t} onClick={() => { poser({ type: t }); setTypeOuvert(false); }} sx={{ textAlign: "left", borderRadius: 3 }}>
              <Paper sx={{ p: 1.5, borderRadius: 3, width: "100%", bgcolor: f.type === t ? "#CDEFD9" : "background.default" }}>
                <Typography fontWeight={600}>{nom}</Typography>
                <Typography variant="body2">{aide}</Typography>
              </Paper>
            </ButtonBase>
          ))}
        </Stack>
      </Feuille>

      <Feuille ouverte={confirme} onFermer={() => setConfirme(false)} titre={`${f.cote === "achat" ? "Acheter" : "Vendre"} ${fUsdt(quantite)} USDT`}>
        <Stack gap={1.5}>
          <Card sx={{ p: 2, gap: 1 }}>
            <Line label="Type" value={f.type === "limite" ? "Limite" : "Marché"} />
            <Line label="Prix" value={f.type === "limite" ? `${fPrix(prix)} XAFe` : "au marché"} />
            <Line label="Quantité" value={`${fUsdt(quantite)} USDT`} />
            <Divider />
            <Line label={f.type === "limite" ? "Total" : "Total estimé"} value={`${xaf(total)} XAFe`} strong />
            <Line label="Frais estimés" value={`${frais.actif === "USDT" ? enTranches(frais.montant, 2) : xaf(frais.montant)} ${frais.actif}`} />
          </Card>
          <Typography variant="body2">
            {f.type === "limite"
              ? f.cote === "achat" ? `${xaf(total)} XAFe sont bloqués tant que l'ordre attend ; la différence revient si l'exécution se fait moins cher.` : `${fUsdt(quantite)} USDT sont bloqués tant que l'ordre attend.`
              : "Un ordre au marché prend ce qu'il trouve au carnet et s'arrête à vos fonds ; ce qui n'est pas exécuté est annulé."}
          </Typography>
          <Button variant="contained" disabled={enCours} onClick={() => void placer()} sx={{ bgcolor: couleur(f.cote), "&:hover": { bgcolor: couleur(f.cote) } }}>
            {enCours ? "Envoi…" : "Confirmer"}
          </Button>
        </Stack>
      </Feuille>
      <FeuilleErreur erreur={erreur} onFermer={effacerErreur} />
    </Stack>
  );
}

/* --------------------------------------------------------- ordres ouverts */

function Cell({ label, value, align }: { label: string; value: string; align?: "right" }) {
  return (
    <Stack sx={{ textAlign: align }}>
      <Typography sx={{ fontSize: 11, color: "text.secondary" }}>{label}</Typography>
      <Typography sx={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
    </Stack>
  );
}

function OpenOrder({ o, onCancel }: { o: Ordre; onCancel?: (id: string) => void }) {
  const ouvert = o.etat === "ouvert" || o.etat === "partiel";
  return (
    <Stack gap={1} sx={{ py: 1.5, borderTop: 1, borderColor: "divider" }}>
      <Stack direction="row" alignItems="center" gap={1}>
        <Chip label={o.cote === "achat" ? "Achat" : "Vente"} size="small" sx={{ height: 22, fontSize: 12, bgcolor: fond(o.cote), color: couleur(o.cote), fontWeight: 600 }} />
        <Typography component={Link} to={`/marche/ordres/${o.id}`} sx={{ fontWeight: 600, fontSize: 14, color: "inherit", textDecoration: "none", display: "inline-block", py: "6px" }}>USDT/XAFe</Typography>
        <Typography variant="caption" sx={{ "@media (max-width:359px)": { display: "none" } }}>{o.type === "limite" ? "Limite" : "Marché"}</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption">{heure(o.creeLe)}</Typography>
        {ouvert && onCancel ? (
          <Button size="small" variant="text" onClick={() => onCancel(o.id)} sx={{ minHeight: 28, px: 1, fontSize: 13 }}>Annuler</Button>
        ) : (
          <Chip label={{ execute: "Exécuté", annule: "Annulé", ouvert: "Ouvert", partiel: "Partiel" }[o.etat]} size="small" sx={{ height: 22, fontSize: 12 }} />
        )}
      </Stack>
      <Stack direction="row" justifyContent="space-between">
        <Cell label={ouvert ? "Prix" : "Prix moyen"} value={ouvert ? (o.prix != null ? fPrix(o.prix) : "marché") : o.prixMoyen != null ? fPrix(o.prixMoyen) : "—"} />
        <Cell label="Quantité" value={fUsdt(o.quantite)} />
        <Cell label="Exécuté" value={`${o.quantite > 0 ? Math.round((o.executee / o.quantite) * 100) : 0} %`} />
        <Cell label="Total" value={ouvert && o.prix != null ? xaf(o.prix * o.quantite) : xaf(o.totalXafe)} align="right" />
      </Stack>
    </Stack>
  );
}

/* un ordre exécuté, comme la maquette : prix moyen, quantité, total */
function OrdreFait({ o }: { o: Ordre }) {
  return (
    <Stack component={Link} to={`/marche/ordres/${o.id}`} gap={0.75} sx={{ py: 1.5, borderTop: 1, borderColor: "divider", color: "inherit", textDecoration: "none" }}>
      <Stack direction="row" alignItems="center" gap={1}>
        <Chip label={o.cote === "achat" ? "Achat" : "Vente"} size="small" sx={{ height: 22, fontSize: 12, bgcolor: fond(o.cote), color: couleur(o.cote), fontWeight: 600 }} />
        <Typography sx={{ fontWeight: 600, fontSize: 14 }}>USDT/XAFe</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption">{heure(o.majLe ?? o.creeLe)}</Typography>
        <Chip label={o.etat === "execute" ? "Exécuté" : "Partiel"} size="small" sx={{ height: 22, fontSize: 12 }} />
      </Stack>
      <Stack direction="row" justifyContent="space-between">
        <Cell label="Prix moyen" value={o.prixMoyen != null ? fPrix(o.prixMoyen) : "—"} />
        <Cell label="Quantité" value={fUsdt(o.executee)} />
        <Cell label="Total (XAFe)" value={xaf(o.rapide?.total ?? o.totalXafe)} align="right" />
      </Stack>
    </Stack>
  );
}

function useAnnuler() {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const [erreur, setErreur] = useState<unknown>(null);
  const annuler = async (id: string) => {
    try { await guichet.annulerOrdre(id); await rafraichir(); } catch (e) { setErreur(e); }
  };
  return { annuler, erreur, effacer: () => setErreur(null) };
}

/* ================================================== 1 · écran de trading */

/* l'onglet « Actifs » : ce que le compte a, disponible et bloqué au carnet */
function Actifs() {
  const { data: soldes } = useSoldes();
  if (!soldes) return <Squelette hauteur={80} radius={12} />;
  return (
    <Stack>
      {(["XAFe", "USDT"] as const).map((a) => (
        <Stack key={a} direction="row" alignItems="center" gap={1.5} sx={{ py: 1.5, borderTop: 1, borderColor: "divider" }}>
          <Badge kind={a === "XAFe" ? "xafe" : "usdt"} size={36} />
          <Typography sx={{ fontWeight: 600, flex: 1 }}>{a}</Typography>
          <Stack alignItems="flex-end">
            <Typography sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{a === "XAFe" ? xaf(Math.trunc(soldes[a].disponible)) : fUsdt(soldes[a].disponible)}</Typography>
            <Typography variant="caption">{soldes[a].bloque > 0 ? `${a === "XAFe" ? xaf(soldes[a].bloque) : fUsdt(soldes[a].bloque)} bloqués au carnet` : "disponible"}</Typography>
          </Stack>
        </Stack>
      ))}
    </Stack>
  );
}

export function Marche() {
  const navigate = useNavigate();
  const { data: ordres } = useMesOrdres();
  const [, poser] = useParcours("marche");
  const [place, setPlace] = useState<string | null>(null);
  const { annuler, erreur, effacer } = useAnnuler();
  const [bas, setBas] = useState<"ouverts" | "actifs">("ouverts");
  const ouverts = (ordres ?? []).filter((o) => o.etat === "ouvert" || o.etat === "partiel");
  const grand = useMediaQuery("(min-width:1200px)", { noSsr: true });
  /* sous 360, « Ordres ouverts » poussait « Actifs » sous « Tout voir » */
  const etroit = useMediaQuery("(max-width:359px)", { noSsr: true });

  return (
    <Screen tab="marche" large={1440} gap={0}>
      {/* Sur un ordinateur, le graphique à gauche et l'ordre à droite, comme sur toutes les places de
          marché : on regarde le prix ET on agit, sans changer d'écran. Ailleurs, une colonne. */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0,1fr)", lg: "minmax(0,1fr) 560px" }, gap: 3, alignItems: "start", width: "100%", maxWidth: { xs: 600, lg: "none" }, mx: "auto" }}>
      {grand && <PanneauGraphique />}
      <Box>
      <Box sx={{ mx: -2 }}><PairHeader /></Box>
      <Paper sx={{ p: 1.5, borderRadius: 4 }}>
        <Stack direction="row" gap={1.5}>
          <OrderForm onPlace={(o) => (o.rempli ? navigate(`/marche/execute/${o.id}`) : setPlace(messageDOrdre(o)))} />
          <CompactBook onPick={(p) => poser({ prix: fPrix(p), type: "limite" })} />
        </Stack>
      </Paper>
      <Box sx={{ mt: 1.5 }}>
        <Stack direction="row" alignItems="center">
          <Tabs value={bas} onChange={(_, v) => setBas(v)} variant="scrollable" scrollButtons={false} sx={{ minHeight: 40, flex: 1, minWidth: 0 }}>
            <Tab value="ouverts" label={`${etroit ? "Ouverts" : "Ordres ouverts"} (${ouverts.length})`} sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
            <Tab value="actifs" label="Actifs" sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
          </Tabs>
          <Button size="small" variant="text" component={Link} to="/marche/ordres" sx={{ minHeight: 32, fontSize: 13 }}>Tout voir</Button>
        </Stack>
        {bas === "actifs" ? <Actifs /> : !ordres ? <Squelette hauteur={80} radius={12} /> : ouverts.length === 0 ? (
          <Typography variant="body2" sx={{ py: 2, textAlign: "center" }}>Aucun ordre en attente.</Typography>
        ) : ouverts.slice(0, 3).map((o) => <OpenOrder key={o.id} o={o} onCancel={(id) => void annuler(id)} />)}
      </Box>
      </Box>
      </Box>
      <Snackbar open={Boolean(place)} autoHideDuration={3500} onClose={() => setPlace(null)} message={place} anchorOrigin={{ vertical: "bottom", horizontal: "center" }} sx={{ bottom: { xs: 96 } }} />
      <FeuilleErreur erreur={erreur} onFermer={effacer} />
    </Screen>
  );
}

/* ====================================================== 2 · graphique */

function Candles({ chandelles, dernier }: { chandelles: Chandelle[]; dernier: number | null }) {
  const W = 376, H = 200, VH = 44, top = 8, bottom = 8;
  if (chandelles.length === 0) return <Squelette hauteur={H + VH + 24} radius={12} />;
  const min = Math.min(...chandelles.map((c) => c.l)) - 0.3;
  const max = Math.max(...chandelles.map((c) => c.h)) + 0.3;
  const y = (p: number) => top + ((max - p) / (max - min)) * (H - top - bottom);
  const step = W / chandelles.length;
  const vmax = Math.max(1, ...chandelles.map((c) => c.v));
  const grille = [min + (max - min) * 0.2, min + (max - min) * 0.5, min + (max - min) * 0.8].map((g) => Math.round(g * 2) / 2);
  return (
    <svg width="100%" viewBox={`0 0 ${W + 44} ${H + VH + 24}`} role="img" aria-label={`Chandeliers, de ${fPrix(min)} à ${fPrix(max)} XAFe`}>
      {grille.map((g) => (
        <g key={g}>
          <line x1="0" y1={y(g)} x2={W} y2={y(g)} stroke="#E3E7E3" />
          <text x={W + 6} y={y(g) + 4} fontSize="11" fill="#5B615E">{g.toFixed(1)}</text>
        </g>
      ))}
      {dernier != null && dernier > min && dernier < max && (
        <>
          <line x1="0" y1={y(dernier)} x2={W} y2={y(dernier)} stroke={BUY} strokeDasharray="3 3" />
          <rect x={W + 2} y={y(dernier) - 8} width="42" height="16" rx="3" fill={BUY} />
          <text x={W + 23} y={y(dernier) + 4} fontSize="11" fill="#fff" textAnchor="middle">{dernier.toFixed(1)}</text>
        </>
      )}
      {chandelles.map((c, i) => {
        const x = i * step + step / 2;
        const up = c.c >= c.o;
        const col = up ? BUY : SELL;
        return (
          <g key={c.t}>
            <line x1={x} y1={y(c.h)} x2={x} y2={y(c.l)} stroke={col} strokeWidth="1.2" />
            <rect x={x - step * 0.3} y={y(Math.max(c.o, c.c))} width={step * 0.6} height={Math.max(1.5, Math.abs(y(c.o) - y(c.c)))} fill={col} />
            <rect x={x - step * 0.3} y={H + 12 + (VH - (c.v / vmax) * VH)} width={step * 0.6} height={(c.v / vmax) * VH} fill={col} opacity="0.45" />
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

const INTERVALLES: [string, number][] = [["15 min", 15], ["1 h", 60], ["4 h", 240], ["1 j", 1440], ["1 sem", 10080]];
const PLUS: [string, number][] = [["5 min", 5], ["30 min", 30], ["1 mois", 43200]];

/** Le graphique, en panneau, à côté du formulaire d'ordre sur un grand écran. */
function PanneauGraphique() {
  const { data: c } = useCotation();
  const [minutes, setMinutes] = useState(60);
  const { data: chandelles } = useChandelles(minutes, 40);
  const v = c?.variation24h ?? 0;
  return (
    <Paper sx={{ p: 2.5, borderRadius: 6, display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" flexWrap="wrap" gap={2}>
        <Stack>
          <Typography variant="caption">USDT/XAFe · dernier prix</Typography>
          <Typography sx={{ fontSize: 30, fontWeight: 700, color: v >= 0 ? BUY : SELL, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{c?.dernier != null ? fPrix(c.dernier) : "—"}</Typography>
        </Stack>
        <Stack direction="row" gap={3}>
          <Stat label="Variation 24 h" value={`${v >= 0 ? "+" : ""}${enTranches(v, 2)} %`} />
          <Stat label="Haut 24 h" value={c?.haut24h != null ? fPrix(c.haut24h) : "—"} />
          <Stat label="Bas 24 h" value={c?.bas24h != null ? fPrix(c.bas24h) : "—"} />
          <Stat label="Volume 24 h (USDT)" value={c ? fUsdt(Math.round(c.volume24hUsdt)) : "—"} />
        </Stack>
      </Stack>
      <Stack direction="row" gap={0.75} flexWrap="wrap">
        {INTERVALLES.map(([t, m]) => (
          <Chip key={t} label={t} onClick={() => setMinutes(m)} variant={m === minutes ? "filled" : "outlined"} color={m === minutes ? "primary" : undefined} />
        ))}
      </Stack>
      <Candles chandelles={chandelles ?? []} dernier={c?.dernier ?? null} />
    </Paper>
  );
}

export function MarcheGraphique() {
  const navigate = useNavigate();
  const { data: c } = useCotation();
  const [minutes, setMinutes] = useState(60);
  const [plus, setPlus] = useState<HTMLElement | null>(null);
  const { data: chandelles } = useChandelles(minutes, 28);
  const { data: carnet } = useCarnet(5);
  const [onglet, setOnglet] = useState<"carnet" | "infos">("carnet");
  const [, poser] = useParcours("marche");
  const v = c?.variation24h ?? 0;
  const max = Math.max(1, ...(carnet?.achats ?? []).map((n) => n.quantite), ...(carnet?.ventes ?? []).map((n) => n.quantite));
  const aller = (cote: Cote) => { poser({ cote, prix: "" }); navigate("/marche"); };

  return (
    <Screen back="/marche" title="USDT/XAFe" gap={1.5}>
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between">
        <Stack>
          <Typography sx={{ fontSize: 30, fontWeight: 700, color: v >= 0 ? BUY : SELL, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{c?.dernier != null ? fPrix(c.dernier) : "—"}</Typography>
          <Typography variant="body2">
            <Box component="span" sx={{ color: v >= 0 ? BUY : SELL, fontWeight: 600 }}>{v >= 0 ? "+" : ""}{enTranches(v, 2)} %</Box>
          </Typography>
        </Stack>
        <Stack direction="row" gap={2.5}>
          <Stat label="Haut 24 h" value={c?.haut24h != null ? fPrix(c.haut24h) : "—"} />
          <Stat label="Bas 24 h" value={c?.bas24h != null ? fPrix(c.bas24h) : "—"} />
          <Stat label="Vol 24 h (USDT)" value={c ? fUsdt(Math.round(c.volume24hUsdt)) : "—"} />
        </Stack>
      </Stack>
      <Stack direction="row" gap={0.5}>
        {INTERVALLES.map(([t, m]) => (
          <Chip key={t} label={t} size="small" onClick={() => setMinutes(m)} variant={m === minutes ? "filled" : "outlined"} color={m === minutes ? "primary" : undefined} sx={{ height: 28, fontSize: 12 }} />
        ))}
        {(() => { const autre = PLUS.find(([, m]) => m === minutes); return (
          <Chip label={autre ? autre[0] : "Plus"} size="small" onClick={(e) => setPlus(e.currentTarget)} variant={autre ? "filled" : "outlined"} color={autre ? "primary" : undefined} sx={{ height: 28, fontSize: 12 }} />
        ); })()}
        <Menu anchorEl={plus} open={Boolean(plus)} onClose={() => setPlus(null)}>
          {PLUS.map(([t, m]) => <MenuItem key={t} onClick={() => { setMinutes(m); setPlus(null); }}>{t}</MenuItem>)}
        </Menu>
      </Stack>
      <Paper sx={{ p: 1, borderRadius: 3 }}>
        <Candles chandelles={chandelles ?? []} dernier={c?.dernier ?? null} />
      </Paper>
      <Tabs value={onglet} onChange={(_, val) => (val === "trades" ? navigate("/marche/carnet") : setOnglet(val))} variant="fullWidth" sx={{ minHeight: 40, "& .MuiTab-root": { minWidth: 0, px: 1, "@media (max-width:359px)": { fontSize: 13, px: 0.5 } } }}>
        <Tab value="carnet" label="Carnet" sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
        <Tab value="trades" label="Transactions" sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
        <Tab value="infos" label="Infos" sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
      </Tabs>
      {onglet === "carnet" ? (
        <Stack direction="row" gap={2}>
          <Stack sx={{ flex: 1 }}>
            <Stack direction="row" justifyContent="space-between"><Typography variant="caption">Qté</Typography><Typography variant="caption">Achat</Typography></Stack>
            {(carnet?.achats ?? []).map((n) => (
              <Box key={n.prix} sx={{ position: "relative", display: "flex", justifyContent: "space-between", height: 24, alignItems: "center" }}>
                <Box sx={{ position: "absolute", top: 1, bottom: 1, right: 0, width: `${Math.round((n.quantite / max) * 100)}%`, bgcolor: BUY_BG }} />
                <Typography sx={{ position: "relative", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{fUsdt(n.quantite)}</Typography>
                <Typography sx={{ position: "relative", fontSize: 13, fontWeight: 500, color: BUY, fontVariantNumeric: "tabular-nums" }}>{fPrix(n.prix)}</Typography>
              </Box>
            ))}
          </Stack>
          <Stack sx={{ flex: 1 }}>
            <Stack direction="row" justifyContent="space-between"><Typography variant="caption">Vente</Typography><Typography variant="caption">Qté</Typography></Stack>
            {(carnet?.ventes ?? []).map((n) => (
              <Box key={n.prix} sx={{ position: "relative", display: "flex", justifyContent: "space-between", height: 24, alignItems: "center" }}>
                <Box sx={{ position: "absolute", top: 1, bottom: 1, left: 0, width: `${Math.round((n.quantite / max) * 100)}%`, bgcolor: SELL_BG }} />
                <Typography sx={{ position: "relative", fontSize: 13, fontWeight: 500, color: SELL, fontVariantNumeric: "tabular-nums" }}>{fPrix(n.prix)}</Typography>
                <Typography sx={{ position: "relative", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{fUsdt(n.quantite)}</Typography>
              </Box>
            ))}
          </Stack>
        </Stack>
      ) : (
        <Card sx={{ gap: 1 }}>
          <Line label="Paire" value="USDT / XAFe" />
          <Line label="Prix en" value="XAFe par USDT" />
          <Line label="Pas de prix" value={fPrix(MARCHE.pasPrix)} />
          <Line label="Quantité minimale" value={`${MARCHE.quantiteMin} USDT`} />
          <Line label="Frais placeur · preneur" value={`${pourcent(FRAIS.placeur)} · ${pourcent(FRAIS.preneur)}`} />
          <Line label="1 XAFe" value="1 XAF, garanti par les floats MoMo et les banques" />
        </Card>
      )}
      <Box sx={{ flex: 1 }} />
      <Stack direction="row" gap={1.5}>
        <Button fullWidth variant="contained" onClick={() => aller("achat")} sx={{ bgcolor: BUY, borderRadius: 2, "&:hover": { bgcolor: BUY } }}>Acheter</Button>
        <Button fullWidth variant="contained" onClick={() => aller("vente")} sx={{ bgcolor: SELL, borderRadius: 2, "&:hover": { bgcolor: SELL } }}>Vendre</Button>
      </Stack>
    </Screen>
  );
}

/* ========================================= 3 · carnet complet + transactions */

/* Regrouper le carnet par pas de prix : les achats vers le bas, les ventes vers le haut — on ne promet jamais un meilleur prix que le vrai. */
function regrouper(niveaux: Niveau[], pas: number, cote: Cote): Niveau[] {
  if (pas <= MARCHE.pasPrix) return niveaux;
  const m = new Map<number, number>();
  for (const n of niveaux) {
    const p = arrondi2((cote === "achat" ? Math.floor(n.prix / pas + 1e-9) : Math.ceil(n.prix / pas - 1e-9)) * pas);
    m.set(p, arrondi2((m.get(p) ?? 0) + n.quantite));
  }
  return [...m].map(([prix, quantite]) => ({ prix, quantite })).sort((a, b) => (cote === "achat" ? b.prix - a.prix : a.prix - b.prix)).slice(0, 12);
}

export function MarcheCarnet() {
  const navigate = useNavigate();
  const [onglet, setOnglet] = useState<"carnet" | "trades">("carnet");
  const [pas, setPas] = useState(MARCHE.pasPrix);
  const [menuPas, setMenuPas] = useState<HTMLElement | null>(null);
  const { data: brut } = useCarnet(pas > MARCHE.pasPrix ? 60 : 12);
  const carnet = brut ? { achats: regrouper(brut.achats, pas, "achat"), ventes: regrouper(brut.ventes, pas, "vente") } : undefined;
  const { data: trades } = useTransactions(20);
  const [filtre, setFiltre] = useState<"Tout" | "Achats" | "Ventes">("Tout");
  const [, poser] = useParcours("marche");
  const max = Math.max(1, ...(carnet?.achats ?? []).map((n) => n.quantite), ...(carnet?.ventes ?? []).map((n) => n.quantite));
  const totalA = (carnet?.achats ?? []).reduce((s, n) => s + n.quantite, 0);
  const totalV = (carnet?.ventes ?? []).reduce((s, n) => s + n.quantite, 0);
  const pctA = totalA + totalV > 0 ? Math.round((totalA / (totalA + totalV)) * 100) : 50;
  const choisir = (p: number) => { poser({ prix: fPrix(p), type: "limite" }); navigate("/marche"); };

  const colonne = (niveaux: Niveau[], side: Cote) => (
    <Stack sx={{ flex: 1 }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="caption">{side === "achat" ? "Qté (USDT)" : "Vente (XAFe)"}</Typography>
        <Typography variant="caption">{side === "achat" ? "Achat (XAFe)" : "Qté (USDT)"}</Typography>
      </Stack>
      {niveaux.map((n) => (
        <ButtonBase key={n.prix} onClick={() => choisir(n.prix)} sx={{ position: "relative", display: "flex", justifyContent: "space-between", height: 26, alignItems: "center", px: 0.5, width: "100%" }}>
          <Box sx={{ position: "absolute", top: 1, bottom: 1, [side === "achat" ? "right" : "left"]: 0, width: `${Math.round((n.quantite / max) * 100)}%`, bgcolor: fond(side) }} />
          <Typography sx={{ position: "relative", fontSize: 13, fontVariantNumeric: "tabular-nums", fontWeight: side === "vente" ? 500 : 400, color: side === "vente" ? SELL : undefined }}>{side === "achat" ? fUsdt(n.quantite) : fPrix(n.prix)}</Typography>
          <Typography sx={{ position: "relative", fontSize: 13, fontVariantNumeric: "tabular-nums", fontWeight: side === "achat" ? 500 : 400, color: side === "achat" ? BUY : undefined }}>{side === "achat" ? fPrix(n.prix) : fUsdt(n.quantite)}</Typography>
        </ButtonBase>
      ))}
    </Stack>
  );

  return (
    <Screen back="/marche" title="USDT/XAFe" gap={1}>
      <Tabs value={onglet} onChange={(_, v) => setOnglet(v)} variant="fullWidth" sx={{ minHeight: 40, "& .MuiTab-root": { minWidth: 0, px: 1, "@media (max-width:359px)": { fontSize: 13, px: 0.5 } } }}>
        <Tab value="carnet" label="Carnet d'ordres" sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
        <Tab value="trades" label="Transactions" sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
      </Tabs>
      {onglet === "carnet" && <>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Stack direction="row" gap={0.5}>
          {(["Tout", "Achats", "Ventes"] as const).map((t) => (
            <Chip key={t} label={t} size="small" onClick={() => setFiltre(t)} variant={t === filtre ? "filled" : "outlined"} color={t === filtre ? "primary" : undefined} sx={{ height: 28, fontSize: 12 }} />
          ))}
        </Stack>
        <ButtonBase onClick={(e) => setMenuPas(e.currentTarget)} aria-label="Pas de prix" sx={{ borderRadius: 2, px: 1, py: 0.5, bgcolor: "background.paper", gap: 0.25 }}>
          <Typography variant="body2" sx={{ color: "text.primary" }}>Pas {fPrix(pas)}</Typography>
          <ArrowDropDownRounded fontSize="small" />
        </ButtonBase>
        <Menu anchorEl={menuPas} open={Boolean(menuPas)} onClose={() => setMenuPas(null)}>
          {[MARCHE.pasPrix, 0.5, 1, 5].filter((x, i, t) => t.indexOf(x) === i).map((x) => (
            <MenuItem key={x} selected={x === pas} onClick={() => { setPas(x); setMenuPas(null); }}>Pas {fPrix(x)}</MenuItem>
          ))}
        </Menu>
      </Stack>
      <Paper sx={{ p: 1.5, borderRadius: 3 }}>
        {!carnet ? <Squelette hauteur={330} radius={8} /> : (
          <Stack direction="row" gap={2}>
            {filtre !== "Ventes" && colonne(carnet.achats, "achat")}
            {filtre !== "Achats" && colonne(carnet.ventes, "vente")}
          </Stack>
        )}
        <Stack direction="row" alignItems="center" gap={1} sx={{ mt: 1.5 }}>
          <Typography sx={{ fontSize: 12, color: BUY, fontWeight: 600 }}>A {pctA} %</Typography>
          <Box sx={{ flex: 1, height: 6, borderRadius: 3, overflow: "hidden", display: "flex" }}>
            <Box sx={{ width: `${pctA}%`, bgcolor: BUY }} />
            <Box sx={{ width: `${100 - pctA}%`, bgcolor: SELL }} />
          </Box>
          <Typography sx={{ fontSize: 12, color: SELL, fontWeight: 600 }}>{100 - pctA} % V</Typography>
        </Stack>
      </Paper>
      </>}
      {onglet === "trades" && <Paper sx={{ p: 1.5, borderRadius: 3 }}>
        <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
          <Typography variant="caption">Heure</Typography>
          <Typography variant="caption">Prix (XAFe)</Typography>
          <Typography variant="caption">Qté (USDT)</Typography>
        </Stack>
        {(trades ?? []).map((t, i) => (
          <Stack key={`${t.quand}-${i}`} direction="row" justifyContent="space-between" sx={{ height: 26, alignItems: "center" }}>
            <Typography sx={{ fontSize: 13, color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>{heureSecondes(t.quand)}</Typography>
            <Typography sx={{ fontSize: 13, fontWeight: 500, color: couleur(t.cote), fontVariantNumeric: "tabular-nums" }}>{fPrix(t.prix)}</Typography>
            <Typography sx={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{fUsdt(t.quantite)}</Typography>
          </Stack>
        ))}
      </Paper>}
    </Screen>
  );
}

/* ================================================= 4 · ordres (page) */

export function MarcheOrdres() {
  const { data: ordres } = useMesOrdres();
  const [onglet, setOnglet] = useState<"ouverts" | "historique" | "executions">("ouverts");
  const [toutAnnuler, setToutAnnuler] = useState(false);
  const { annuler, erreur, effacer } = useAnnuler();
  const ouverts = (ordres ?? []).filter((o) => o.etat === "ouvert" || o.etat === "partiel");
  const clos = (ordres ?? []).filter((o) => o.etat === "execute" || o.etat === "annule");
  const executes = (ordres ?? []).filter((o) => o.executee > 0);
  const aujourdHui = executes.filter((o) => jourRelatif(o.majLe ?? o.creeLe) === jourRelatif(new Date().toISOString()));
  const liste = onglet === "executions" ? executes : clos;
  const groupes = new Map<string, Ordre[]>();
  for (const o of liste) groupes.set(jourRelatif(o.creeLe), [...(groupes.get(jourRelatif(o.creeLe)) ?? []), o]);

  return (
    <Screen back="/marche" title="Ordres" gap={1}>
      <Tabs value={onglet} onChange={(_, v) => setOnglet(v)} variant="fullWidth" sx={{ minHeight: 40, "& .MuiTab-root": { minWidth: 0, px: 1, "@media (max-width:359px)": { fontSize: 13, px: 0.5 } } }}>
        <Tab value="ouverts" label={`Ouverts (${ouverts.length})`} sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
        <Tab value="historique" label="Historique" sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
        <Tab value="executions" label="Exécutions" sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
      </Tabs>
      {onglet === "ouverts" ? (
        <>
          <Paper sx={{ px: 2, borderRadius: 3 }}>
            {ouverts.length === 0 ? <Typography variant="body2" sx={{ py: 3, textAlign: "center" }}>Aucun ordre en attente.</Typography> : ouverts.map((o) => <OpenOrder key={o.id} o={o} onCancel={(id) => void annuler(id)} />)}
          </Paper>
          {ouverts.length > 1 && <Button variant="outlined" color="error" onClick={() => setToutAnnuler(true)}>Tout annuler</Button>}
          {aujourdHui.length > 0 && <>
            <Typography variant="subtitle1" sx={{ mt: 1 }}>Aujourd'hui</Typography>
            <Paper sx={{ px: 2, borderRadius: 3 }}>{aujourdHui.slice(0, 5).map((o) => <OrdreFait key={o.id} o={o} />)}</Paper>
          </>}
        </>
      ) : liste.length === 0 ? (
        <Typography variant="body2" sx={{ py: 3, textAlign: "center" }}>Pas encore d'ordre exécuté.</Typography>
      ) : (
        [...groupes].map(([jour, os]) => (
          <Box key={jour}>
            <Typography variant="subtitle1" sx={{ my: 1 }}>{jour}</Typography>
            <Paper sx={{ px: 2, borderRadius: 3 }}>{os.map((o) => (onglet === "executions" ? <OrdreFait key={o.id} o={o} /> : <OpenOrder key={o.id} o={o} />))}</Paper>
          </Box>
        ))
      )}
      <Feuille ouverte={toutAnnuler} onFermer={() => setToutAnnuler(false)} titre={`Annuler ${ouverts.length} ordres ?`}>
        <Stack gap={1.5}>
          <Typography variant="body2">Les fonds bloqués reviennent en disponible, tout de suite.</Typography>
          <Button variant="contained" color="error" onClick={async () => { for (const o of ouverts) await annuler(o.id); setToutAnnuler(false); }}>Tout annuler</Button>
          <Button variant="text" onClick={() => setToutAnnuler(false)}>Garder</Button>
        </Stack>
      </Feuille>
      <FeuilleErreur erreur={erreur} onFermer={effacer} />
    </Screen>
  );
}

/* ============================================ 5 · détail d'un ordre */

function LigneExecution({ e }: { e: Execution }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 1, borderTop: 1, borderColor: "divider" }}>
      <Stack>
        <Typography sx={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{fUsdt(e.quantite)} USDT à {fPrix(e.prix)}</Typography>
        <Typography variant="caption">{heureSecondes(e.quand)} · {e.preneur ? "preneur" : "placeur"} · frais {e.fraisActif === "USDT" ? enTranches(e.frais, 2) : xaf(e.frais)} {e.fraisActif}</Typography>
      </Stack>
      <Typography sx={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{xaf(e.montantXafe)} XAFe</Typography>
    </Stack>
  );
}

export function MarcheOrdreDetail() {
  const { id } = useParams();
  const { data, error } = useOrdre(id);
  const { annuler, erreur, effacer } = useAnnuler();
  if (!data) return <Attente erreur={error} title="Ordre" back="/marche/ordres" hauteur={260} />;
  const { ordre: o, executions } = data;
  const ouvert = o.etat === "ouvert" || o.etat === "partiel";
  return (
    <Screen title={`${o.cote === "achat" ? "Achat" : "Vente"} ${fUsdt(o.quantite)} USDT`} back="/marche/ordres">
      <Card>
        <Stack direction="row" alignItems="center" gap={1}>
          <Chip label={o.cote === "achat" ? "Achat" : "Vente"} size="small" sx={{ height: 24, bgcolor: fond(o.cote), color: couleur(o.cote), fontWeight: 600 }} />
          <Chip label={{ execute: "Exécuté", annule: "Annulé", ouvert: "Ouvert", partiel: "Partiel" }[o.etat]} size="small" sx={{ height: 24 }} />
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption">{jourRelatif(o.creeLe)} · {heure(o.creeLe)}</Typography>
        </Stack>
        <Line label="Type" value={o.type === "limite" ? "Limite" : "Marché"} />
        {o.prix != null && <Line label="Prix limite" value={`${fPrix(o.prix)} XAFe`} />}
        <Line label="Exécuté" value={`${fUsdt(o.executee)} / ${fUsdt(o.quantite)} USDT`} />
        {o.prixMoyen != null && <Line label="Prix moyen" value={`${fPrix(o.prixMoyen)} XAFe`} />}
        <Line label="Total" value={`${xaf(o.totalXafe)} XAFe`} strong />
        {ouvert && o.bloque > 0 && <Line label="Bloqué" value={`${o.cote === "achat" ? xaf(o.bloque) : fUsdt(o.bloque)} ${o.cote === "achat" ? "XAFe" : "USDT"}`} />}
        <Line label="Référence" value={o.numero} mono />
      </Card>
      {executions.length > 0 && (
        <Paper sx={{ px: 2, pb: 1, borderRadius: 3 }}>
          <Typography variant="subtitle1" sx={{ py: 1.5 }}>Exécutions</Typography>
          {executions.map((e) => <LigneExecution key={e.id} e={e} />)}
        </Paper>
      )}
      <Box sx={{ flex: 1 }} />
      {ouvert && <Button variant="outlined" color="error" onClick={() => void annuler(o.id)}>Annuler l'ordre</Button>}
      <FeuilleErreur erreur={erreur} onFermer={effacer} />
    </Screen>
  );
}

/* ================================================ 6 · ordre exécuté */

export function MarcheExecute() {
  const { id } = useParams();
  const { data, error } = useOrdre(id);
  if (!data) return <Attente erreur={error} back="/marche" />;
  const { ordre: o, executions } = data;
  const frais = executions.reduce((s, e) => s + e.frais, 0);
  const fraisActif = o.cote === "achat" ? "USDT" : "XAFe";
  /* ce qui ARRIVE sur le compte, frais déduits — pas la quantité négociée */
  const recu = o.cote === "achat" ? arrondi2(o.executee - frais) : o.totalXafe - frais;
  return (
    <Success
      title="Ordre exécuté"
      amount={o.cote === "achat" ? `+${enTranches(recu, 2)} USDT` : `+${xaf(recu)} XAFe`}
      caption={o.cote === "achat" ? `Pour ${xaf(o.totalXafe)} XAFe, au prix moyen de ${o.prixMoyen != null ? fPrix(o.prixMoyen) : "—"}.` : `Pour ${fUsdt(o.executee)} USDT, au prix moyen de ${o.prixMoyen != null ? fPrix(o.prixMoyen) : "—"}.`}
      primary={{ label: "Retour au marché", to: "/marche" }}
      secondary={{ label: "Voir mon portefeuille", to: "/" }}
    >
      <Card>
        <Line label="Frais" value={`${fraisActif === "USDT" ? enTranches(frais, 2) : xaf(frais)} ${fraisActif}`} />
        <Line label="Exécutions" value={String(executions.length)} />
        <Line label="Référence" value={o.numero} mono />
      </Card>
    </Success>
  );
}

