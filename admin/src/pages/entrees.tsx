/*
 * Les Entrées : les dossiers de dépôt et leurs transaction ID ; les SMS
 * retenus, à rapprocher (par la même voie que l'automatique) ou à rembourser
 * (par TOTEM). Un SMS dont le solde ne suit pas celui du float (0039) n'est ni
 * rapproché ni remboursé : l'équipe le vérifie chez l'opérateur, puis le
 * libère ou le rejette comme faux.
 */
import { Alert, Autocomplete, Button, Checkbox, Chip, FormControlLabel, Stack, Tab, Tabs, TextField, Typography } from "@mui/material";
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
  const [etat, setEtat] = useState<"retenue" | "rapprochee" | "remboursee" | "rejetee">("retenue");
  const { data } = useRetenues(etat);
  const { data: dossiers } = useEntrees(null);
  const [cible, setCible] = useState<Retenue | null>(null);
  const [action, setAction] = useState<"rapprocher" | "rembourser" | "liberer" | "rejeter" | null>(null);
  const [ancrer, setAncrer] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<unknown>(null);
  const [fait, setFait] = useState<string | null>(null);

  const ouvrir = (r: Retenue, a: "rapprocher" | "rembourser" | "liberer" | "rejeter") => {
    setCible(r); setAction(a); setErreur(null); setNote(""); setAncrer(false);
    const suggere = dossiers?.find((d) => d.operateur === r.operateur && d.compte.id === r.compte_suggere?.id && d.etat === "en_attente") ?? dossiers?.find((d) => d.reference === r.depot_reference);
    setReference(suggere?.reference ?? null);
  };
  const valider = async () => {
    if (!cible || !action) return;
    setEnCours(true); setErreur(null);
    try {
      if (action === "rapprocher") { const d = await guichet.rapprocher(cible.id, reference!); setFait(`${cible.transaction_id} rapproché au dossier ${reference} : ${d.etat === "credite" ? `${xaf(d.montant ?? 0)} XAFe crédités` : d.motif ?? d.etat}.`); }
      else if (action === "rembourser") { const r = await guichet.rembourser(cible.id, note); setFait(`${xaf(r.montant)} XAF à rembourser au ${numeroEnTranches(r.numero)} : TOTEM composera le transfert.`); }
      else if (action === "liberer") {
        const r = await guichet.liberer(cible.id, ancrer, note);
        const suite = r.reexaminees ? ` ${r.reexaminees} SMS suivant${r.reexaminees > 1 ? "s" : ""} vérifié${r.reexaminees > 1 ? "s" : ""} d'eux-mêmes.` : "";
        setFait(`${cible.transaction_id ?? "SMS"} libéré : ${r.credite ? `crédité au dossier ${r.reference}` : "en attente de la déclaration du client"}.${suite}`);
      } else { await guichet.rejeter(cible.id, note); setFait(`${cible.transaction_id ?? "SMS"} rejeté comme faux : rien n'est crédité ni remboursé.`); }
      setCible(null); setAction(null); await rafraichir();
    } catch (e) { setErreur(e); } finally { setEnCours(false); }
  };

  return (
    <>
      <Stack direction="row" gap={1} alignItems="center">
        {([["Retenus", "retenue"], ["Rapprochés", "rapprochee"], ["Remboursés", "remboursee"], ["Rejetés", "rejetee"]] as const).map(([l, v]) => (
          <Chip key={v} label={l} onClick={() => setEtat(v)} color={etat === v ? "primary" : undefined} variant={etat === v ? "filled" : "outlined"} />
        ))}
        <Typography variant="body2" sx={{ ml: 2 }}>Un SMS d'argent que personne n'a pu prendre. Rien n'est crédité au hasard : c'est le numéro qui a payé qui décide, et quand il ne suffit pas, c'est vous. On rattache au bon dossier, ou on rembourse.</Typography>
      </Stack>
      {fait && <Typography variant="body2" sx={{ bgcolor: "#CDEFD9", color: "#06331B", px: 2, py: 1, borderRadius: 3 }} onClick={() => setFait(null)}>{fait}</Typography>}
      <Tableau
        colonnes={["Reçu", "Carte", "Payeur · compte probable", { label: "Montant", align: "right" }, "Transaction ID", ""]}
        lignes={(data ?? []).map((r) => [
          <Stack key="q"><span>{jourRelatif(r.emis_le ?? r.cree_le)}</span><Typography variant="caption">{heure(r.emis_le ?? r.cree_le)}</Typography></Stack>,
          <Stack key="f"><span>{(r.operateur ?? "?").toUpperCase()} {numeroEnTranches(r.float_numero ?? "")}</span><Typography variant="caption">{r.terminal}</Typography></Stack>,
          <Stack key="p">
            <span>{r.numero_payeur ? numeroEnTranches(r.numero_payeur) : "inconnu"}</span>
            {r.compte_suggere
              ? <Link to={`/clients/${r.compte_suggere.id}`} style={{ color: "inherit", fontSize: 12 }}>{r.compte_suggere.nom ?? numeroEnTranches(r.compte_suggere.telephone)}</Link>
              : <Typography variant="caption">aucun compte à ce numéro</Typography>}
          </Stack>,
          r.montant != null ? `${xaf(r.montant)} XAF` : "—",
          <Stack key="t" gap={0.25}>
            <Typography fontFamily="Roboto Mono, monospace" fontSize={13}>{r.transaction_id || "—"}</Typography>
            {/* pourquoi l'appariement a refusé : en rouge quand l'équipe seule peut trancher */}
            {r.solde_a_verifier ? <SoldeAVerifier r={r} />
              : r.etat === "retenue" && r.motif && <Typography variant="caption" color={r.bloquee ? "error" : "text.secondary"} sx={{ whiteSpace: "normal", maxWidth: 260 }}>{r.motif}</Typography>}
            {r.note_equipe && <Typography variant="caption" sx={{ whiteSpace: "normal", maxWidth: 260 }}>{r.etat === "rejetee" ? "Rejeté" : "Libéré"}{r.liberee_par ? ` par ${r.liberee_par}` : ""} : {r.note_equipe}</Typography>}
          </Stack>,
          r.etat === "retenue" && r.solde_a_verifier ? (
            peut("rapprocher") ? (
              <Stack direction="row" gap={0.5} key="a">
                <Button size="small" variant="contained" onClick={() => ouvrir(r, "liberer")} sx={{ minHeight: 32 }}>Libérer</Button>
                <Button size="small" variant="outlined" color="error" onClick={() => ouvrir(r, "rejeter")} sx={{ minHeight: 32 }}>Rejeter : faux SMS</Button>
              </Stack>
            ) : <span key="a" />
          ) : r.etat === "retenue" ? (
            <Stack direction="row" gap={0.5} key="a">
              {peut("rapprocher") && <Button size="small" variant="contained" onClick={() => ouvrir(r, "rapprocher")} sx={{ minHeight: 32 }}>Rapprocher</Button>}
              {peut("rembourser") && <Button size="small" variant="outlined" color="error" onClick={() => ouvrir(r, "rembourser")} sx={{ minHeight: 32 }}>Rembourser</Button>}
            </Stack>
          ) : <Stack key="a" direction="row" gap={1} alignItems="center"><Etat valeur={r.etat} />{r.depot_reference ?? ""}</Stack>,
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
      <Dialogue ouvert={Boolean(cible && action === "liberer")} titre={`Libérer ${cible?.transaction_id ?? "ce SMS"}`} onFermer={() => setCible(null)} onValider={() => void valider()} libelle="Libérer" enCours={enCours} desactive={note.trim().length < 10}>
        <Alert severity="info" sx={{ borderRadius: 3 }}>Vérifiez dans l'historique de l'opérateur (*126# ou l'application MoMo, #150# pour Orange) que ce transaction ID existe, avec ce montant{cible?.montant != null ? ` (${xaf(cible.montant)} XAF)` : ""}. Libéré, le SMS reprend la voie automatique : la déclaration du client le prend.</Alert>
        <TextField label="Comment vous l'avez vérifié" value={note} onChange={(e) => setNote(e.target.value)} fullWidth autoFocus multiline minRows={2} placeholder="vu dans l'historique MoMo *126#, à 10 h 12" helperText="Dix caractères au moins : la note reste au journal." />
        <FormControlLabel disabled={cible?.solde_apres == null} control={<Checkbox checked={ancrer} onChange={(e) => setAncrer(e.target.checked)} />}
          label={cible?.solde_apres != null ? `Le solde annoncé (${xaf(cible.solde_apres)} XAF) est bien celui que montre l'opérateur : il devient le point de départ` : "Ce SMS n'annonce pas de solde : il ne peut pas servir de point de départ"} />
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>
      <Dialogue ouvert={Boolean(cible && action === "rejeter")} titre={`Rejeter ${cible?.transaction_id ?? "ce SMS"}`} onFermer={() => setCible(null)} onValider={() => void valider()} libelle="Rejeter : faux SMS" couleur="error" enCours={enCours} desactive={note.trim().length < 3}>
        <Typography variant="body2">Absent de l'historique de l'opérateur : un faux. Rien n'est crédité, rien n'est remboursé, et le SMS ne revient jamais.</Typography>
        <TextField label="Pourquoi" value={note} onChange={(e) => setNote(e.target.value)} fullWidth autoFocus placeholder="absent de l'historique MoMo" />
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>
    </>
  );
}

const SOURCES = { ussd: "par USSD", releve: "par relevé", sms: "par SMS vérifié" } as const;

/** Pourquoi le solde bloque : ce que le SMS annonce, et ce que la chaîne attendait. */
function SoldeAVerifier({ r }: { r: Retenue }) {
  const pourquoi = r.continuite === "absente" ? "aucun solde annoncé"
    : r.continuite === "sans_ancre" ? "premier solde du float inconnu"
    : `annoncé ${r.solde_apres != null ? xaf(r.solde_apres) : "?"} XAF · attendu ${r.solde_attendu != null ? xaf(r.solde_attendu) : "?"} XAF${r.ancre ? ` (dernier solde sûr ${xaf(r.ancre.solde)}, ${jourRelatif(r.ancre.annonce_le).toLowerCase()} à ${heure(r.ancre.annonce_le)}, ${SOURCES[r.ancre.source]})` : ""}`;
  return (
    <Stack gap={0.25} data-solde-a-verifier>
      <Chip size="small" label="Solde à vérifier" sx={{ height: 22, bgcolor: "#F9DEDC", color: "#8C1D18", fontWeight: 600, alignSelf: "flex-start" }} />
      <Typography variant="caption" color="error" sx={{ whiteSpace: "normal", maxWidth: 260 }}>{pourquoi}</Typography>
    </Stack>
  );
}
