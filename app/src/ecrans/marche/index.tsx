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
import { useCarnet, useCotation, useGuichet, useMesOrdres, useOrdre, useRafraichir, useSoldes, useTransactions } from "../../guichet";
import type { Cote, Execution, Niveau, Ordre, TypeOrdre } from "../../guichet/types";
import { achatMax, arrondi2, bandeDePrix, FRAIS, fraisOrdre, MARCHE, raisonDuRefus, simulerMarche, totalOrdre } from "../../noyau/argent";
import { enTranches, heure, heureSecondes, jourRelatif, pourcent, prix as fPrix, usdt as fUsdt, xaf } from "../../noyau/format";
import { langue, t } from "../../noyau/langue";
import { useParcours } from "../../navigation/parcours";
import { Attente, Badge, BUY, BUY_BG, Card, Feuille, FeuilleErreur, Line, Screen, SELL, SELL_BG, Squelette, Success } from "../../ui";
import { useGesteUnique } from "../../ui/gestes";
import { GraphiqueBourse, Profondeur } from "./graphique";

const couleur = (c: Cote) => (c === "achat" ? BUY : SELL);
const fond = (c: Cote) => (c === "achat" ? BUY_BG : SELL_BG);
/* les libellés se calculent à l'affichage, dans la langue de l'écran ; les valeurs comparées restent celles du moteur */
const nomDuCote = (c: Cote) => (c === "achat" ? t("Achat", "Buy") : t("Vente", "Sell"));
const nomDuType = (type: TypeOrdre) => (type === "limite" ? t("Limite", "Limit") : t("Marché", "Market"));
const nomDEtat = (e: Ordre["etat"]) => ({ execute: t("Exécuté", "Filled"), annule: t("Annulé", "Canceled"), ouvert: t("Ouvert", "Open"), partiel: t("Partiel", "Partially filled") })[e];

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
          {v >= 0 ? "+" : ""}{t(`${enTranches(v, 2)} %`, `${enTranches(v, 2)}%`)}
        </Typography>
      )}
      <Box sx={{ flex: 1 }} />
      {chart && (
        <IconButton aria-label={t("Graphique", "Chart")} component={Link} to="/marche/graphique">
          <CandlestickChartOutlined />
        </IconButton>
      )}
      {chart && (
        <IconButton aria-label={t("Plus", "More")} onClick={(e) => setMenu(e.currentTarget)}>
          <MoreHorizRounded />
        </IconButton>
      )}
      <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
        <MenuItem component={Link} to="/rapide" onClick={() => setMenu(null)}>{t("Achat rapide", "Quick buy")}</MenuItem>
        <MenuItem component={Link} to="/marche/carnet" onClick={() => setMenu(null)}>{t("Tout le carnet", "Full order book")}</MenuItem>
        <MenuItem component={Link} to="/marche/ordres" onClick={() => setMenu(null)}>{t("Mes ordres", "My orders")}</MenuItem>
      </Menu>
      <Feuille ouverte={paire} onFermer={() => setPaire(false)} titre={t("Paires", "Pairs")}>
        <Stack gap={1}>
          <Paper sx={{ p: 1.5, borderRadius: 3, bgcolor: "#CDEFD9", display: "flex", justifyContent: "space-between" }}>
            <Typography fontWeight={600}>USDT/XAFe</Typography>{/* langue-ok */}
            <Typography sx={{ fontVariantNumeric: "tabular-nums" }}>{c?.dernier != null ? fPrix(c.dernier) : "—"}</Typography>
          </Paper>
          <Typography variant="body2">{t("Une seule paire aujourd'hui. D'autres suivront quand le carnet sera assez profond.", "Just one pair for now. More will follow once the order book is deep enough.")}</Typography>
          <Button variant="contained" onClick={() => setPaire(false)}>{t("Fermer", "Close")}</Button>
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
        <Typography variant="caption" sx={{ lineHeight: 1.2 }}>{t("Prix", "Price")}<br />XAFe</Typography>
        <Typography variant="caption" sx={{ lineHeight: 1.2, textAlign: "right" }}>{t("Qté", "Qty")}<br />USDT</Typography>
      </Stack>
      {!carnet ? <Squelette hauteur={360} radius={8} /> : (
        <>
          {[...carnet.ventes].reverse().map((n) => <BookRow key={`v${n.prix}`} n={n} max={max} side="vente" onPick={onPick} />)}
          <MidPrice />
          {carnet.achats.map((n) => <BookRow key={`a${n.prix}`} n={n} max={max} side="achat" onPick={onPick} />)}
        </>
      )}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
        <ButtonBase onClick={(e) => setMenuPas(e.currentTarget)} aria-label={t("Pas du carnet", "Order book step")} sx={{ borderRadius: 2, px: 1, py: 0.25, bgcolor: "background.default", gap: 0.25 }}>
          <Typography variant="body2" sx={{ color: "text.primary", fontSize: 13 }}>{fPrix(pas)}</Typography>
          <ArrowDropDownRounded fontSize="small" />
        </ButtonBase>
        <Menu anchorEl={menuPas} open={Boolean(menuPas)} onClose={() => setMenuPas(null)}>
          {[MARCHE.pasPrix, 0.5, 1, 5].filter((x, i, t) => t.indexOf(x) === i).map((x) => (
            <MenuItem key={x} selected={x === pas} onClick={() => { setPas(x); setMenuPas(null); }}>{fPrix(x)}</MenuItem>
          ))}
        </Menu>
        <IconButton size="small" aria-label={t("Tout le carnet", "Full order book")} component={Link} to="/marche/carnet"><FormatListBulletedRounded fontSize="small" /></IconButton>
      </Stack>
    </Stack>
  );
}

/* ------------------------------------------------------ formulaire d'ordre */

function Field({ label, value, unit, onChange, onStep, placeholder }: { label: string; value: string; unit?: string; onChange?: (v: string) => void; onStep?: (d: 1 | -1) => void; placeholder?: string }) {
  return (
    <Paper sx={{ bgcolor: "background.default", borderRadius: 2, height: 48, display: "flex", alignItems: "center", px: 0.5 }}>
      {onStep ? <IconButton size="small" aria-label={t("Moins", "Less")} onClick={() => onStep(-1)}><RemoveRounded fontSize="small" /></IconButton> : <Box sx={{ width: 8 }} />}
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
      {onStep ? <IconButton size="small" aria-label={t("Plus", "More")} onClick={() => onStep(1)}><AddRounded fontSize="small" /></IconButton> : <Box sx={{ width: 8 }} />}
    </Paper>
  );
}

function SideToggle({ side, onChange }: { side: Cote; onChange: (c: Cote) => void }) {
  return (
    <Stack direction="row" sx={{ height: 36, borderRadius: 2, overflow: "hidden", bgcolor: "background.default" }}>
      <ButtonBase onClick={() => onChange("achat")} sx={{ flex: 1, fontWeight: 700, fontSize: 14, bgcolor: side === "achat" ? BUY : "transparent", color: side === "achat" ? "#fff" : "text.secondary", clipPath: "polygon(0 0, 100% 0, 88% 100%, 0 100%)", mr: -1 }}>{t("Acheter", "Buy")}</ButtonBase>
      <ButtonBase onClick={() => onChange("vente")} sx={{ flex: 1, fontWeight: 700, fontSize: 14, bgcolor: side === "vente" ? SELL : "transparent", color: side === "vente" ? "#fff" : "text.secondary", clipPath: "polygon(12% 0, 100% 0, 100% 100%, 0 100%)", ml: -1 }}>{t("Vendre", "Sell")}</ButtonBase>
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

/* en anglais, la virgule sépare les milliers (« 50,000 », « 1,234.50 ») : elle s'efface ; seule, devant
   une ou deux décimales (« 618,4 »), elle reste une virgule décimale, comme en français */
const lireNombre = (s: string): number => {
  const brut = s.replace(/\s/g, "");
  const anglais = langue() === "en" && (brut.includes(".") || /^\d{1,3}(,\d{3})+$/.test(brut));
  const n = Number(anglais ? brut.replace(/,/g, "") : brut.replace(",", "."));
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
        ? t("Ordre arrêté : il aurait croisé l'un de vos propres ordres.", "Order stopped: it would have matched one of your own orders.")
        : t("Ordre au marché annulé : il n'y avait personne en face. Placez un ordre limite pour attendre au carnet.", "Market order canceled: there was no one on the other side. Place a limit order to wait in the order book.")
      : o.executee > 0
        ? o.type === "marche"
          ? t("Ordre au marché exécuté en partie : le carnet n'avait pas assez en face, le reste est annulé.", "Market order partially filled: the order book didn't have enough on the other side, so the rest was canceled.")
          : t("Ordre partiellement exécuté, le reste attend au carnet.", "Order partially filled. The rest is waiting in the order book.")
        : t("Ordre placé au carnet.", "Order placed in the order book.");
  /* une réponse perdue puis rejouée : le moteur rend l'ordre déjà parti, on le dit */
  return o.deja ? t(`Cet ordre était déjà parti. ${m}`, `This order had already been sent. ${m}`) : m;
}

function OrderForm({ onPlace }: { onPlace: (o: Ordre & { rempli: boolean; autoNegociation: boolean; deja: boolean }) => void }) {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const [f, poser] = useParcours("marche");
  const { data: soldes } = useSoldes();
  const { data: cotation } = useCotation();
  const { data: carnet } = useCarnet(30);
  const { data: mesOrdres } = useMesOrdres();
  const [typeOuvert, setTypeOuvert] = useState(false);
  const [confirme, setConfirme] = useState(false);
  /* le total tapé par la personne, tant qu'elle ne touche pas à autre chose : c'est lui qui décide de la quantité */
  const [totalSaisi, setTotalSaisi] = useState<string | null>(null);
  /* l'intention de l'ordre : un prix ou une quantité changés font un autre ordre, avec sa propre clé */
  const { lancer, enCours, erreur, effacerErreur } = useGesteUnique("ord", { cote: f.cote, type: f.type, quantite: f.quantite, prix: f.type === "limite" ? f.prix : null });

  /* Le meilleur prix en face, sinon le dernier échange, sinon la référence du moteur. Un VRAI prix, jamais un exemple
     gris qui ressemble à un prix : c'est ce faux « 618,40 » qui faisait croire à un prix posé alors que la case était vide. */
  const enFace = f.cote === "achat" ? cotation?.meilleureVente : cotation?.meilleurAchat;
  const prixSuggere = enFace ?? cotation?.dernier ?? cotation?.reference ?? MARCHE.reference ?? null;
  useEffect(() => {
    if (f.prix === "" && prixSuggere != null) poser({ prix: fPrix(prixSuggere) });
  }, [prixSuggere, f.prix, poser]);

  const prix = lireNombre(f.prix);
  const quantite = lireNombre(f.quantite);
  const dispoXafe = soldes?.XAFe.disponible ?? 0;
  const dispoUsdt = soldes?.USDT.disponible ?? 0;
  const reference = cotation?.reference ?? MARCHE.reference;
  /* le prix qui sert aux calculs : celui tapé (limite), sinon le meilleur en face (marché) */
  const prixCalcul = f.type === "limite" ? prix : enFace ?? 0;
  /* Achat max : ce que les XAFe disponibles paient À CE PRIX. Sans prix, on ne sait pas — et on ne l'invente pas
     (l'écran divisait par 1 et annonçait « 1 000 USDT » pour 1 000 XAFe). */
  const maxQ = f.cote === "achat" ? (prixCalcul > 0 ? achatMax(dispoXafe, prixCalcul) : null) : arrondi2(dispoUsdt);
  const total = f.type === "limite" ? totalOrdre(quantite, prix) : simulerMarche(f.cote, quantite, (f.cote === "achat" ? carnet?.ventes : carnet?.achats) ?? [], f.cote === "achat" ? dispoXafe : Infinity).total;
  const frais = fraisOrdre(f.cote, quantite, prixCalcul || 0);
  const pct = maxQ && maxQ > 0 ? Math.min(100, Math.round((quantite / maxQ) * 100)) : 0;
  const ouverts = (mesOrdres ?? []).filter((o) => o.etat === "ouvert" || o.etat === "partiel").length;
  const raison = raisonDuRefus({ cote: f.cote, type: f.type, prix, quantite, dispoXafe, dispoUsdt, reference, ouverts });
  const marcheVide = f.type === "marche" && enFace == null;
  const valide = quantite > 0 && raison === null && !marcheVide && (maxQ === null || quantite <= maxQ + 1e-9);
  const bande = f.type === "limite" ? bandeDePrix(f.cote, reference) : null;

  const changerQuantite = (q: string) => { setTotalSaisi(null); poser({ quantite: q }); };
  const changerPrix = (p: string) => { setTotalSaisi(null); poser({ prix: p }); };
  /* le total d'abord : « je mets 50 000 XAFe » — la quantité s'en déduit, au centime inférieur, comme le moteur */
  const changerTotal = (t: string) => {
    setTotalSaisi(t);
    const x = lireNombre(t);
    poser({ quantite: prix > 0 && x > 0 ? String(Math.trunc((x / prix) * 100) / 100) : "" });
  };
  const step = (champ: "prix" | "quantite", d: 1 | -1) => {
    if (champ === "prix") changerPrix(fPrix(Math.max(MARCHE.pasPrix, arrondi2((prix || prixSuggere || 0) + d * MARCHE.pasPrix))));
    else changerQuantite(String(Math.max(0, arrondi2(quantite + d * 10))));
  };

  const placer = () =>
    lancer(async (cle) => {
      const r = await guichet.placerOrdre({ cote: f.cote, type: f.type, quantite, prix: f.type === "limite" ? prix : undefined, cle });
      setConfirme(false);
      setTotalSaisi(null);
      poser({ quantite: "" });
      await rafraichir();
      onPlace({ ...r.ordre, rempli: r.ordre.executee > 0 && r.ordre.restant === 0, autoNegociation: r.autoNegociation, deja: Boolean(r.deja) });
    });

  return (
    /* 212 px de formulaire laissaient 40 px au carnet sur un écran de 320 : en dessous de 360, il prend 56 % */
    <Stack gap={1} sx={{ width: 212, flexShrink: 0, "@media (max-width:359px)": { width: "56%" } }}>
      <SideToggle side={f.cote} onChange={(c) => { setTotalSaisi(null); poser({ cote: c, prix: "" }); }} />
      <ButtonBase onClick={() => setTypeOuvert(true)} sx={{ borderRadius: 2 }}>
        <Paper sx={{ bgcolor: "background.default", borderRadius: 2, height: 40, display: "flex", alignItems: "center", px: 1.25, gap: 0.5, width: "100%" }}>
          <InfoOutlined sx={{ fontSize: 16, color: "text.secondary" }} />
          <Typography sx={{ flex: 1, fontSize: 14, fontWeight: 500, textAlign: "center" }}>{f.type === "limite" ? t("Limite", "Limit") : t("Marché", "Market")}</Typography>
          <ArrowDropDownRounded fontSize="small" />
        </Paper>
      </ButtonBase>
      {f.type === "limite" ? (
        <Stack direction="row" gap={0.75}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Field label={t("Prix (XAFe)", "Price (XAFe)")} value={f.prix} onChange={changerPrix} onStep={(d) => step("prix", d)} placeholder={t("Votre prix", "Your price")} />
          </Box>
          {/* « BBO » : le meilleur prix en face, d'un geste */}
          <ButtonBase aria-label={t("Meilleur prix en face", "Best price on the other side")} disabled={prixSuggere == null} onClick={() => prixSuggere != null && changerPrix(fPrix(prixSuggere))}
            sx={{ width: 44, borderRadius: 2, bgcolor: "background.default", fontSize: 11, fontWeight: 700, color: prixSuggere == null ? "text.disabled" : "text.primary" }}>
            BBO{/* langue-ok */}
          </ButtonBase>
        </Stack>
      ) : (
        <Field label={t("Prix (XAFe)", "Price (XAFe)")} value={t("Prix du marché", "Market price")} />
      )}
      {f.type === "limite" && bande && (
        <Typography data-bande sx={{ fontSize: 11, color: "text.secondary", px: 0.5, lineHeight: 1.3 }}>
          {t(`Entre ${fPrix(bande.min)} et ${fPrix(bande.max)} · référence ${fPrix(reference!)}`, `Between ${fPrix(bande.min)} and ${fPrix(bande.max)} · reference ${fPrix(reference!)}`)}
        </Typography>
      )}
      <Field label={t("Quantité (USDT)", "Quantity (USDT)")} value={f.quantite} onChange={changerQuantite} onStep={(d) => step("quantite", d)} placeholder="0" />
      <Box sx={{ px: 1 }}>
        {/* la part de ce qu'on a : 25 %, 50 %, 75 %, tout — des USDT achetables à ce prix, ou des USDT qu'on vend */}
        <Slider aria-label={t("Part du disponible", "Share of available balance")} getAriaValueText={(v) => t(`${v} %`, `${v}%`)} value={pct} disabled={maxQ === null}
          onChange={(_, v) => changerQuantite(maxQ ? String(Math.trunc(((maxQ * (v as number)) / 100) * 100) / 100) : "")} step={null} marks={[0, 25, 50, 75, 100].map((v) => ({ value: v }))} size="small"
          sx={{ color: "text.secondary", "& .MuiSlider-mark": { width: 8, height: 8, borderRadius: 4, bgcolor: "background.paper", border: 2, borderColor: "text.secondary" }, "& .MuiSlider-thumb": { width: 28, height: 28, bgcolor: "background.paper", border: 2, borderColor: "text.primary" } }} />
      </Box>
      {f.type === "limite" ? (
        <Field label={t("Total (XAFe)", "Total (XAFe)")} value={totalSaisi ?? (total > 0 ? xaf(total) : "")} onChange={changerTotal} placeholder={t("Ou un montant en XAFe", "Or an amount in XAFe")} />
      ) : (
        <Field label={t("Total estimé (XAFe)", "Estimated total (XAFe)")} value={total > 0 ? xaf(total) : "—"} />
      )}
      <Stack gap={0.25} sx={{ px: 0.25 }}>
        {/* acheter dépense des XAFe, vendre des USDT : le disponible n'est que l'un des deux — l'autre se dit aussi,
            sinon « Dispo 1 000 000 XAFe » se lit comme « on ne vous laisse qu'un million » (retour d'un testeur) */}
        <Small label={f.cote === "achat" ? t("Dispo pour acheter", "Available to buy") : t("Dispo pour vendre", "Available to sell")} value={f.cote === "achat" ? `${xaf(dispoXafe)} XAFe` : `${enTranches(dispoUsdt, 2)} USDT`} />
        <Small label={f.cote === "achat" ? t("Vos USDT (à vendre)", "Your USDT (to sell)") : t("Vos XAFe (pour acheter)", "Your XAFe (to buy)")} value={f.cote === "achat" ? `${enTranches(dispoUsdt, 2)} USDT` : `${xaf(dispoXafe)} XAFe`} />
        <Small label={f.cote === "achat" ? t("Achat max", "Max buy") : t("Vente max", "Max sell")} value={maxQ === null ? t("fixez un prix", "set a price") : `${fUsdt(maxQ)} USDT`} />
        <Small label={t("Frais est.", "Est. fees")} value={quantite > 0 ? `${frais.actif === "USDT" ? enTranches(frais.montant, 2) : xaf(frais.montant)} ${frais.actif}` : "—"} />
      </Stack>
      {/* pourquoi le bouton ne part pas : la règle et sa borne, AVANT l'envoi — jamais un bouton gris muet */}
      {(raison || marcheVide) && (
        <Typography data-raison role="status" sx={{ fontSize: 12, lineHeight: 1.35, color: "#7A4A00", bgcolor: "#FFF3DC", borderRadius: 1.5, px: 1, py: 0.75 }}>
          {marcheVide ? t("Personne en face au carnet : un ordre au marché ne trouverait rien. Posez un ordre limite, il attendra.", "No one on the other side of the order book: a market order would find nothing. Place a limit order and it will wait.") : raison}
        </Typography>
      )}
      <Button variant="contained" disabled={!valide || enCours} onClick={() => setConfirme(true)} sx={{ bgcolor: couleur(f.cote), minHeight: 44, borderRadius: 2, "&:hover": { bgcolor: couleur(f.cote) } }}>
        {f.cote === "achat" ? t("Acheter USDT", "Buy USDT") : t("Vendre USDT", "Sell USDT")}
      </Button>
      <Typography component={Link} to="/marche/regles" sx={{ fontSize: 12, color: "text.secondary", textAlign: "center", minHeight: 32, display: "flex", alignItems: "center", justifyContent: "center", textUnderlineOffset: 3 }}>
        {t("Règles du marché", "Market rules")}
      </Typography>

      <Feuille ouverte={typeOuvert} onFermer={() => setTypeOuvert(false)} titre={t("Type d'ordre", "Order type")}>
        <Stack gap={1}>
          {([
            ["limite", t("Limite", "Limit"), t(`Vous fixez le prix. L'ordre attend au carnet jusqu'à trouver preneur, vos fonds bloqués. Frais ${pourcent(FRAIS.placeur)} s'il attend, ${pourcent(FRAIS.preneur)} s'il prend.`,
              `You set the price. The order waits in the order book until it is matched, with your funds locked. Fee: ${pourcent(FRAIS.placeur)} if it waits, ${pourcent(FRAIS.preneur)} if it takes.`)],
            ["marche", t("Marché", "Market"), t(`Exécuté tout de suite au meilleur prix disponible, jamais à plus de ${pourcent(MARCHE.bandeExecution)} du prix de référence ; ce qui ne trouve pas preneur est annulé. Frais ${pourcent(FRAIS.preneur)}.`,
              `Filled right away at the best available price, never more than ${pourcent(MARCHE.bandeExecution)} away from the reference price. Anything left unmatched is canceled. Fee: ${pourcent(FRAIS.preneur)}.`)],
          ] as [TypeOrdre, string, string][]).map(([type, nom, aide]) => (
            <ButtonBase key={type} onClick={() => { poser({ type }); setTotalSaisi(null); setTypeOuvert(false); }} sx={{ textAlign: "left", borderRadius: 3 }}>
              <Paper sx={{ p: 1.5, borderRadius: 3, width: "100%", bgcolor: f.type === type ? "#CDEFD9" : "background.default" }}>
                <Typography fontWeight={600}>{nom}</Typography>
                <Typography variant="body2">{aide}</Typography>
              </Paper>
            </ButtonBase>
          ))}
        </Stack>
      </Feuille>

      <Feuille ouverte={confirme} onFermer={() => setConfirme(false)} titre={f.cote === "achat" ? t(`Acheter ${fUsdt(quantite)} USDT`, `Buy ${fUsdt(quantite)} USDT`) : t(`Vendre ${fUsdt(quantite)} USDT`, `Sell ${fUsdt(quantite)} USDT`)}>
        <Stack gap={1.5}>
          <Card sx={{ p: 2, gap: 1 }}>
            <Line label={t("Type", "Type")} value={f.type === "limite" ? t("Limite", "Limit") : t("Marché", "Market")} />
            <Line label={t("Prix", "Price")} value={f.type === "limite" ? `${fPrix(prix)} XAFe` : t("au marché", "market")} />
            <Line label={t("Quantité", "Quantity")} value={`${fUsdt(quantite)} USDT`} />
            <Divider />
            <Line label={f.type === "limite" ? t("Total", "Total") : t("Total estimé", "Estimated total")} value={`${xaf(total)} XAFe`} strong />
            <Line label={t("Frais estimés", "Estimated fees")} value={`${frais.actif === "USDT" ? enTranches(frais.montant, 2) : xaf(frais.montant)} ${frais.actif}`} />
          </Card>
          <Typography variant="body2">
            {f.type === "limite"
              ? f.cote === "achat"
                ? t(`${xaf(total)} XAFe sont bloqués tant que l'ordre attend ; la différence revient si l'exécution se fait moins cher.`, `${xaf(total)} XAFe stay locked while the order waits. If it fills at a lower price, the difference comes back to you.`)
                : t(`${fUsdt(quantite)} USDT sont bloqués tant que l'ordre attend.`, `${fUsdt(quantite)} USDT stay locked while the order waits.`)
              : t("Un ordre au marché prend ce qu'il trouve au carnet et s'arrête à vos fonds ; ce qui n'est pas exécuté est annulé.", "A market order takes what it finds in the order book, up to your funds. Anything not filled is canceled.")}
          </Typography>
          <Button variant="contained" disabled={enCours} onClick={() => void placer()} sx={{ bgcolor: couleur(f.cote), "&:hover": { bgcolor: couleur(f.cote) } }}>
            {enCours ? t("Envoi…", "Sending…") : t("Confirmer", "Confirm")}
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
        <Chip label={nomDuCote(o.cote)} size="small" sx={{ height: 22, fontSize: 12, bgcolor: fond(o.cote), color: couleur(o.cote), fontWeight: 600 }} />
        <Typography component={Link} to={`/marche/ordres/${o.id}`} sx={{ fontWeight: 600, fontSize: 14, color: "inherit", textDecoration: "none", display: "inline-block", py: "6px" }}>USDT/XAFe</Typography>{/* langue-ok */}
        <Typography variant="caption" sx={{ "@media (max-width:359px)": { display: "none" } }}>{nomDuType(o.type)}</Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption">{heure(o.creeLe)}</Typography>
        {ouvert && onCancel ? (
          <Button size="small" variant="text" onClick={() => onCancel(o.id)} sx={{ minHeight: 28, px: 1, fontSize: 13 }}>{t("Annuler", "Cancel")}</Button>
        ) : (
          <Chip label={nomDEtat(o.etat)} size="small" sx={{ height: 22, fontSize: 12 }} />
        )}
      </Stack>
      <Stack direction="row" justifyContent="space-between">
        <Cell label={ouvert ? t("Prix", "Price") : t("Prix moyen", "Avg. price")} value={ouvert ? (o.prix != null ? fPrix(o.prix) : t("marché", "market")) : o.prixMoyen != null ? fPrix(o.prixMoyen) : "—"} />
        <Cell label={t("Quantité", "Quantity")} value={fUsdt(o.quantite)} />
        <Cell label={t("Exécuté", "Filled")} value={t(`${o.quantite > 0 ? Math.round((o.executee / o.quantite) * 100) : 0} %`, `${o.quantite > 0 ? Math.round((o.executee / o.quantite) * 100) : 0}%`)} />
        <Cell label={t("Total", "Total")} value={ouvert && o.prix != null ? xaf(o.prix * o.quantite) : xaf(o.totalXafe)} align="right" />
      </Stack>
    </Stack>
  );
}

/* un ordre exécuté, comme la maquette : prix moyen, quantité, total */
function OrdreFait({ o }: { o: Ordre }) {
  return (
    <Stack component={Link} to={`/marche/ordres/${o.id}`} gap={0.75} sx={{ py: 1.5, borderTop: 1, borderColor: "divider", color: "inherit", textDecoration: "none" }}>
      <Stack direction="row" alignItems="center" gap={1}>
        <Chip label={nomDuCote(o.cote)} size="small" sx={{ height: 22, fontSize: 12, bgcolor: fond(o.cote), color: couleur(o.cote), fontWeight: 600 }} />
        <Typography sx={{ fontWeight: 600, fontSize: 14 }}>USDT/XAFe</Typography>{/* langue-ok */}
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption">{heure(o.majLe ?? o.creeLe)}</Typography>
        <Chip label={nomDEtat(o.etat === "execute" ? "execute" : "partiel")} size="small" sx={{ height: 22, fontSize: 12 }} />
      </Stack>
      <Stack direction="row" justifyContent="space-between">
        <Cell label={t("Prix moyen", "Avg. price")} value={o.prixMoyen != null ? fPrix(o.prixMoyen) : "—"} />
        <Cell label={t("Quantité", "Quantity")} value={fUsdt(o.executee)} />
        <Cell label={t("Total (XAFe)", "Total (XAFe)")} value={xaf(o.rapide?.total ?? o.totalXafe)} align="right" />
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
            <Typography variant="caption">{soldes[a].bloque > 0
              ? t(`${a === "XAFe" ? xaf(soldes[a].bloque) : fUsdt(soldes[a].bloque)} bloqués au carnet`, `${a === "XAFe" ? xaf(soldes[a].bloque) : fUsdt(soldes[a].bloque)} locked in orders`)
              : t("disponible", "available")}</Typography>
          </Stack>
        </Stack>
      ))}
    </Stack>
  );
}

/* --------------------------------------------------------- les règles */

function Regle({ titre, valeur, aide }: { titre: string; valeur: string; aide: string }) {
  return (
    <Stack gap={0.25} sx={{ py: 1.25, borderTop: 1, borderColor: "divider", "&:first-of-type": { borderTop: 0 } }}>
      <Stack direction="row" justifyContent="space-between" gap={2}>
        <Typography variant="body2" fontWeight={600}>{titre}</Typography>
        <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{valeur}</Typography>
      </Stack>
      <Typography variant="caption">{aide}</Typography>
    </Stack>
  );
}

/**
 * Les règles du marché, comme la fiche « Trading Parameters » d'une bourse :
 * ce que le moteur fait respecter, écrit pour qu'on le lise AVANT d'envoyer.
 * Les chiffres viennent des paramètres de l'équipe (parametres_publics).
 */
export function MarcheRegles() {
  const { data: cotation } = useCotation();
  const ref = cotation?.reference ?? MARCHE.reference;
  const achat = bandeDePrix("achat", ref);
  const vente = bandeDePrix("vente", ref);
  const pc = (x: number) => t(`${Math.round(x * 100)} %`, `${Math.round(x * 100)}%`);
  return (
    <Screen title={t("Règles du marché", "Market rules")} back="/marche">
      <Card sx={{ gap: 0.5 }}>
        <Typography variant="subtitle1" component="h2">{t("Comment un échange se fait", "How a trade happens")}</Typography>
        <Box component="ol" sx={{ m: 0, pl: 2.5, "& li": { mb: 0.75 }, typography: "body2" }}>
          <li>{t("Un ordre limite ", "A limit order ")}<b>{t("bloque", "locks")}</b>{t(" ses fonds dès qu'il est posé : les XAFe d'un achat, les USDT d'une vente. Ils reviennent s'il est annulé.", " its funds as soon as it is placed: XAFe for a buy, USDT for a sell. They come back if it is canceled.")}</li>
          <li>{t("Un ordre qui arrive rencontre d'abord le ", "An incoming order first meets the ")}<b>{t("meilleur prix", "best price")}</b>{t(" en face, puis, à prix égal, l'ordre ", " on the other side, then, at equal prices, the order that ")}<b>{t("arrivé le premier", "arrived first")}</b>.</li>
          <li>{t("L'échange se fait au prix de l'ordre ", "The trade happens at the price of the order ")}<b>{t("qui attendait", "that was waiting")}</b>{t(" : celui qui arrive ne paie jamais plus cher que sa limite.", ": the incoming order never pays more than its limit.")}</li>
          <li>{t("Un ordre peut être servi en plusieurs fois ; ce qui reste attend au carnet (limite) ou est annulé (marché).", "An order can be filled in several parts. What remains waits in the order book (limit) or is canceled (market).")}</li>
          <li>{t("On ne s'achète pas à soi-même : un ordre qui rencontrerait l'un des vôtres s'arrête là.", "You can't trade with yourself: an order that would meet one of your own stops there.")}</li>
          <li>{t("Les ordres passent ", "Orders go through ")}<b>{t("un par un", "one at a time")}</b>{t(" : deux ordres envoyés au même instant ne peuvent pas prendre le même vendeur.", ": two orders sent at the same instant can't take the same seller.")}</li>
        </Box>
      </Card>
      <Card sx={{ gap: 0 }}>
        <Typography variant="subtitle1" component="h2" sx={{ mb: 0.5 }}>{t("Les paramètres", "Parameters")}</Typography>
        <Regle titre={t("Prix de référence", "Reference price")} valeur={ref ? `${fPrix(ref)} XAFe` : t("aucun encore", "none yet")}
          aide={ref ? t("La moyenne des échanges des cinq dernières minutes, sinon le dernier échange, sinon le prix posé par l'équipe.", "The average of trades over the last five minutes; otherwise the last trade; otherwise the price set by the team.")
            : t("Aucun échange encore : le premier ordre fait le marché, sans bande de prix.", "No trades yet: the first order sets the market, with no price band.")} />
        <Regle titre={t("Bande d'un achat", "Buy price band")} valeur={achat ? `${fPrix(achat.min)} – ${fPrix(achat.max)}` : `${pc(MARCHE.bandeAchat[0])} – ${pc(MARCHE.bandeAchat[1])}`}
          aide={t(`Un achat limite se place entre ${pc(MARCHE.bandeAchat[0])} et ${pc(MARCHE.bandeAchat[1])} du prix de référence : une faute de frappe ne fait pas acheter à n'importe quel prix.`,
            `A limit buy must be between ${pc(MARCHE.bandeAchat[0])} and ${pc(MARCHE.bandeAchat[1])} of the reference price, so a typo can't make you buy at any price.`)} />
        <Regle titre={t("Bande d'une vente", "Sell price band")} valeur={vente ? `${fPrix(vente.min)} – ${fPrix(vente.max)}` : `${pc(MARCHE.bandeVente[0])} – ${pc(MARCHE.bandeVente[1])}`}
          aide={t(`Une vente limite se place entre ${pc(MARCHE.bandeVente[0])} et ${pc(MARCHE.bandeVente[1])} du prix de référence.`, `A limit sell must be between ${pc(MARCHE.bandeVente[0])} and ${pc(MARCHE.bandeVente[1])} of the reference price.`)} />
        <Regle titre={t("Protection d'un ordre au marché", "Market order protection")} valeur={`± ${pc(MARCHE.bandeExecution)}`}
          aide={t("Un ordre au marché ne s'exécute jamais à plus de cet écart du prix de référence ; ce qu'il ne trouve pas dans cette bande est annulé, pas servi à n'importe quel prix.",
            "A market order never fills further than this from the reference price. Anything it can't find within this band is canceled, not filled at any price.")} />
        <Regle titre={t("Pas de prix", "Price step")} valeur={`${fPrix(MARCHE.pasPrix)} XAFe`} aide={t("Un prix se donne à ce pas près : 618,40 ou 618,45, pas 618,41.", "Prices move in steps of this size: 618.40 or 618.45, not 618.41.")} />
        <Regle titre={t("Montant minimum d'un ordre", "Minimum order amount")} valeur={`${xaf(MARCHE.montantMin)} XAFe`}
          aide={t("Au prix de l'ordre (ou du marché pour un ordre au marché). La quantité se donne au centime d'USDT.", "At the order's price (or the market price for a market order). Quantities go down to 0.01 USDT.")} />
        <Regle titre={t("Montant maximum", "Maximum amount")} valeur={Number.isFinite(MARCHE.quantiteMax) ? `${fUsdt(MARCHE.quantiteMax)} USDT` : t("aucun", "none")} aide={t("Tradez autant que votre solde le permet.", "Trade as much as your balance allows.")} />
        {Number.isFinite(MARCHE.marcheQuantiteMax) && <Regle titre={t("Ordre au marché, au plus", "Market order, at most")} valeur={`${fUsdt(MARCHE.marcheQuantiteMax)} USDT`} aide={t("Au-delà, posez un ordre limite : vous fixez le prix.", "Above that, place a limit order: you set the price.")} />}
        <Regle titre={t("Ordres ouverts, au plus", "Open orders, at most")} valeur={String(MARCHE.ordresOuvertsMax)} aide={t("Par compte, en même temps.", "Per account, at the same time.")} />
        <Regle titre={t("Frais", "Fees")} valeur={`${pourcent(FRAIS.placeur)} · ${pourcent(FRAIS.preneur)}`}
          aide={t("Le premier si votre ordre attendait au carnet (il y apporte un prix), le second s'il prend un ordre qui attendait. L'acheteur les paie en USDT, le vendeur en XAFe.",
            "The first if your order was waiting in the order book (it adds a price), the second if it takes an order that was waiting. Buyers pay fees in USDT, sellers in XAFe.")} />
      </Card>
    </Screen>
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
            <Tab value="ouverts" label={`${etroit ? t("Ouverts", "Open") : t("Ordres ouverts", "Open orders")} (${ouverts.length})`} sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
            <Tab value="actifs" label={t("Actifs", "Assets")} sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
          </Tabs>
          <Button size="small" variant="text" component={Link} to="/marche/ordres" sx={{ minHeight: 32, fontSize: 13 }}>{t("Tout voir", "See all")}</Button>
        </Stack>
        {bas === "actifs" ? <Actifs /> : !ordres ? <Squelette hauteur={80} radius={12} /> : ouverts.length === 0 ? (
          <Typography variant="body2" sx={{ py: 2, textAlign: "center" }}>{t("Aucun ordre en attente.", "No pending orders.")}</Typography>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Stack>
      <Typography sx={{ fontSize: 11, color: "text.secondary" }}>{label}</Typography>
      <Typography sx={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
    </Stack>
  );
}

/** Le graphique, en panneau, à côté du formulaire d'ordre sur un grand écran. */
function PanneauGraphique() {
  const { data: c } = useCotation();
  const { data: carnet } = useCarnet(100);
  const [vue, setVue] = useState<"graphique" | "profondeur">("graphique");
  const v = c?.variation24h ?? 0;
  return (
    <Paper sx={{ p: 2.5, borderRadius: 6, display: "flex", flexDirection: "column", gap: 1.5, mt: 1 }}>
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" flexWrap="wrap" gap={2}>
        <Stack>
          <Typography variant="caption">{t("USDT/XAFe · dernier prix", "USDT/XAFe · last price")}</Typography>
          <Typography sx={{ fontSize: 30, fontWeight: 700, color: v >= 0 ? BUY : SELL, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{c?.dernier != null ? fPrix(c.dernier) : "—"}</Typography>
        </Stack>
        <Stack direction="row" gap={3}>
          <Stat label={t("Variation 24 h", "24h change")} value={t(`${v >= 0 ? "+" : ""}${enTranches(v, 2)} %`, `${v >= 0 ? "+" : ""}${enTranches(v, 2)}%`)} />
          <Stat label={t("Haut 24 h", "24h high")} value={c?.haut24h != null ? fPrix(c.haut24h) : "—"} />
          <Stat label={t("Bas 24 h", "24h low")} value={c?.bas24h != null ? fPrix(c.bas24h) : "—"} />
          <Stat label={t("Volume 24 h (USDT)", "24h volume (USDT)")} value={c ? fUsdt(Math.round(c.volume24hUsdt)) : "—"} />
        </Stack>
      </Stack>
      <Tabs value={vue} onChange={(_, val) => setVue(val)} sx={{ minHeight: 36, "& .MuiTab-root": { minHeight: 36, textTransform: "none", fontWeight: 600, px: 1.5 } }}>
        <Tab value="graphique" label={t("Graphique", "Chart")} />
        <Tab value="profondeur" label={t("Profondeur", "Depth")} />
      </Tabs>
      {vue === "graphique"
        ? <GraphiqueBourse hauteur={420} />
        : <Profondeur achats={carnet?.achats ?? []} ventes={carnet?.ventes ?? []} hauteur={360} />}
    </Paper>
  );
}

export function MarcheGraphique() {
  const navigate = useNavigate();
  const { data: c } = useCotation();
  const { data: carnet } = useCarnet(5);
  const { data: profond } = useCarnet(100);
  const [onglet, setOnglet] = useState<"carnet" | "profondeur" | "infos">("carnet");
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
            <Box component="span" sx={{ color: v >= 0 ? BUY : SELL, fontWeight: 600 }}>{v >= 0 ? "+" : ""}{t(`${enTranches(v, 2)} %`, `${enTranches(v, 2)}%`)}</Box>
          </Typography>
        </Stack>
        <Stack direction="row" gap={2.5}>
          <Stat label={t("Haut 24 h", "24h high")} value={c?.haut24h != null ? fPrix(c.haut24h) : "—"} />
          <Stat label={t("Bas 24 h", "24h low")} value={c?.bas24h != null ? fPrix(c.bas24h) : "—"} />
          <Stat label={t("Vol 24 h (USDT)", "24h vol (USDT)")} value={c ? fUsdt(Math.round(c.volume24hUsdt)) : "—"} />
        </Stack>
      </Stack>
      <Paper sx={{ p: 1.25, borderRadius: 3 }}>
        <GraphiqueBourse hauteur={300} compact />
      </Paper>
      <Tabs value={onglet} onChange={(_, val) => (val === "trades" ? navigate("/marche/carnet") : setOnglet(val))} variant="scrollable" scrollButtons={false} sx={{ minHeight: 40, "& .MuiTab-root": { minWidth: 0, px: 1.5, "@media (max-width:359px)": { fontSize: 13, px: 1 } } }}>
        <Tab value="carnet" label={t("Carnet", "Order book")} sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
        <Tab value="profondeur" label={t("Profondeur", "Depth")} sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
        <Tab value="trades" label={t("Transactions", "Trades")} sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
        <Tab value="infos" label={t("Infos", "Info")} sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
      </Tabs>
      {onglet === "profondeur" ? (
        <Profondeur achats={profond?.achats ?? []} ventes={profond?.ventes ?? []} hauteur={240} />
      ) : onglet === "carnet" ? (
        <Stack direction="row" gap={2}>
          <Stack sx={{ flex: 1 }}>
            <Stack direction="row" justifyContent="space-between"><Typography variant="caption">{t("Qté", "Qty")}</Typography><Typography variant="caption">{t("Achat", "Bid")}</Typography></Stack>
            {(carnet?.achats ?? []).map((n) => (
              <Box key={n.prix} sx={{ position: "relative", display: "flex", justifyContent: "space-between", height: 24, alignItems: "center" }}>
                <Box sx={{ position: "absolute", top: 1, bottom: 1, right: 0, width: `${Math.round((n.quantite / max) * 100)}%`, bgcolor: BUY_BG }} />
                <Typography sx={{ position: "relative", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{fUsdt(n.quantite)}</Typography>
                <Typography sx={{ position: "relative", fontSize: 13, fontWeight: 500, color: BUY, fontVariantNumeric: "tabular-nums" }}>{fPrix(n.prix)}</Typography>
              </Box>
            ))}
          </Stack>
          <Stack sx={{ flex: 1 }}>
            <Stack direction="row" justifyContent="space-between"><Typography variant="caption">{t("Vente", "Ask")}</Typography><Typography variant="caption">{t("Qté", "Qty")}</Typography></Stack>
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
          <Line label={t("Paire", "Pair")} value="USDT / XAFe" />
          <Line label={t("Prix en", "Priced in")} value={t("XAFe par USDT", "XAFe per USDT")} />
          <Line label={t("Pas de prix", "Price step")} value={fPrix(MARCHE.pasPrix)} />
          <Line label={t("Quantité minimale", "Minimum quantity")} value={`${fUsdt(MARCHE.quantiteMin)} USDT`} />
          <Line label={t("Frais placeur · preneur", "Maker · taker fees")} value={`${pourcent(FRAIS.placeur)} · ${pourcent(FRAIS.preneur)}`} />
          <Line label="1 XAFe" value={t("1 XAF, garanti par les floats MoMo et les banques", "1 XAF, backed by MoMo floats and banks")} />
        </Card>
      )}
      <Box sx={{ flex: 1 }} />
      <Stack direction="row" gap={1.5}>
        <Button fullWidth variant="contained" onClick={() => aller("achat")} sx={{ bgcolor: BUY, borderRadius: 2, "&:hover": { bgcolor: BUY } }}>{t("Acheter", "Buy")}</Button>
        <Button fullWidth variant="contained" onClick={() => aller("vente")} sx={{ bgcolor: SELL, borderRadius: 2, "&:hover": { bgcolor: SELL } }}>{t("Vendre", "Sell")}</Button>
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
  /* le filtre garde une clé ; le libellé de la puce se lit dans la langue de l'écran */
  const [filtre, setFiltre] = useState<"tout" | "achats" | "ventes">("tout");
  const [, poser] = useParcours("marche");
  const max = Math.max(1, ...(carnet?.achats ?? []).map((n) => n.quantite), ...(carnet?.ventes ?? []).map((n) => n.quantite));
  const totalA = (carnet?.achats ?? []).reduce((s, n) => s + n.quantite, 0);
  const totalV = (carnet?.ventes ?? []).reduce((s, n) => s + n.quantite, 0);
  const pctA = totalA + totalV > 0 ? Math.round((totalA / (totalA + totalV)) * 100) : 50;
  const choisir = (p: number) => { poser({ prix: fPrix(p), type: "limite" }); navigate("/marche"); };

  const colonne = (niveaux: Niveau[], side: Cote) => (
    <Stack sx={{ flex: 1 }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="caption">{side === "achat" ? t("Qté (USDT)", "Qty (USDT)") : t("Vente (XAFe)", "Ask (XAFe)")}</Typography>
        <Typography variant="caption">{side === "achat" ? t("Achat (XAFe)", "Bid (XAFe)") : t("Qté (USDT)", "Qty (USDT)")}</Typography>
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
        <Tab value="carnet" label={t("Carnet d'ordres", "Order book")} sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
        <Tab value="profondeur" label={t("Profondeur", "Depth")} sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
        <Tab value="trades" label={t("Transactions", "Trades")} sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
      </Tabs>
      {onglet === "carnet" && <>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Stack direction="row" gap={0.5}>
          {([["tout", t("Tout", "All")], ["achats", t("Achats", "Bids")], ["ventes", t("Ventes", "Asks")]] as const).map(([cle, nom]) => (
            <Chip key={cle} label={nom} size="small" onClick={() => setFiltre(cle)} variant={cle === filtre ? "filled" : "outlined"} color={cle === filtre ? "primary" : undefined} sx={{ height: 28, fontSize: 12 }} />
          ))}
        </Stack>
        <ButtonBase onClick={(e) => setMenuPas(e.currentTarget)} aria-label={t("Pas de prix", "Price step")} sx={{ borderRadius: 2, px: 1, py: 0.5, bgcolor: "background.paper", gap: 0.25 }}>
          <Typography variant="body2" sx={{ color: "text.primary" }}>{t("Pas", "Step")} {fPrix(pas)}</Typography>
          <ArrowDropDownRounded fontSize="small" />
        </ButtonBase>
        <Menu anchorEl={menuPas} open={Boolean(menuPas)} onClose={() => setMenuPas(null)}>
          {[MARCHE.pasPrix, 0.5, 1, 5].filter((x, i, t) => t.indexOf(x) === i).map((x) => (
            <MenuItem key={x} selected={x === pas} onClick={() => { setPas(x); setMenuPas(null); }}>{t("Pas", "Step")} {fPrix(x)}</MenuItem>
          ))}
        </Menu>
      </Stack>
      <Paper sx={{ p: 1.5, borderRadius: 3 }}>
        {!carnet ? <Squelette hauteur={330} radius={8} /> : (
          <Stack direction="row" gap={2}>
            {filtre !== "ventes" && colonne(carnet.achats, "achat")}
            {filtre !== "achats" && colonne(carnet.ventes, "vente")}
          </Stack>
        )}
        <Stack direction="row" alignItems="center" gap={1} sx={{ mt: 1.5 }}>
          <Typography sx={{ fontSize: 12, color: BUY, fontWeight: 600 }}>{t(`A ${pctA} %`, `B ${pctA}%`)}</Typography>
          <Box sx={{ flex: 1, height: 6, borderRadius: 3, overflow: "hidden", display: "flex" }}>
            <Box sx={{ width: `${pctA}%`, bgcolor: BUY }} />
            <Box sx={{ width: `${100 - pctA}%`, bgcolor: SELL }} />
          </Box>
          <Typography sx={{ fontSize: 12, color: SELL, fontWeight: 600 }}>{t(`${100 - pctA} % V`, `${100 - pctA}% S`)}</Typography>
        </Stack>
      </Paper>
      </>}
      {onglet === "trades" && <Paper sx={{ p: 1.5, borderRadius: 3 }}>
        <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
          <Typography variant="caption">{t("Heure", "Time")}</Typography>
          <Typography variant="caption">{t("Prix (XAFe)", "Price (XAFe)")}</Typography>
          <Typography variant="caption">{t("Qté (USDT)", "Qty (USDT)")}</Typography>
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
    <Screen back="/marche" title={t("Ordres", "Orders")} gap={1}>
      <Tabs value={onglet} onChange={(_, v) => setOnglet(v)} variant="fullWidth" sx={{ minHeight: 40, "& .MuiTab-root": { minWidth: 0, px: 1, "@media (max-width:359px)": { fontSize: 13, px: 0.5 } } }}>
        <Tab value="ouverts" label={t(`Ouverts (${ouverts.length})`, `Open (${ouverts.length})`)} sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
        <Tab value="historique" label={t("Historique", "History")} sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
        <Tab value="executions" label={t("Exécutions", "Fills")} sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />
      </Tabs>
      {onglet === "ouverts" ? (
        <>
          <Paper sx={{ px: 2, borderRadius: 3 }}>
            {ouverts.length === 0 ? <Typography variant="body2" sx={{ py: 3, textAlign: "center" }}>{t("Aucun ordre en attente.", "No pending orders.")}</Typography> : ouverts.map((o) => <OpenOrder key={o.id} o={o} onCancel={(id) => void annuler(id)} />)}
          </Paper>
          {ouverts.length > 1 && <Button variant="outlined" color="error" onClick={() => setToutAnnuler(true)}>{t("Tout annuler", "Cancel all")}</Button>}
          {aujourdHui.length > 0 && <>
            <Typography variant="subtitle1" sx={{ mt: 1 }}>{t("Aujourd'hui", "Today")}</Typography>
            <Paper sx={{ px: 2, borderRadius: 3 }}>{aujourdHui.slice(0, 5).map((o) => <OrdreFait key={o.id} o={o} />)}</Paper>
          </>}
        </>
      ) : liste.length === 0 ? (
        <Typography variant="body2" sx={{ py: 3, textAlign: "center" }}>{t("Pas encore d'ordre exécuté.", "No filled orders yet.")}</Typography>
      ) : (
        [...groupes].map(([jour, os]) => (
          <Box key={jour}>
            <Typography variant="subtitle1" sx={{ my: 1 }}>{jour}</Typography>
            <Paper sx={{ px: 2, borderRadius: 3 }}>{os.map((o) => (onglet === "executions" ? <OrdreFait key={o.id} o={o} /> : <OpenOrder key={o.id} o={o} />))}</Paper>
          </Box>
        ))
      )}
      <Feuille ouverte={toutAnnuler} onFermer={() => setToutAnnuler(false)} titre={t(`Annuler ${ouverts.length} ordres ?`, `Cancel ${ouverts.length} orders?`)}>
        <Stack gap={1.5}>
          <Typography variant="body2">{t("Les fonds bloqués reviennent en disponible, tout de suite.", "Your locked funds return to your available balance right away.")}</Typography>
          <Button variant="contained" color="error" onClick={async () => { for (const o of ouverts) await annuler(o.id); setToutAnnuler(false); }}>{t("Tout annuler", "Cancel all")}</Button>
          <Button variant="text" onClick={() => setToutAnnuler(false)}>{t("Garder", "Keep them")}</Button>
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
        <Typography sx={{ fontSize: 13, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{t(`${fUsdt(e.quantite)} USDT à ${fPrix(e.prix)}`, `${fUsdt(e.quantite)} USDT at ${fPrix(e.prix)}`)}</Typography>
        <Typography variant="caption">{heureSecondes(e.quand)} · {e.preneur ? t("preneur", "taker") : t("placeur", "maker")} · {t("frais", "fee")} {e.fraisActif === "USDT" ? enTranches(e.frais, 2) : xaf(e.frais)} {e.fraisActif}</Typography>
      </Stack>
      <Typography sx={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{xaf(e.montantXafe)} XAFe</Typography>
    </Stack>
  );
}

export function MarcheOrdreDetail() {
  const { id } = useParams();
  const { data, error } = useOrdre(id);
  const { annuler, erreur, effacer } = useAnnuler();
  if (!data) return <Attente erreur={error} title={t("Ordre", "Order")} back="/marche/ordres" hauteur={260} />;
  const { ordre: o, executions } = data;
  const ouvert = o.etat === "ouvert" || o.etat === "partiel";
  return (
    <Screen title={o.cote === "achat" ? t(`Achat ${fUsdt(o.quantite)} USDT`, `Buy ${fUsdt(o.quantite)} USDT`) : t(`Vente ${fUsdt(o.quantite)} USDT`, `Sell ${fUsdt(o.quantite)} USDT`)} back="/marche/ordres">
      <Card>
        <Stack direction="row" alignItems="center" gap={1}>
          <Chip label={nomDuCote(o.cote)} size="small" sx={{ height: 24, bgcolor: fond(o.cote), color: couleur(o.cote), fontWeight: 600 }} />
          <Chip label={nomDEtat(o.etat)} size="small" sx={{ height: 24 }} />
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption">{jourRelatif(o.creeLe)} · {heure(o.creeLe)}</Typography>
        </Stack>
        <Line label={t("Type", "Type")} value={nomDuType(o.type)} />
        {o.prix != null && <Line label={t("Prix limite", "Limit price")} value={`${fPrix(o.prix)} XAFe`} />}
        <Line label={t("Exécuté", "Filled")} value={`${fUsdt(o.executee)} / ${fUsdt(o.quantite)} USDT`} />
        {o.prixMoyen != null && <Line label={t("Prix moyen", "Avg. price")} value={`${fPrix(o.prixMoyen)} XAFe`} />}
        <Line label={t("Total", "Total")} value={`${xaf(o.totalXafe)} XAFe`} strong />
        {ouvert && o.bloque > 0 && <Line label={t("Bloqué", "Locked")} value={`${o.cote === "achat" ? xaf(o.bloque) : fUsdt(o.bloque)} ${o.cote === "achat" ? "XAFe" : "USDT"}`} />}
        <Line label={t("Référence", "Reference")} value={o.numero} mono />
      </Card>
      {executions.length > 0 && (
        <Paper sx={{ px: 2, pb: 1, borderRadius: 3 }}>
          <Typography variant="subtitle1" sx={{ py: 1.5 }}>{t("Exécutions", "Fills")}</Typography>
          {executions.map((e) => <LigneExecution key={e.id} e={e} />)}
        </Paper>
      )}
      <Box sx={{ flex: 1 }} />
      {ouvert && <Button variant="outlined" color="error" onClick={() => void annuler(o.id)}>{t("Annuler l'ordre", "Cancel order")}</Button>}
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
      title={t("Ordre exécuté", "Order filled")}
      amount={o.cote === "achat" ? `+${enTranches(recu, 2)} USDT` : `+${xaf(recu)} XAFe`}
      caption={o.cote === "achat"
        ? t(`Pour ${xaf(o.totalXafe)} XAFe, au prix moyen de ${o.prixMoyen != null ? fPrix(o.prixMoyen) : "—"}.`, `For ${xaf(o.totalXafe)} XAFe, at an average price of ${o.prixMoyen != null ? fPrix(o.prixMoyen) : "—"}.`)
        : t(`Pour ${fUsdt(o.executee)} USDT, au prix moyen de ${o.prixMoyen != null ? fPrix(o.prixMoyen) : "—"}.`, `For ${fUsdt(o.executee)} USDT, at an average price of ${o.prixMoyen != null ? fPrix(o.prixMoyen) : "—"}.`)}
      primary={{ label: t("Retour au marché", "Back to Market"), to: "/marche" }}
      secondary={{ label: t("Voir mon portefeuille", "View my wallet"), to: "/" }}
    >
      <Card>
        <Line label={t("Frais", "Fees")} value={`${fraisActif === "USDT" ? enTranches(frais, 2) : xaf(frais)} ${fraisActif}`} />
        <Line label={t("Exécutions", "Fills")} value={String(executions.length)} />
        <Line label={t("Référence", "Reference")} value={o.numero} mono />
      </Card>
    </Success>
  );
}

