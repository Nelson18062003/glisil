/*
 * Les Terminaux : les boîtiers TOTEM et les floats qu'ils portent. Une clé
 * se montre une fois, à la création ou au renouvellement ; elle ne se relit pas.
 */
import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded";
import { Button, Chip, IconButton, MenuItem, Stack, Switch, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { useGuichet, useRafraichir, useTerminaux } from "../guichet";
import { heure, jourRelatif, numeroEnTranches } from "../noyau/format";
import { useSession } from "../session/session";
import { Coquille, Dialogue, Erreur, Etat, Tableau } from "../ui";

export function Terminaux() {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const { peut } = useSession();
  const { data } = useTerminaux();
  const [nouveau, setNouveau] = useState(false);
  const [float, setFloat] = useState<string | null>(null);
  const [cle, setCle] = useState<{ id: string; cle: string } | null>(null);
  const [f, setF] = useState({ id: "", nom: "", lieu: "" });
  const [g, setG] = useState({ operateur: "mtn", numero: "", code_agent: "", titulaire: "" });
  const [erreur, setErreur] = useState<unknown>(null);
  const [enCours, setEnCours] = useState(false);
  const [copie, setCopie] = useState(false);
  const [aRenouveler, setARenouveler] = useState<string | null>(null);
  const [aRetirer, setARetirer] = useState<{ id: number; numero: string; dossiers: number } | null>(null);

  const creer = async () => {
    setEnCours(true); setErreur(null);
    try { const r = await guichet.creerTerminal(f); setNouveau(false); setF({ id: "", nom: "", lieu: "" }); setCle(r); await rafraichir(); } catch (e) { setErreur(e); } finally { setEnCours(false); }
  };
  const renouveler = async (id: string) => {
    setErreur(null); setEnCours(true);
    try { const r = await guichet.renouvelerCle(id); setARenouveler(null); setCle({ id, cle: r.cle }); } catch (e) { setErreur(e); } finally { setEnCours(false); }
  };
  const ajouterFloat = async () => {
    if (!float) return;
    setEnCours(true); setErreur(null);
    try { await guichet.creerFloat({ operateur: g.operateur, numero: g.numero, terminal: float, codeAgent: g.code_agent || null, titulaire: g.titulaire || null }); setFloat(null); setG({ operateur: "mtn", numero: "", code_agent: "", titulaire: "" }); await rafraichir(); } catch (e) { setErreur(e); } finally { setEnCours(false); }
  };
  const basculer = async (id: number, actif: boolean) => {
    setEnCours(true);
    try { await guichet.activerFloat(id, actif); setARetirer(null); await rafraichir(); } catch (e) { setErreur(e); } finally { setEnCours(false); }
  };

  return (
    <Coquille titre="Terminaux et floats" actions={peut("terminaux") ? <Button variant="contained" onClick={() => setNouveau(true)}>Nouveau terminal</Button> : undefined}>
      <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      <Tableau
        colonnes={["Terminal", "Lieu", "Vu", "État", "Floats", "À composer", ""]}
        lignes={(data ?? []).map((t) => [
          <Typography fontWeight={600} key="n">{t.nom} <Typography component="span" variant="caption">({t.id})</Typography></Typography>,
          t.lieu ?? "—",
          t.vu_le ? `${jourRelatif(t.vu_le)} ${heure(t.vu_le)}` : "jamais",
          <Etat valeur={t.demo ? "demo" : t.muet ? "muet" : "actif"} key="e" />,
          <Stack key="f" gap={0.5}>
            {(t.floats ?? []).map((x) => (
              <Stack key={x.id} direction="row" alignItems="center" gap={1}>
                <Chip size="small" label={`${x.operateur.toUpperCase()} ${numeroEnTranches(x.numero)}${x.titulaire ? ` · ${x.titulaire}` : " · sans titulaire"}${x.code_agent ? ` · agent ${x.code_agent}` : ""}`} sx={{ height: 24, opacity: x.actif ? 1 : 0.5 }} />
                {peut("terminaux") && <Switch size="small" checked={x.actif} onChange={(e) => (e.target.checked || !x.dossiers_ouverts ? void basculer(x.id, e.target.checked) : setARetirer({ id: x.id, numero: x.numero, dossiers: x.dossiers_ouverts }))} inputProps={{ "aria-label": `float ${x.numero} actif` }} />}
              </Stack>
            ))}
          </Stack>,
          String(t.commandes_en_attente ?? 0),
          peut("terminaux") ? (
            <Stack direction="row" gap={0.5} key="a">
              <Button size="small" variant="outlined" onClick={() => setFloat(t.id)} sx={{ minHeight: 32 }}>Ajouter un float</Button>
              <Button size="small" variant="text" onClick={() => setARenouveler(t.id)} sx={{ minHeight: 32 }}>Renouveler la clé</Button>
            </Stack>
          ) : "",
        ])}
      />
      <Typography variant="body2">Un boîtier est « muet » quand il n'a rien dit depuis dix minutes : ses floats reçoivent encore, mais aucun dossier neuf ne leur est attribué tant qu'un autre boîtier parle. Un terminal « démo » est la démo vivante de TOTEM : il ne parle que lorsqu'un testeur fait un geste, et ses floats sont toujours ouverts — aux seuls comptes de la bêta, jamais à l'argent réel. La clé d'un boîtier signe chacun de ses appels ; elle se pose dans TOTEM et ne se relit pas ici.</Typography>

      {/* Renouveler coupe le boîtier tout de suite : sans confirmation, un clic de travers arrêtait les dépôts et les sorties de toute une boutique. */}
      <Dialogue ouvert={Boolean(aRenouveler)} titre={`Renouveler la clé de ${aRenouveler ?? ""} ?`} onFermer={() => setARenouveler(null)} onValider={() => aRenouveler && void renouveler(aRenouveler)} libelle="Renouveler la clé" couleur="error" enCours={enCours}>
        <Typography variant="body2">L'ancienne clé cesse de marcher <b>tout de suite</b> : ce boîtier ne pourra plus pousser un SMS ni relever un transfert tant que la nouvelle n'est pas posée dans sa configuration. Les dépôts payés pendant ce temps restent sur la carte et arriveront quand il reparlera.</Typography>
        <Typography variant="body2">À faire si la clé a fuité (carte SD perdue, boîtier retiré du service), ou quand vous êtes devant le boîtier.</Typography>
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>

      {/* Des clients ont ce numéro sous les yeux : leur écran dira « ne payez pas ici », et ce qu'ils ont déjà payé reste crédité. */}
      <Dialogue ouvert={Boolean(aRetirer)} titre={`Retirer le float ${aRetirer ? numeroEnTranches(aRetirer.numero) : ""} ?`} onFermer={() => setARetirer(null)} onValider={() => aRetirer && void basculer(aRetirer.id, false)} libelle="Retirer le float" couleur="error" enCours={enCours}>
        <Typography variant="body2"><b>{aRetirer?.dossiers} dossier{(aRetirer?.dossiers ?? 0) > 1 ? "s" : ""} ouvert{(aRetirer?.dossiers ?? 0) > 1 ? "s" : ""}</b> donne{(aRetirer?.dossiers ?? 0) > 1 ? "nt" : ""} ce numéro à payer. Leurs clients verront « ce numéro ne reçoit plus : ne payez pas ici » et pourront payer à un autre float.</Typography>
        <Typography variant="body2">Un paiement déjà fait à ce numéro reste crédité quand son SMS arrive : retirer un float ne perd l'argent de personne, tant que la puce reste dans son boîtier.</Typography>
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>

      <Dialogue ouvert={nouveau} titre="Nouveau terminal" onFermer={() => setNouveau(false)} onValider={() => void creer()} libelle="Créer et montrer la clé" enCours={enCours} desactive={!/^[a-z0-9-]{3,32}$/.test(f.id) || f.nom.length < 2}>
        <TextField label="Identifiant" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value })} helperText="minuscules, chiffres et tirets : akwa-1" fullWidth autoFocus />
        <TextField label="Nom" value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} fullWidth />
        <TextField label="Lieu" value={f.lieu} onChange={(e) => setF({ ...f, lieu: e.target.value })} fullWidth />
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>

      <Dialogue ouvert={Boolean(cle)} titre={`La clé de ${cle?.id}`} onFermer={() => { setCle(null); setCopie(false); }}>
        <Typography variant="body2">Elle s'affiche <b>une seule fois</b>. Posez-la dans la configuration du boîtier ; si elle se perd, renouvelez-la.</Typography>
        <Stack direction="row" alignItems="center" gap={1} sx={{ bgcolor: "background.default", borderRadius: 3, p: 1.5 }}>
          <Typography fontFamily="Roboto Mono, monospace" fontSize={13} sx={{ wordBreak: "break-all", flex: 1 }} data-cle="1">{cle?.cle}</Typography>
          <IconButton aria-label="Copier la clé" onClick={async () => { try { await navigator.clipboard.writeText(cle?.cle ?? ""); setCopie(true); } catch { /* refusé : la clé reste lisible */ } }} color={copie ? "primary" : "default"}><ContentCopyRounded /></IconButton>
        </Stack>
      </Dialogue>

      <Dialogue ouvert={Boolean(float)} titre={`Ajouter un float à ${float}`} onFermer={() => setFloat(null)} onValider={() => void ajouterFloat()} libelle="Ajouter" enCours={enCours} desactive={!/^6\d{8}$/.test(g.numero.replace(/\D/g, "").replace(/^237/, ""))}>
        <TextField select label="Opérateur" value={g.operateur} onChange={(e) => setG({ ...g, operateur: e.target.value })} fullWidth>
          <MenuItem value="mtn">MTN MoMo</MenuItem>
          <MenuItem value="om">Orange Money</MenuItem>
        </TextField>
        <TextField label="Numéro du float" value={g.numero} onChange={(e) => setG({ ...g, numero: e.target.value })} fullWidth autoFocus placeholder="6 77 00 00 00" />
        <TextField label="Titulaire, tel que le client le lit en payant" value={g.titulaire} onChange={(e) => setG({ ...g, titulaire: e.target.value })} fullWidth placeholder="NORTON GAUSS BONZINI SARL 1" helperText="L'application le montre : « votre téléphone affiche un autre nom ? ne confirmez pas »." />
        <TextField label="Code agent (Orange : pour le retrait #150*14*…)" value={g.code_agent} onChange={(e) => setG({ ...g, code_agent: e.target.value.replace(/\D/g, "") })} fullWidth inputMode="numeric" />
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>
    </Coquille>
  );
}
