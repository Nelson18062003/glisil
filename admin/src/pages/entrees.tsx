/*
 * Les Entrées : les dossiers de dépôt et leurs transaction ID ; les SMS
 * retenus, à rapprocher (par la même voie que l'automatique) ou à rembourser
 * (par TOTEM).
 */
import { Autocomplete, Button, Chip, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useEntrees, useGuichet, useRafraichir, useRetenues } from "../guichet";
import type { Retenue } from "../guichet/types";
import { heure, jourRelatif, numeroEnTranches, xaf } from "../noyau/format";
import { useSession } from "../session/session";
import { Coquille, Dialogue, Erreur, Etat, Tableau } from "../ui";

export function Entrees() {
  const [params, setParams] = useSearchParams();
  const onglet = params.get("onglet") === "retenues" ? "retenues" : "depots";
  return (
    <Coquille titre="Entrées de XAF">
      <Tabs value={onglet} onChange={(_, v) => setParams(v === "depots" ? {} : { onglet: v })} sx={{ minHeight: 40 }}>
        <Tab value="depots" label="Dossiers de dépôt" sx={{ textTransform: "none", fontWeight: 600, minHeight: 40 }} />
        <Tab value="retenues" label="SMS retenus" sx={{ textTransform: "none", fontWeight: 600, minHeight: 40 }} />
      </Tabs>
      {onglet === "depots" ? <Depots /> : <Retenues />}
    </Coquille>
  );
}

function Depots() {
  const [etat, setEtat] = useState<string | null>(null);
  const { data } = useEntrees(etat);
  return (
    <>
      <Stack direction="row" gap={1}>
        {[["Tous", null], ["En attente", "en_attente"], ["Crédités", "credite"], ["Expirés", "expire"]].map(([l, v]) => (
          <Chip key={String(v)} label={l as string} onClick={() => setEtat(v as string | null)} color={etat === v ? "primary" : undefined} variant={etat === v ? "filled" : "outlined"} />
        ))}
      </Stack>
      <Tableau
        colonnes={["Dossier", "Client", "Opérateur · float", "Transaction ID", { label: "Crédité", align: "right" }, "État", "Ouvert"]}
        lignes={(data ?? []).map((d) => [
          <Typography fontFamily="Roboto Mono, monospace" fontSize={13} key="r">{d.reference}</Typography>,
          <Link to={`/clients/${d.compte.id}`} key="c" style={{ color: "inherit" }}>{d.compte.nom ?? numeroEnTranches(d.compte.telephone)}</Link>,
          `${d.operateur.toUpperCase()} · ${numeroEnTranches(d.float_numero)}`,
          <Stack direction="row" gap={0.5} flexWrap="wrap" key="x">
            {d.declarations.length === 0 ? <Typography variant="caption">aucun</Typography> : d.declarations.map((x) => <Chip key={x.id} size="small" label={`${x.transaction_id}${x.montant != null ? ` · ${xaf(x.montant)}` : ""}`} sx={{ height: 24, fontFamily: "Roboto Mono, monospace", bgcolor: x.etat === "credite" ? "#CDEFD9" : x.etat === "refuse" ? "#F9DEDC" : "#FFE3B5" }} />)}
          </Stack>,
          d.montant_recu > 0 ? `${xaf(d.montant_recu)} XAF` : "—",
          <Etat valeur={d.etat} key="e" />,
          `${jourRelatif(d.cree_le)} ${heure(d.cree_le)}`,
        ])}
        vide="Aucun dossier."
      />
    </>
  );
}

function Retenues() {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const { peut } = useSession();
  const [etat, setEtat] = useState<"retenue" | "rapprochee" | "remboursee">("retenue");
  const { data } = useRetenues(etat);
  const { data: dossiers } = useEntrees(null);
  const [cible, setCible] = useState<Retenue | null>(null);
  const [action, setAction] = useState<"rapprocher" | "rembourser" | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<unknown>(null);
  const [fait, setFait] = useState<string | null>(null);

  const ouvrir = (r: Retenue, a: "rapprocher" | "rembourser") => {
    setCible(r); setAction(a); setErreur(null); setNote("");
    const suggere = dossiers?.find((d) => d.operateur === r.operateur && d.compte.id === r.compte_suggere?.id && d.etat === "en_attente") ?? dossiers?.find((d) => d.reference === r.depot_reference);
    setReference(suggere?.reference ?? null);
  };
  const valider = async () => {
    if (!cible || !action) return;
    setEnCours(true); setErreur(null);
    try {
      if (action === "rapprocher") { const d = await guichet.rapprocher(cible.id, reference!); setFait(`${cible.transaction_id} rapproché au dossier ${reference} : ${d.etat === "credite" ? `${xaf(d.montant ?? 0)} XAFe crédités` : d.motif ?? d.etat}.`); }
      else { const r = await guichet.rembourser(cible.id, note); setFait(`${xaf(r.montant)} XAF à rembourser au ${numeroEnTranches(r.numero)} : TOTEM composera le transfert.`); }
      setCible(null); setAction(null); await rafraichir();
    } catch (e) { setErreur(e); } finally { setEnCours(false); }
  };

  return (
    <>
      <Stack direction="row" gap={1} alignItems="center">
        {([["Retenus", "retenue"], ["Rapprochés", "rapprochee"], ["Remboursés", "remboursee"]] as const).map(([l, v]) => (
          <Chip key={v} label={l} onClick={() => setEtat(v)} color={etat === v ? "primary" : undefined} variant={etat === v ? "filled" : "outlined"} />
        ))}
        <Typography variant="body2" sx={{ ml: 2 }}>Un SMS d'argent que personne n'a déclaré. Rien n'est crédité au hasard : on rattache au bon dossier, ou on rembourse.</Typography>
      </Stack>
      {fait && <Typography variant="body2" sx={{ bgcolor: "#CDEFD9", color: "#06331B", px: 2, py: 1, borderRadius: 3 }} onClick={() => setFait(null)}>{fait}</Typography>}
      <Tableau
        colonnes={["Reçu", "Terminal · float", "Payeur", { label: "Montant", align: "right" }, "Transaction ID", "Compte probable", "État", ""]}
        lignes={(data ?? []).map((r) => [
          `${jourRelatif(r.emis_le ?? r.cree_le)} ${heure(r.emis_le ?? r.cree_le)}`,
          `${r.terminal} · ${r.operateur.toUpperCase()} ${numeroEnTranches(r.float_numero)}`,
          r.numero_payeur ? numeroEnTranches(r.numero_payeur) : "inconnu",
          r.montant != null ? `${xaf(r.montant)} XAF` : "—",
          <Typography fontFamily="Roboto Mono, monospace" fontSize={13} key="t">{r.transaction_id ?? "—"}</Typography>,
          r.compte_suggere ? <Link key="c" to={`/clients/${r.compte_suggere.id}`} style={{ color: "inherit" }}>{r.compte_suggere.nom ?? numeroEnTranches(r.compte_suggere.telephone)}</Link> : <Typography variant="caption" key="c">aucun numéro connu</Typography>,
          <Etat valeur={r.etat} key="e" />,
          r.etat === "retenue" ? (
            <Stack direction="row" gap={0.5} key="a">
              {peut("rapprocher") && <Button size="small" variant="contained" onClick={() => ouvrir(r, "rapprocher")} sx={{ minHeight: 32 }}>Rapprocher</Button>}
              {peut("rembourser") && <Button size="small" variant="outlined" color="error" onClick={() => ouvrir(r, "rembourser")} sx={{ minHeight: 32 }}>Rembourser</Button>}
            </Stack>
          ) : r.depot_reference ?? "",
        ])}
        vide="Aucun SMS retenu : tout ce qui est arrivé a trouvé son dossier."
      />
      <Dialogue ouvert={Boolean(cible && action === "rapprocher")} titre={`Rapprocher ${cible?.transaction_id ?? ""}`} onFermer={() => setCible(null)} onValider={() => void valider()} libelle="Créditer le client" enCours={enCours} desactive={!reference}>
        <Typography variant="body2">{cible && `${xaf(cible.montant ?? 0)} XAF reçus de ${cible.numero_payeur ? numeroEnTranches(cible.numero_payeur) : "un numéro inconnu"} sur ${cible.operateur.toUpperCase()}. Le crédit suit la voie automatique, palier compris.`}</Typography>
        <Autocomplete
          options={(dossiers ?? []).filter((d) => d.operateur === cible?.operateur && d.etat !== "annule").map((d) => d.reference)}
          value={reference}
          onChange={(_, v) => setReference(v)}
          getOptionLabel={(r) => { const d = dossiers?.find((x) => x.reference === r); return d ? `${r} · ${d.compte.nom ?? numeroEnTranches(d.compte.telephone)} · ${d.etat}` : r; }}
          renderInput={(p) => <TextField {...p} label="Dossier de dépôt du client" />}
        />
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>
      <Dialogue ouvert={Boolean(cible && action === "rembourser")} titre={`Rembourser ${cible ? xaf(cible.montant ?? 0) : ""} XAF`} onFermer={() => setCible(null)} onValider={() => void valider()} libelle="Rembourser par TOTEM" couleur="error" enCours={enCours} desactive={note.trim().length < 3}>
        <Typography variant="body2">{cible && `Vers le ${cible.numero_payeur ? numeroEnTranches(cible.numero_payeur) : "?"} (${cible.operateur.toUpperCase()}). L'entrée sera close ; TOTEM compose le transfert depuis le float qui a reçu.`}</Typography>
        <TextField label="Pourquoi" value={note} onChange={(e) => setNote(e.target.value)} fullWidth autoFocus placeholder="au-delà du palier · payeur inconnu · demande du client" />
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>
    </>
  );
}
