/*
 * La Bêta, vue de l'équipe : qui teste, combien d'argent de test est parti,
 * ce que font les robots qui animent le marché, où en est le vrai dollar
 * qu'ils suivent, et ce que les testeurs ont signalé. Une page pour apprendre
 * de la bêta, pas pour la piloter au doigt : les réglages fins restent dans
 * Paramètres (« robots », « cours », « beta »).
 */
import { Alert, Button, Paper, Stack, Switch, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { useBeta, useGuichet, useRafraichir } from "../guichet";
import type { Beta, Signalement } from "../guichet/types";
import { enTranches, prix, quand, usdt, xaf } from "../noyau/format";
import { useSession } from "../session/session";
import { Coquille, Dialogue, Erreur, Etat, Section, Tableau, Tuile } from "../ui";

export function BetaPage() {
  const { data: b } = useBeta();
  const { peut } = useSession();
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const [erreur, setErreur] = useState<unknown>(null);
  const [enCours, setEnCours] = useState(false);
  if (!b) return <Coquille titre="Bêta"><Typography variant="body2">Chargement…</Typography></Coquille>;

  const actifs = Boolean(b.robots.parametre?.actif);
  const basculer = async (actif: boolean) => {
    setEnCours(true);
    try { await guichet.modifierParametre("robots", { ...(b.robots.parametre ?? {}), actif }); await rafraichir(); }
    catch (e) { setErreur(e); }
    finally { setEnCours(false); }
  };

  return (
    <Coquille titre="Bêta" actions={
      peut("parametres") ? (
        <Stack direction="row" alignItems="center" gap={1}>
          <Typography variant="body2">{actifs ? "Robots en marche" : "Robots arrêtés"}</Typography>
          <Switch checked={actifs} disabled={enCours} onChange={(e) => void basculer(e.target.checked)} inputProps={{ "aria-label": "robots en marche" }} />
        </Stack>
      ) : undefined
    }>
      <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      {!b.beta.actif && <Alert severity="info" sx={{ borderRadius: 4 }}>La bêta est éteinte : plus d'argent de test, et les robots ont retiré leurs ordres.</Alert>}
      {b.beta.message && <Alert severity="warning" icon={false} sx={{ borderRadius: 4 }}>Bandeau de l'application : « {b.beta.message} »</Alert>}

      <Stack direction="row" gap={2} flexWrap="wrap">
        <Tuile label="Testeurs" valeur={enTranches(b.testeurs.total)} tone="green" aide={`+${b.testeurs.nouveaux_24h} en 24 h · +${b.testeurs.nouveaux_7j} en 7 jours`} />
        <Tuile label="Ont échangé" valeur={enTranches(b.testeurs.ont_echange)} aide={`${b.testeurs.actifs_24h} ont posé un ordre en 24 h`} />
        <Tuile label="Échanges 24 h" valeur={enTranches(b.robots.echanges_24h.total)} aide={`${b.robots.echanges_24h.avec_un_testeur} avec un testeur · ${xaf(Math.round(b.robots.echanges_24h.volume_usdt))} USDT`} />
        <Tuile label="Signalements" valeur={enTranches(b.signalements.nouveaux)} unite="nouveaux" tone={b.signalements.nouveaux > 0 ? "amber" : "neutral"} aide={`${b.signalements.vus} vus · ${b.signalements.regles} réglés`} />
      </Stack>

      <Section titre="Argent de test distribué">
        <Stack direction="row" gap={2} flexWrap="wrap">
          <Tuile label="Aux testeurs" valeur={xaf(b.argent_de_test.xafe_testeurs)} unite="XAFe" aide={`et ${usdt(b.argent_de_test.usdt_testeurs)} USDT · ${xaf(b.beta.dotation.XAFe)} XAFe + ${usdt(b.beta.dotation.USDT)} USDT par inscrit`} />
          <Tuile label="Aux robots" valeur={xaf(b.argent_de_test.xafe_robots)} unite="XAFe" aide={`et ${usdt(b.argent_de_test.usdt_robots)} USDT`} />
        </Stack>
        <Typography variant="caption" sx={{ display: "block", mt: 1 }}>
          Ces XAFe sont frappés sur la chaîne d'essai comme les autres (le registre et la chaîne restent égaux) ; la parité les compte à part : aucun XAF n'est derrière.
        </Typography>
      </Section>

      <Robots b={b} />
      <Cours b={b} peutRegler={peut("parametres")} onErreur={setErreur} />
      {peut("clients") && <Signalements liste={b.derniers_signalements} onErreur={setErreur} />}
    </Coquille>
  );
}

function Robots({ b }: { b: Beta }) {
  const r = b.robots;
  const bilan = (r.etat?.bilan ?? {}) as { milieu?: number; ancre?: number; poses?: number; annules?: number; refus?: number; echanges?: number; attente?: string; actif?: boolean };
  return (
    <Section titre="Les robots du marché">
      <Paper sx={{ p: 2, borderRadius: 5, mb: 2 }}>
        <Stack direction={{ xs: "column", md: "row" }} gap={{ xs: 1, md: 4 }}>
          <Typography variant="body2"><b>Dernier tour</b> : {r.etat?.dernier_tour ? quand(r.etat.dernier_tour) : "jamais"} · {enTranches(r.etat?.tours ?? 0)} tours</Typography>
          <Typography variant="body2"><b>Milieu du teneur</b> : {bilan.milieu != null ? `${prix(bilan.milieu)} XAFe` : "—"}{bilan.ancre != null ? ` (vrai dollar ${prix(bilan.ancre)})` : ""}</Typography>
          <Typography variant="body2"><b>Dérive</b> : {r.etat ? `${enTranches((r.etat.derive ?? 0) * 100, 2)} %` : "—"}{r.etat?.dernier_choc ? ` · dernière nouvelle ${quand(r.etat.dernier_choc)}` : ""}</Typography>
        </Stack>
        {bilan.attente && <Alert severity="warning" sx={{ mt: 1, borderRadius: 3 }}>{bilan.attente}</Alert>}
        {bilan.actif && <Typography variant="caption">Ce tour : {bilan.poses ?? 0} ordres posés, {bilan.annules ?? 0} retirés, {bilan.refus ?? 0} refusés, {bilan.echanges ?? 0} échanges.</Typography>}
      </Paper>
      <Tableau
        colonnes={["Robot", { label: "XAFe", align: "right" }, { label: "USDT", align: "right" }, { label: "Ordres", align: "right" }, { label: "Actions", align: "right" }, "Dernier refus"]}
        lignes={r.robots.map((x) => [
          <Stack key={x.id}><Typography variant="body2" fontWeight={600}>{x.nom}</Typography>{x.role === "trader" && <Typography variant="caption">humeur {x.biais > 0 ? "acheteuse" : x.biais < 0 ? "vendeuse" : "neutre"} ({enTranches(x.biais * 100, 1)})</Typography>}</Stack>,
          xaf(Math.round(x.xafe)), usdt(x.usdt), enTranches(x.ordres_ouverts), `${enTranches(x.actions)}${x.refus ? ` · ${x.refus} refus` : ""}`,
          <Typography key={`e${x.id}`} variant="caption" sx={{ maxWidth: 320, display: "block", whiteSpace: "normal", overflowWrap: "anywhere" }}>{x.derniere_erreur ?? "—"}</Typography>,
        ])}
        vide="Aucun robot."
      />
    </Section>
  );
}

function Cours({ b, peutRegler, onErreur }: { b: Beta; peutRegler: boolean; onErreur: (e: unknown) => void }) {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState("");
  const [enCours, setEnCours] = useState(false);
  const d = b.cours.dernier;
  const eurUsd = Number(saisie.replace(",", "."));
  const valide = eurUsd >= 0.5 && eurUsd <= 2.5;
  const relever = async () => {
    setEnCours(true);
    try { const r = await guichet.releverLeCours(); if (!r.pose && r.erreur) onErreur({ message: "relevé non posé", detail: r.erreur }); await rafraichir(); }
    catch (e) { onErreur(e); }
    finally { setEnCours(false); }
  };
  const poser = async () => {
    setEnCours(true);
    try { await guichet.poserLeCours(eurUsd); setOuvert(false); setSaisie(""); await rafraichir(); }
    catch (e) { onErreur(e); }
    finally { setEnCours(false); }
  };
  return (
    <Section titre="Le vrai dollar" action={peutRegler ? (
      <Stack direction="row" gap={1}>
        <Button variant="outlined" size="small" disabled={enCours} onClick={() => void relever()}>Relever maintenant</Button>
        <Button variant="text" size="small" onClick={() => setOuvert(true)}>Poser un cours</Button>
      </Stack>
    ) : undefined}>
      <Stack direction="row" gap={2} flexWrap="wrap" sx={{ mb: 2 }}>
        <Tuile label="1 USD" valeur={d ? prix(d.usd_xaf) : "—"} unite="XAF" tone="green" aide={d ? `655,957 / ${enTranches(d.eur_usd, 4)} (EUR/USD, ${d.source === "frankfurter" ? "BCE" : d.source}${d.date_source ? ` du ${d.date_source}` : ""})` : "aucun cours relevé"} />
        <Tuile label="Prix de référence posé" valeur={b.cours.prix_reference != null ? prix(b.cours.prix_reference) : "—"} unite="XAFe" aide={`prime ${enTranches((b.cours.parametre?.prime ?? 0) * 100, 2)} % · relevé ${d ? quand(d.releve_le) : "—"}`} />
        <Tuile label="Référence du carnet" valeur={b.cours.reference != null ? prix(b.cours.reference) : "—"} unite="XAFe" aide="moyenne des échanges des 5 dernières minutes" />
      </Stack>
      <Tableau
        colonnes={["Relevé", "Source", { label: "EUR/USD", align: "right" }, { label: "1 USD", align: "right" }, "Posé"]}
        lignes={b.cours.releves.slice(0, 12).map((x) => [
          quand(x.releve_le), x.source, x.eur_usd != null ? enTranches(x.eur_usd, 4) : "—", x.usd_xaf != null ? prix(x.usd_xaf) : "—",
          x.pose ? <Etat key={x.id} valeur="actif" /> : <Typography key={x.id} variant="caption" color="error">{x.erreur ?? "non posé"}</Typography>,
        ])}
        vide="Aucun relevé encore."
      />
      <Dialogue ouvert={ouvert} titre="Poser un cours EUR/USD" onFermer={() => setOuvert(false)} onValider={() => void poser()} libelle="Poser" enCours={enCours} desactive={!valide}>
        <Typography variant="body2">À n'utiliser que pour confirmer un saut que le relevé automatique a refusé, après l'avoir vérifié sur le site de la BCE. Le cours posé devient tout de suite la référence du marché, et l'action est journalisée.</Typography>
        <TextField label="EUR/USD" value={saisie} onChange={(e) => setSaisie(e.target.value)} inputProps={{ inputMode: "decimal" }} helperText={valide ? `1 USD = ${prix(655.957 / eurUsd)} XAF` : "entre 0,5 et 2,5"} />
      </Dialogue>
    </Section>
  );
}

function Signalements({ liste, onErreur }: { liste: Signalement[]; onErreur: (e: unknown) => void }) {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const [choisi, setChoisi] = useState<Signalement | null>(null);
  const [note, setNote] = useState("");
  const [enCours, setEnCours] = useState(false);
  const traiter = async (etat: Signalement["etat"]) => {
    if (!choisi) return;
    setEnCours(true);
    try { await guichet.traiterSignalement(choisi.id, etat, note); setChoisi(null); setNote(""); await rafraichir(); }
    catch (e) { onErreur(e); }
    finally { setEnCours(false); }
  };
  return (
    <Section titre="Ce que les testeurs signalent">
      <Tableau
        colonnes={["Quand", "Testeur", "Problème", "Écran", "État", ""]}
        lignes={liste.map((s) => [
          quand(s.cree_le), s.nom ?? "—",
          <Typography key={`t${s.id}`} variant="body2" sx={{ maxWidth: 420, whiteSpace: "pre-wrap" }}>{s.texte}{s.note ? <Typography component="span" variant="caption" sx={{ display: "block", mt: 0.5 }}>Note : {s.note}</Typography> : null}</Typography>,
          <Typography key={`e${s.id}`} variant="caption">{s.ecran ?? "—"}{s.appareil ? <span style={{ display: "block" }}>{s.appareil}</span> : null}</Typography>,
          <Etat key={`s${s.id}`} valeur={s.etat} />,
          <Button key={`b${s.id}`} size="small" onClick={() => { setChoisi(s); setNote(s.note ?? ""); }}>Traiter</Button>,
        ])}
        vide="Aucun signalement pour l'instant."
      />
      <Dialogue ouvert={choisi !== null} titre={choisi ? `Signalement ${choisi.reference}` : ""} onFermer={() => setChoisi(null)}>
        {choisi && (
          <>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{choisi.texte}</Typography>
            <Typography variant="caption">{choisi.nom ?? "—"} · {quand(choisi.cree_le)}{choisi.ecran ? ` · ${choisi.ecran}` : ""}</Typography>
            <TextField label="Note de l'équipe" value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} inputProps={{ maxLength: 1000 }} />
            <Stack direction="row" gap={1} justifyContent="flex-end">
              <Button disabled={enCours} onClick={() => void traiter("vu")}>Marquer vu</Button>
              <Button variant="contained" disabled={enCours} onClick={() => void traiter("regle")}>Réglé</Button>
            </Stack>
          </>
        )}
      </Dialogue>
    </Section>
  );
}
