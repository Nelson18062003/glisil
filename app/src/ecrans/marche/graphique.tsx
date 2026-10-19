/*
 * Le graphique du marché, façon TradingView — avec la bibliothèque que
 * TradingView publie (lightweight-charts, Apache 2.0).
 *
 *   · un axe des DATES, à l'heure de Douala ;
 *   · bougies, barres, ligne ou zone ; de la minute au mois ;
 *   · on fait glisser vers la gauche pour remonter le temps : les pages plus
 *     anciennes arrivent d'elles-mêmes (bougies(intervalle, avant, n), 0025) ;
 *   · on zoome à la molette ou en pinçant ; les plages 1J… Tout règlent
 *     l'intervalle et la fenêtre d'un geste ;
 *   · le réticule dit la date, l'ouverture, le haut, le bas, la clôture.
 *
 * Avant le premier échange de Glisil, les bougies sont le cours de RÉFÉRENCE
 * du dollar (BCE, 655,957 / EUR/USD) : dessinées plus pâles, dites comme telles
 * dans la légende, et une flèche marque l'ouverture du marché.
 */
import CandlestickChartRounded from "@mui/icons-material/CandlestickChartRounded";
import LastPageRounded from "@mui/icons-material/LastPageRounded";
import ShowChartRounded from "@mui/icons-material/ShowChartRounded";
import SsidChartRounded from "@mui/icons-material/SsidChartRounded";
import StackedLineChartRounded from "@mui/icons-material/StackedLineChartRounded";
import { Box, ButtonBase, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Tooltip, Typography } from "@mui/material";
import {
  AreaSeries, BarSeries, CandlestickSeries, ColorType, createChart, createSeriesMarkers, CrosshairMode, HistogramSeries, LineSeries,
  type IChartApi, type ISeriesApi, type ISeriesMarkersPluginApi, type LogicalRange, type MouseEventParams, type SeriesType, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useGuichet } from "../../guichet";
import type { Bougie, Intervalle, Niveau } from "../../guichet/types";
import { enTranches, prix as fPrix, usdt as fUsdt } from "../../noyau/format";
import { langue, t } from "../../noyau/langue";
import { BUY, SELL } from "../../ui";

/** Douala est à UTC+1 toute l'année : le graphique compte en UTC, on décale l'axe d'une heure. */
const DECALAGE_S = 3600;
const VERT = "#0B6B3A";
const BUY_PALE = "rgba(8,122,65,0.42)", SELL_PALE = "rgba(197,34,31,0.42)";
const GRILLE = "#EEF1EE", BORD = "#E3E7E3", TEXTE = "#5B615E";

export type TypeGraphique = "bougies" | "barres" | "ligne" | "zone";

/* des fonctions, pas des constantes : leurs noms se lisent dans la langue de l'écran au moment de l'appel */
const INTERVALLES = (): { id: Intervalle; label: string; nom: string }[] => [
  { id: "1m", label: "1m", nom: "1 minute" }, { id: "5m", label: "5m", nom: "5 minutes" }, { id: "15m", label: "15m", nom: "15 minutes" },
  { id: "1h", label: "1H", nom: t("1 heure", "1 hour") }, { id: "4h", label: "4H", nom: t("4 heures", "4 hours") }, { id: "1j", label: t("1J", "1D"), nom: t("1 jour", "1 day") },
  { id: "1s", label: t("1S", "1W"), nom: t("1 semaine", "1 week") }, { id: "1M", label: "1M", nom: t("1 mois", "1 month") },
];
const IDS_INTERVALLES: Intervalle[] = ["1m", "5m", "15m", "1h", "4h", "1j", "1s", "1M"];
const JOUR = 86_400_000;
/** Les plages, comme la barre du bas de TradingView : un intervalle qui convient, et la fenêtre à montrer. */
const PLAGES = (): { id: string; label: string; nom: string; duree: number | null; intervalle: Intervalle }[] => [
  { id: "1j", label: t("1J", "1D"), nom: t("un jour", "one day"), duree: JOUR, intervalle: "5m" },
  { id: "5j", label: t("5J", "5D"), nom: t("cinq jours", "five days"), duree: 5 * JOUR, intervalle: "30m" },
  { id: "1m", label: "1M", nom: t("un mois", "one month"), duree: 30 * JOUR, intervalle: "4h" },
  { id: "3m", label: "3M", nom: t("trois mois", "three months"), duree: 91 * JOUR, intervalle: "1j" },
  { id: "1a", label: t("1A", "1Y"), nom: t("un an", "one year"), duree: 365 * JOUR, intervalle: "1j" },
  { id: "5a", label: t("5A", "5Y"), nom: t("cinq ans", "five years"), duree: 5 * 365 * JOUR, intervalle: "1s" },
  { id: "tout", label: t("Tout", "All"), nom: t("tout l'historique", "the full history"), duree: null, intervalle: "1M" },
];
const TYPES = (): { id: TypeGraphique; nom: string; icone: ReactNode }[] => [
  { id: "bougies", nom: t("Bougies", "Candles"), icone: <CandlestickChartRounded fontSize="small" /> },
  { id: "barres", nom: t("Barres", "Bars"), icone: <SsidChartRounded fontSize="small" /> },
  { id: "ligne", nom: t("Ligne", "Line"), icone: <ShowChartRounded fontSize="small" /> },
  { id: "zone", nom: t("Zone", "Area"), icone: <StackedLineChartRounded fontSize="small" /> },
];
const IDS_TYPES: TypeGraphique[] = ["bougies", "barres", "ligne", "zone"];

const temps = (iso: string) => (Math.floor(Date.parse(iso) / 1000) + DECALAGE_S) as UTCTimestamp;
/** La langue des dates de l'axe et de la légende : celle de l'écran. */
const lieu = () => (langue() === "en" ? "en-US" : "fr-FR");

/** La date d'une bougie, comme on la lit : le jour seul pour les jours et au-delà, l'heure en dessous. */
export function dateDeBougie(iso: string, intervalle: Intervalle): string {
  const d = new Date(Date.parse(iso) + DECALAGE_S * 1000);
  const jour = d.toLocaleDateString(lieu(), { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
  if (intervalle === "1M") return d.toLocaleDateString(lieu(), { timeZone: "UTC", month: "long", year: "numeric" });
  if (intervalle === "1j" || intervalle === "1s") return intervalle === "1s" ? t(`semaine du ${jour}`, `week of ${jour}`) : jour;
  return `${jour} ${d.toLocaleTimeString(lieu(), { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
}

function lireReglage<T extends string>(cle: string, permis: readonly T[], defaut: T): T {
  try { const v = localStorage.getItem(cle) as T | null; return v && permis.includes(v) ? v : defaut; } catch { return defaut; }
}
function noterReglage(cle: string, v: string) { try { localStorage.setItem(cle, v); } catch { /* navigation privée : on oublie */ } }

function donneesDeSerie(b: Bougie, type: TypeGraphique) {
  const time = temps(b.t);
  if (type === "ligne" || type === "zone") return { time, value: b.c };
  const pale = b.source === "reference";
  const couleur = b.c >= b.o ? (pale ? BUY_PALE : BUY) : (pale ? SELL_PALE : SELL);
  return type === "bougies"
    ? { time, open: b.o, high: b.h, low: b.l, close: b.c, color: couleur, borderColor: couleur, wickColor: couleur }
    : { time, open: b.o, high: b.h, low: b.l, close: b.c, color: couleur };
}

function creerSerie(chart: IChartApi, type: TypeGraphique): ISeriesApi<SeriesType> {
  const prix = { priceFormat: { type: "price" as const, precision: 2, minMove: 0.01 } };
  switch (type) {
    case "bougies": return chart.addSeries(CandlestickSeries, { ...prix, upColor: BUY, downColor: SELL, borderVisible: false, wickUpColor: BUY, wickDownColor: SELL });
    case "barres": return chart.addSeries(BarSeries, { ...prix, upColor: BUY, downColor: SELL, thinBars: false });
    case "ligne": return chart.addSeries(LineSeries, { ...prix, color: VERT, lineWidth: 2 });
    case "zone": return chart.addSeries(AreaSeries, { ...prix, lineColor: VERT, lineWidth: 2, topColor: "rgba(11,107,58,0.26)", bottomColor: "rgba(11,107,58,0.02)" });
  }
}

/**
 * Le graphique. `hauteur` : celle du tracé ; le reste (barres d'outils,
 * légende) s'ajoute autour.
 */
export function GraphiqueBourse({ hauteur, compact = false }: { hauteur: number; compact?: boolean }) {
  const guichet = useGuichet();
  const boite = useRef<HTMLDivElement | null>(null);
  const chart = useRef<IChartApi | null>(null);
  const serie = useRef<ISeriesApi<SeriesType> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const marqueurs = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const bougies = useRef<Bougie[]>([]);
  const parTemps = useRef(new Map<number, Bougie>());
  const plusAncien = useRef(false);
  const enCours = useRef(false);
  const generation = useRef(0);
  const plageVoulue = useRef<number | null | undefined>(undefined);

  const [intervalle, setIntervalle] = useState<Intervalle>(() => lireReglage("glisil.graphique.intervalle", IDS_INTERVALLES, "1h"));
  const [type, setType] = useState<TypeGraphique>(() => lireReglage("glisil.graphique.type", IDS_TYPES, "bougies"));
  const [survol, setSurvol] = useState<Bougie | null>(null);
  const [derniere, setDerniere] = useState<Bougie | null>(null);
  const [plage, setPlage] = useState<string | null>(null);
  const [pasAuBout, setPasAuBout] = useState(false);
  const [vide, setVide] = useState(false);
  const [menuType, setMenuType] = useState<HTMLElement | null>(null);

  /* ---- les données dans les séries */
  const dessiner = useCallback(() => {
    const s = serie.current, v = volume.current;
    if (!s || !v) return;
    const liste = bougies.current;
    s.setData(liste.map((b) => donneesDeSerie(b, type)) as never);
    v.setData(liste.map((b) => ({ time: temps(b.t), value: b.v, color: b.c >= b.o ? "rgba(8,122,65,0.28)" : "rgba(197,34,31,0.28)" })));
    // l'ouverture du marché : la première bougie « marche » qui suit une bougie « reference »
    const i = liste.findIndex((b, k) => b.source === "marche" && k > 0 && liste[k - 1].source === "reference");
    marqueurs.current?.setMarkers(i > 0 ? [{ time: temps(liste[i].t), position: "aboveBar", color: VERT, shape: "arrowDown", text: t("Glisil ouvre", "Glisil opens") }] : []);
    setDerniere(liste[liste.length - 1] ?? null);
    setVide(liste.length === 0);
  }, [type]);

  const indexer = (liste: Bougie[]) => { parTemps.current = new Map(liste.map((b) => [temps(b.t), b])); };

  /* ---- remonter le temps : la page d'avant, sans faire sauter la vue */
  const chargerAvant = useCallback(async (combien = 400) => {
    if (enCours.current || !plusAncien.current || !bougies.current.length) return 0;
    enCours.current = true;
    const g = generation.current;
    try {
      const page = await guichet.bougies(intervalle, bougies.current[0].t, combien);
      if (g !== generation.current) return 0;
      const premier = Date.parse(bougies.current[0].t);
      const neuves = page.bougies.filter((b) => Date.parse(b.t) < premier);
      plusAncien.current = page.plusAncien && neuves.length > 0;
      if (!neuves.length) return 0;
      const vue = chart.current?.timeScale().getVisibleLogicalRange();
      bougies.current = [...neuves, ...bougies.current];
      indexer(bougies.current);
      dessiner();
      if (vue) chart.current?.timeScale().setVisibleLogicalRange({ from: vue.from + neuves.length, to: vue.to + neuves.length });
      return neuves.length;
    } catch { return 0; } finally { enCours.current = false; }
  }, [guichet, intervalle, dessiner]);

  /* ---- montrer une plage (1J… Tout) : charger assez loin, puis cadrer */
  const cadrer = useCallback(async (duree: number | null) => {
    const ts = chart.current?.timeScale();
    if (!ts || !bougies.current.length) return;
    if (duree === null) {
      while (plusAncien.current) { if (!(await chargerAvant(1000))) break; }
      ts.fitContent();
      return;
    }
    const depuis = Date.now() - duree;
    for (let k = 0; k < 10 && plusAncien.current && Date.parse(bougies.current[0].t) > depuis; k++) { if (!(await chargerAvant(1000))) break; }
    ts.setVisibleRange({ from: (Math.floor(depuis / 1000) + DECALAGE_S) as UTCTimestamp, to: (Math.floor(Date.now() / 1000) + DECALAGE_S) as UTCTimestamp });
  }, [chargerAvant]);

  /* ---- le graphique, une fois */
  useEffect(() => {
    if (!boite.current) return;
    const c = createChart(boite.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#FFFFFF" }, textColor: TEXTE, fontFamily: "Roboto, system-ui, sans-serif", fontSize: compact ? 11 : 12, attributionLogo: true },
      grid: { vertLines: { color: GRILLE }, horzLines: { color: GRILLE } },
      rightPriceScale: { borderColor: BORD, scaleMargins: { top: 0.1, bottom: 0.24 } },
      timeScale: { borderColor: BORD, timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: compact ? 6 : 8, minBarSpacing: 0.3 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: lieu(), priceFormatter: fPrix },
    });
    chart.current = c;
    volume.current = c.addSeries(HistogramSeries, { priceScaleId: "volume", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const surCurseur = (p: MouseEventParams<Time>) => setSurvol(p.time != null ? parTemps.current.get(p.time as number) ?? null : null);
    c.subscribeCrosshairMove(surCurseur);
    return () => { c.unsubscribeCrosshairMove(surCurseur); c.remove(); chart.current = null; serie.current = null; volume.current = null; marqueurs.current = null; };
  }, [compact]);

  /* ---- la série du type choisi */
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    if (serie.current) c.removeSeries(serie.current);
    serie.current = creerSerie(c, type);
    marqueurs.current = createSeriesMarkers(serie.current, []);
    dessiner();
    noterReglage("glisil.graphique.type", type);
  }, [type, dessiner]);

  /* ---- faire glisser vers la gauche : la page d'avant ; loin du bout : le bouton « au plus récent » */
  useEffect(() => {
    const ts = chart.current?.timeScale();
    if (!ts) return;
    const surVue = (r: LogicalRange | null) => {
      if (!r) return;
      if (r.from < 40) void chargerAvant();
      setPasAuBout(r.to < bougies.current.length - 3);
    };
    ts.subscribeVisibleLogicalRangeChange(surVue);
    return () => ts.unsubscribeVisibleLogicalRangeChange(surVue);
  }, [chargerAvant]);

  /* ---- l'intervalle : la première page, puis le direct toutes les huit secondes */
  useEffect(() => {
    const g = ++generation.current;
    noterReglage("glisil.graphique.intervalle", intervalle);
    // l'étiquette du réticule sur l'axe : la même date que la légende (pas d'heure sur une bougie de mois)
    chart.current?.applyOptions({ localization: { timeFormatter: (t: Time) => dateDeBougie(new Date(((t as number) - DECALAGE_S) * 1000).toISOString(), intervalle) } });
    let arret = false;
    (async () => {
      try {
        const page = await guichet.bougies(intervalle, null, 400);
        if (g !== generation.current) return;
        bougies.current = page.bougies;
        plusAncien.current = page.plusAncien;
        indexer(page.bougies);
        dessiner();
        const voulue = plageVoulue.current;
        plageVoulue.current = undefined;
        if (voulue !== undefined) await cadrer(voulue);
        else chart.current?.timeScale().scrollToRealTime();
      } catch { if (g === generation.current) setVide(true); }
    })();
    const direct = setInterval(async () => {
      if (arret || document.hidden) return;
      try {
        const page = await guichet.bougies(intervalle, null, 3);
        if (g !== generation.current || !serie.current || !volume.current) return;
        const fin = bougies.current.length ? Date.parse(bougies.current[bougies.current.length - 1].t) : 0;
        for (const b of page.bougies) {
          const t = Date.parse(b.t);
          if (t < fin) continue;
          if (t === fin) bougies.current[bougies.current.length - 1] = b; else bougies.current.push(b);
          parTemps.current.set(temps(b.t), b);
          serie.current.update(donneesDeSerie(b, type) as never);
          volume.current.update({ time: temps(b.t), value: b.v, color: b.c >= b.o ? "rgba(8,122,65,0.28)" : "rgba(197,34,31,0.28)" });
        }
        setDerniere(bougies.current[bougies.current.length - 1] ?? null);
      } catch { /* le direct reprend au tour suivant */ }
    }, 8_000);
    return () => { arret = true; clearInterval(direct); };
    // le type change la série, pas les données : il n'est pas une raison de recharger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalle, guichet]);

  const choisirPlage = (p: ReturnType<typeof PLAGES>[number]) => {
    setPlage(p.id);
    if (p.intervalle === intervalle) void cadrer(p.duree);
    else { plageVoulue.current = p.duree; setIntervalle(p.intervalle); }
  };

  const montree = survol ?? derniere;
  const variation = montree ? ((montree.c - montree.o) / montree.o) * 100 : 0;
  const types = TYPES();
  const intervalles = INTERVALLES();
  const typeCourant = types.find((x) => x.id === type)!;

  return (
    <Stack gap={1} data-graphique-bourse>
      {/* intervalles et type de tracé */}
      <Stack direction="row" alignItems="center" gap={0.5} sx={{ overflowX: "auto", scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}>
        {intervalles.map((i) => (
          <Tooltip key={i.id} title={i.nom}>
            <ButtonBase onClick={() => { setPlage(null); setIntervalle(i.id); }} aria-pressed={i.id === intervalle} aria-label={t(`Intervalle ${i.nom}`, `Interval ${i.nom}`)}
              sx={{ px: 1, height: 30, minWidth: 34, borderRadius: 1.5, fontSize: 13, fontWeight: i.id === intervalle ? 700 : 500,
                    color: i.id === intervalle ? VERT : "text.secondary", bgcolor: i.id === intervalle ? "rgba(11,107,58,0.10)" : "transparent", flexShrink: 0 }}>
              {i.label}
            </ButtonBase>
          </Tooltip>
        ))}
        <Box sx={{ width: "1px", height: 20, bgcolor: BORD, mx: 0.5, flexShrink: 0 }} />
        <Tooltip title={t(`Type : ${typeCourant.nom}`, `Type: ${typeCourant.nom}`)}>
          <IconButton size="small" onClick={(e) => setMenuType(e.currentTarget)} aria-label={t(`Type de graphique : ${typeCourant.nom}`, `Chart type: ${typeCourant.nom}`)} sx={{ color: VERT, flexShrink: 0 }}>
            {typeCourant.icone}
          </IconButton>
        </Tooltip>
        <Menu anchorEl={menuType} open={Boolean(menuType)} onClose={() => setMenuType(null)}>
          {types.map((x) => (
            <MenuItem key={x.id} selected={x.id === type} onClick={() => { setType(x.id); setMenuType(null); }}>
              <ListItemIcon>{x.icone}</ListItemIcon><ListItemText>{x.nom}</ListItemText>
            </MenuItem>
          ))}
        </Menu>
      </Stack>

      {/* la légende : ce que le réticule montre, ou la dernière bougie */}
      <Box sx={{ minHeight: 20, display: "flex", flexWrap: "wrap", columnGap: 1.25, rowGap: 0.25, fontSize: 12, fontVariantNumeric: "tabular-nums", color: TEXTE }} data-legende>
        {montree ? (
          <>
            <Box component="span" sx={{ fontWeight: 600, color: "text.primary" }}>{dateDeBougie(montree.t, intervalle)}</Box>
            {(["o", "h", "l", "c"] as const).map((k) => (
              <Box component="span" key={k}>{({ o: "O", h: "H", l: t("B", "L"), c: "C" })[k]} <Box component="span" sx={{ color: montree.c >= montree.o ? BUY : SELL, fontWeight: 500 }}>{fPrix(montree[k])}</Box></Box>
            ))}
            <Box component="span" sx={{ color: variation >= 0 ? BUY : SELL, fontWeight: 600 }}>{variation >= 0 ? "+" : ""}{t(`${enTranches(variation, 2)} %`, `${enTranches(variation, 2)}%`)}</Box>
            {montree.source === "reference"
              ? <Box component="span" sx={{ fontStyle: "italic" }}>{t("cours de référence BCE · avant l'ouverture de Glisil", "ECB reference rate · before Glisil opened")}</Box>
              : <Box component="span">{t("Vol", "Vol")} {fUsdt(Math.round(montree.v))} USDT</Box>}
          </>
        ) : <Box component="span">{vide ? t("Pas encore d'échange sur cet intervalle.", "No trades yet on this interval.") : t("Chargement…", "Loading…")}</Box>}
      </Box>

      {/* le tracé */}
      <Box sx={{ position: "relative", height: hauteur, borderRadius: 2, overflow: "hidden" }}>
        <Box ref={boite} sx={{ position: "absolute", inset: 0 }} role="img"
          aria-label={derniere
            ? t(`Graphique USDT/XAFe, intervalle ${intervalles.find((i) => i.id === intervalle)?.nom}, dernier prix ${fPrix(derniere.c)} XAFe`,
                `USDT/XAFe chart, ${intervalles.find((i) => i.id === intervalle)?.nom} interval, last price ${fPrix(derniere.c)} XAFe`)
            : t("Graphique USDT/XAFe", "USDT/XAFe chart")} />
        {pasAuBout && (
          <Tooltip title={t("Revenir au plus récent", "Back to the latest")}>
            <IconButton size="small" onClick={() => chart.current?.timeScale().scrollToRealTime()} aria-label={t("Revenir au plus récent", "Back to the latest")}
              sx={{ position: "absolute", right: 72, bottom: 36, bgcolor: "background.paper", boxShadow: 1, "&:hover": { bgcolor: "background.paper" } }}>
              <LastPageRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* les plages */}
      <Stack direction="row" gap={0.25} sx={{ overflowX: "auto", scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}>
        {PLAGES().map((p) => (
          <Tooltip key={p.id} title={t(`Montrer ${p.nom}`, `Show ${p.nom}`)}>
            <ButtonBase onClick={() => choisirPlage(p)} aria-label={t(`Montrer ${p.nom}`, `Show ${p.nom}`)} aria-pressed={plage === p.id}
              sx={{ px: 1, height: 28, minWidth: 34, borderRadius: 1.5, fontSize: 12, fontWeight: plage === p.id ? 700 : 500, flexShrink: 0,
                    color: plage === p.id ? VERT : "text.secondary", bgcolor: plage === p.id ? "rgba(11,107,58,0.10)" : "transparent" }}>
              {p.label}
            </ButtonBase>
          </Tooltip>
        ))}
      </Stack>
    </Stack>
  );
}

/* ================================================================ profondeur */

type Point = { prix: number; cumul: number };

/** Les niveaux du carnet en marches cumulées : depuis le meilleur prix, vers l'extérieur. */
export function cumuler(niveaux: Niveau[], cote: "achats" | "ventes"): Point[] {
  const tries = [...niveaux].sort((a, b) => (cote === "achats" ? b.prix - a.prix : a.prix - b.prix));
  let cumul = 0;
  return tries.map((n) => ({ prix: n.prix, cumul: (cumul += n.quantite) }));
}

/**
 * La PROFONDEUR, comme l'onglet « Depth » de Binance : à gauche, tout ce qu'on
 * peut vendre (les achats posés, cumulés depuis le meilleur), à droite tout ce
 * qu'on peut acheter. Un mur se voit comme une marche haute.
 */
export function Profondeur({ achats, ventes, hauteur }: { achats: Niveau[]; ventes: Niveau[]; hauteur: number }) {
  const [vise, setVise] = useState<{ x: number; cote: "achat" | "vente"; p: Point } | null>(null);
  // le dessin se fait à la largeur réelle : un viewBox fixe rapetissait le texte à 8 px sur un téléphone
  const cadre = useRef<HTMLDivElement | null>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    if (!cadre.current) return;
    const o = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    o.observe(cadre.current);
    return () => o.disconnect();
  }, []);
  const H = hauteur, bas = 22, droite = 56;
  const a = useMemo(() => cumuler(achats, "achats"), [achats]);
  const v = useMemo(() => cumuler(ventes, "ventes"), [ventes]);
  if (!a.length && !v.length) return <Box ref={cadre}><Typography variant="body2" sx={{ py: 4, textAlign: "center" }}>{t("Le carnet est vide.", "The order book is empty.")}</Typography></Box>;
  const prixMin = a.length ? a[a.length - 1].prix : v[0].prix * 0.99;
  const prixMax = v.length ? v[v.length - 1].prix : a[0].prix * 1.01;
  const qMax = Math.max(a[a.length - 1]?.cumul ?? 0, v[v.length - 1]?.cumul ?? 0) * 1.08 || 1;
  const x = (p: number) => ((p - prixMin) / (prixMax - prixMin || 1)) * (W - droite);
  const y = (q: number) => (H - bas) - (q / qMax) * (H - bas - 8);
  const marches = (pts: Point[], versLaGauche: boolean) => {
    if (!pts.length) return "";
    let d = `M ${x(pts[0].prix)} ${y(0)}`;
    let q = 0;
    for (const p of pts) { d += ` L ${x(p.prix)} ${y(q)} L ${x(p.prix)} ${y(p.cumul)}`; q = p.cumul; }
    d += ` L ${versLaGauche ? 0 : W - droite} ${y(q)}`;
    return d;
  };
  const zone = (pts: Point[], versLaGauche: boolean) => pts.length ? `${marches(pts, versLaGauche)} L ${versLaGauche ? 0 : W - droite} ${y(0)} Z` : "";
  const milieu = a.length && v.length ? (a[0].prix + v[0].prix) / 2 : null;
  const graduations = [0.25, 0.5, 0.75, 1].map((f) => qMax / 1.08 * f);
  const prixGrad = [0, 0.25, 0.5, 0.75, 1].map((f) => prixMin + (prixMax - prixMin) * f);

  const surMouvement = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const p = prixMin + (px / (W - droite)) * (prixMax - prixMin);
    if (milieu !== null && p <= milieu) {
      const pt = a.find((k) => k.prix <= p) ?? a[a.length - 1];
      setVise(pt ? { x: px, cote: "achat", p: pt } : null);
    } else {
      const pt = [...v].reverse().find((k) => k.prix <= p) ?? v[0];
      setVise(pt ? { x: px, cote: "vente", p: pt } : null);
    }
  };

  return (
    <Box ref={cadre} sx={{ position: "relative" }} data-profondeur>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" onPointerMove={surMouvement} onPointerLeave={() => setVise(null)} style={{ touchAction: "pan-y", display: "block" }}
        aria-label={t(`Profondeur du carnet : ${fUsdt(Math.round(a[a.length - 1]?.cumul ?? 0))} USDT à l'achat, ${fUsdt(Math.round(v[v.length - 1]?.cumul ?? 0))} USDT à la vente`,
                      `Order book depth: ${fUsdt(Math.round(a[a.length - 1]?.cumul ?? 0))} USDT on the buy side, ${fUsdt(Math.round(v[v.length - 1]?.cumul ?? 0))} USDT on the sell side`)}>
        {graduations.map((q) => (
          <g key={q}>
            <line x1={0} x2={W - droite} y1={y(q)} y2={y(q)} stroke={GRILLE} />
            <text x={W - droite + 6} y={y(q) + 4} fontSize={11} fill={TEXTE}>{q >= 1000 ? `${enTranches(q / 1000, 1)} k` : enTranches(q, 0)}</text>
          </g>
        ))}
        {prixGrad.map((p, i) => (
          <text key={i} x={Math.min(Math.max(x(p), 18), W - droite - 18)} y={H - 6} fontSize={11} fill={TEXTE} textAnchor="middle">{fPrix(p)}</text>
        ))}
        <path d={zone(a, true)} fill="rgba(8,122,65,0.14)" />
        <path d={marches(a, true)} fill="none" stroke={BUY} strokeWidth={1.6} />
        <path d={zone(v, false)} fill="rgba(197,34,31,0.12)" />
        <path d={marches(v, false)} fill="none" stroke={SELL} strokeWidth={1.6} />
        {milieu !== null && <line x1={x(milieu)} x2={x(milieu)} y1={8} y2={H - bas} stroke={TEXTE} strokeDasharray="3 3" opacity={0.6} />}
        {vise && <line x1={vise.x} x2={vise.x} y1={8} y2={H - bas} stroke={vise.cote === "achat" ? BUY : SELL} strokeDasharray="2 2" />}
      </svg>
      {milieu !== null && (
        <Typography sx={{ position: "absolute", top: 6, left: `${(x(milieu) / W) * 100}%`, transform: "translateX(-50%)", fontSize: 12, fontWeight: 600, bgcolor: "background.paper", px: 0.5, borderRadius: 1 }}>
          {fPrix(milieu)}
        </Typography>
      )}
      {vise && (
        <Box sx={{ position: "absolute", top: 30, left: `${Math.min(Math.max((vise.x / W) * 100, 12), 70)}%`, bgcolor: "background.paper", boxShadow: 2, borderRadius: 2, px: 1.25, py: 0.75, pointerEvents: "none", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
          <Box sx={{ color: vise.cote === "achat" ? BUY : SELL, fontWeight: 600 }}>{vise.cote === "achat" ? t("Achats jusqu'à", "Bids down to") : t("Ventes jusqu'à", "Asks up to")} {fPrix(vise.p.prix)}</Box>
          <Box>{t("Cumul", "Total")} {fUsdt(Math.round(vise.p.cumul * 100) / 100)} USDT</Box>
        </Box>
      )}
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5, fontSize: 12, color: TEXTE }}>
        <span><Box component="span" sx={{ color: BUY, fontWeight: 600 }}>{t("Achats", "Bids")}</Box> · {fUsdt(Math.round(a[a.length - 1]?.cumul ?? 0))} USDT</span>
        <span><Box component="span" sx={{ color: SELL, fontWeight: 600 }}>{t("Ventes", "Asks")}</Box> · {fUsdt(Math.round(v[v.length - 1]?.cumul ?? 0))} USDT</span>
      </Stack>
    </Box>
  );
}
