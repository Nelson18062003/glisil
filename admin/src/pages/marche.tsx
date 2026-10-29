/*
 * Le Marché, vu de l'administration : la cotation, le carnet entier, les
 * dernières transactions, les chandelles, et l'interrupteur « ouvert » —
 * carnet par carnet (0045) : USDT/XAFe et USDC/XAFe ne se mêlent jamais.
 */
import { Box, Paper, Stack, Switch, Tab, Tabs, Typography } from "@mui/material";
import { useState } from "react";
import { useGuichet, useMarche, useRafraichir } from "../guichet";
import { PAIRES, type Paire } from "../guichet/types";
import { enTranches, heureSecondes, prix, usdt, xaf } from "../noyau/format";
import { useSession } from "../session/session";
import { Coquille, Erreur, Section, Tableau, Tuile } from "../ui";

const BUY = "#0B8F4D", SELL = "#D93025";

export function Marche() {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const { peut } = useSession();
  const [paire, setPaire] = useState<Paire>("USDT/XAFe");
  const { data: m } = useMarche(paire);
  const [erreur, setErreur] = useState<unknown>(null);
  if (!m) return <Coquille titre="Marché"><Typography variant="body2">Chargement…</Typography></Coquille>;
  const c = m.cotation;
  const base = paire.split("/")[0];
  /* l'état de CE carnet : ses règles s'il les dit (0045), sinon celles du marché entier */
  const ouvert = typeof m.regles?.ouvert === "boolean" ? m.regles.ouvert : m.parametres.ouvert;
  /* chaque carnet a son interrupteur, écrit dans « marche.paires.<paire> » : fermer l'un ne ferme jamais l'autre */
  const basculer = async (v: boolean) => {
    const paires = { ...(m.parametres.paires ?? {}) };
    paires[paire] = { ...(paires[paire] ?? {}), ouvert: v };
    try { await guichet.modifierParametre("marche", { ...m.parametres, paires }); await rafraichir(); } catch (e) { setErreur(e); }
  };
  const max = Math.max(1, ...m.carnet.achats.map((n) => n.quantite), ...m.carnet.ventes.map((n) => n.quantite));

  return (
    <Coquille titre={`Marché ${paire}`} actions={
      peut("parametres") ? (
        <Stack direction="row" alignItems="center" gap={1}>
          <Typography variant="body2">{ouvert ? `${paire} ouvert` : `${paire} fermé`}</Typography>
          <Switch checked={ouvert} onChange={(e) => void basculer(e.target.checked)} inputProps={{ "aria-label": `${paire} ouvert` }} />
        </Stack>
      ) : undefined
    }>
      <Tabs value={paire} onChange={(_, v) => setPaire(v)} sx={{ minHeight: 40 }}>
        {(m.paires ?? PAIRES).map((p) => <Tab key={p} value={p} label={p} data-paire={p} sx={{ minHeight: 40, textTransform: "none", fontWeight: 600 }} />)}
      </Tabs>
      <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      <Stack direction="row" gap={2} flexWrap="wrap">
        <Tuile label="Dernier" valeur={c.dernier != null ? prix(c.dernier) : "—"} unite="XAFe" tone="green" aide={c.il_y_a_24h != null && c.dernier != null ? `${c.dernier >= c.il_y_a_24h ? "+" : ""}${enTranches(((c.dernier - c.il_y_a_24h) / c.il_y_a_24h) * 100, 2)} % sur 24 h` : undefined} />
        <Tuile label="Haut · bas 24 h" valeur={`${c.haut != null ? prix(c.haut) : "—"} · ${c.bas != null ? prix(c.bas) : "—"}`} />
        <Tuile label="Volume 24 h" valeur={xaf(Math.round(c.volume_base ?? c.volume_usdt))} unite={base} aide={`${xaf(c.volume_xafe)} XAFe`} />
        <Tuile label="Écart" valeur={c.meilleur_achat != null && c.meilleure_vente != null ? prix(c.meilleure_vente - c.meilleur_achat) : "—"} aide={`${m.ordres_ouverts} ordres ouverts · frais ${(m.frais.placeur * 100).toFixed(2)} % / ${(m.frais.preneur * 100).toFixed(2)} %`} />
      </Stack>
      <Paper sx={{ p: 2, borderRadius: 5 }}>
        <Chandelles chandelles={m.chandelles} />
      </Paper>
      <Stack direction="row" gap={3} alignItems="flex-start">
        <Box sx={{ flex: 1 }}>
          <Section titre="Carnet">
            <Stack direction="row" gap={2}>
              {(["achats", "ventes"] as const).map((cote) => (
                <Paper key={cote} sx={{ flex: 1, p: 1.5, borderRadius: 4 }}>
                  <Typography variant="caption" sx={{ color: cote === "achats" ? BUY : SELL, fontWeight: 600 }}>{cote === "achats" ? "Achats" : "Ventes"}</Typography>
                  {m.carnet[cote].map((n) => (
                    <Box key={n.prix} sx={{ position: "relative", display: "flex", justifyContent: "space-between", height: 26, alignItems: "center", px: 0.5 }}>
                      <Box sx={{ position: "absolute", top: 1, bottom: 1, [cote === "achats" ? "right" : "left"]: 0, width: `${Math.round((n.quantite / max) * 100)}%`, bgcolor: cote === "achats" ? "rgba(11,143,77,0.12)" : "rgba(217,48,37,0.12)" }} />
                      <Typography sx={{ position: "relative", fontSize: 13, fontWeight: 500, color: cote === "achats" ? BUY : SELL, fontVariantNumeric: "tabular-nums" }}>{prix(n.prix)}</Typography>
                      <Typography sx={{ position: "relative", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{usdt(n.quantite)} <Typography component="span" variant="caption">· {n.ordres}</Typography></Typography>
                    </Box>
                  ))}
                </Paper>
              ))}
            </Stack>
          </Section>
        </Box>
        <Box sx={{ flex: 1 }}>
          <Section titre="Dernières transactions">
            <Tableau colonnes={["Heure", { label: "Prix", align: "right" }, { label: "Quantité", align: "right" }, "Preneur"]} lignes={m.transactions.map((t, i) => [heureSecondes(t.cree_le), <Typography key={i} sx={{ color: t.preneur === "achat" ? BUY : SELL, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{prix(t.prix)}</Typography>, usdt(t.quantite), t.preneur])} vide="Aucune transaction." />
          </Section>
        </Box>
      </Stack>
    </Coquille>
  );
}

function Chandelles({ chandelles }: { chandelles: { t: string; o: number; h: number; l: number; c: number; v: number }[] }) {
  const W = 1100, H = 220, VH = 50, top = 10, bottom = 10;
  if (chandelles.length === 0) return <Typography variant="body2">Pas encore d'exécution.</Typography>;
  const min = Math.min(...chandelles.map((c) => c.l)) - 0.3, max = Math.max(...chandelles.map((c) => c.h)) + 0.3;
  const y = (p: number) => top + ((max - p) / (max - min)) * (H - top - bottom);
  const step = W / chandelles.length;
  const vmax = Math.max(1, ...chandelles.map((c) => c.v));
  return (
    <svg width="100%" viewBox={`0 0 ${W + 50} ${H + VH + 20}`} role="img" aria-label="Chandelles">
      {[0.2, 0.5, 0.8].map((k) => { const g = min + (max - min) * k; return <g key={k}><line x1="0" y1={y(g)} x2={W} y2={y(g)} stroke="#E3E7E3" /><text x={W + 6} y={y(g) + 4} fontSize="11" fill="#5B615E">{g.toFixed(2)}</text></g>; })}
      {chandelles.map((c, i) => {
        const x = i * step + step / 2, up = c.c >= c.o, col = up ? BUY : SELL;
        return (
          <g key={c.t}>
            <line x1={x} y1={y(c.h)} x2={x} y2={y(c.l)} stroke={col} strokeWidth="1.2" />
            <rect x={x - step * 0.3} y={y(Math.max(c.o, c.c))} width={step * 0.6} height={Math.max(1.5, Math.abs(y(c.o) - y(c.c)))} fill={col} />
            <rect x={x - step * 0.3} y={H + 10 + (VH - (c.v / vmax) * VH)} width={step * 0.6} height={(c.v / vmax) * VH} fill={col} opacity="0.45" />
          </g>
        );
      })}
    </svg>
  );
}
