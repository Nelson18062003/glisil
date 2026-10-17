/*
 * Les Wallets : la crypto que la plateforme garde pour ses clients. Ce que le
 * veilleur de chaîne a vu à son dernier tour, réseau par réseau — le wallet
 * chaud (qui paie les retraits), le froid (qui garde le gros), ce qui réclame
 * quelqu'un — et en face, ce qu'on doit aux clients. La page ne signe rien :
 * les clés ne sont pas ici, elles ne sont nulle part dans la base.
 *
 * En tête, le REGISTRE DES RÉSEAUX (0018) : un client a un solde, le réseau
 * se choisit au dépôt et au retrait. L'équipe ouvre ou ferme un réseau ; le
 * moteur refuse d'ouvrir ce qui n'a ni contrat XAFe ni veilleur.
 */
import ContentCopyRounded from "@mui/icons-material/ContentCopyRounded";
import { Alert, Button, Chip, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { useState } from "react";
import { useGuichet, useRafraichir, useReseaux, useWallets } from "../guichet";
import type { ReseauRegistre, ReseauWallets } from "../guichet/types";
import { enTranches, quand } from "../noyau/format";
import { useSession } from "../session/session";
import { Coquille, Dialogue, Erreur, Etat, Section, Tableau, Tuile } from "../ui";

const NOMS: Record<string, string> = { bep20: "BNB Smart Chain · BEP20", trc20: "Tron · TRC20", erc20: "Ethereum · ERC20", base: "Base", polygon: "Polygon" };
const NATIF: Record<string, string> = { bep20: "BNB", trc20: "TRX", erc20: "ETH", base: "ETH", polygon: "POL" };
const decimalesNatif = (r: string) => (r === "trc20" ? 2 : 4);
const phrase = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function Adresse({ valeur }: { valeur: string }) {
  const [copie, setCopie] = useState(false);
  return (
    <Stack direction="row" alignItems="center" gap={0.5} sx={{ minWidth: 0 }}>
      <Typography fontFamily="Roboto Mono, monospace" fontSize={13} sx={{ wordBreak: "break-all" }}>{valeur}</Typography>
      <Tooltip title={copie ? "Copiée" : "Copier l'adresse"}>
        <IconButton size="small" aria-label="Copier l'adresse" onClick={async () => { try { await navigator.clipboard.writeText(valeur); setCopie(true); } catch { /* refusé : l'adresse reste lisible */ } }} color={copie ? "primary" : "default"}>
          <ContentCopyRounded fontSize="inherit" />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

function Ligne({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Stack direction={{ xs: "column", sm: "row" }} gap={{ xs: 0.25, sm: 2 }} sx={{ py: 1, borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0 } }}>
      <Typography variant="body2" sx={{ width: { sm: 200 }, flexShrink: 0, color: "text.secondary" }}>{label}</Typography>
      <Stack sx={{ minWidth: 0, flex: 1, fontVariantNumeric: "tabular-nums" }}>{children}</Stack>
    </Stack>
  );
}

function Reseau({ r }: { r: ReseauWallets }) {
  const e = r.etat;
  const [copie, setCopie] = useState(false);
  const etat = !e ? "jamais" : r.muet ? "muet" : "actif";
  return (
    <Section titre={NOMS[r.reseau] ?? r.nom ?? r.reseau.toUpperCase()} action={<Stack direction="row" alignItems="center" gap={1}>
      <Typography variant="caption">{r.maj_le ? `vu ${quand(r.maj_le)}` : "le veilleur n'a jamais tourné"}</Typography>
      {etat === "jamais" ? <Etat valeur="inactif" /> : <Etat valeur={etat} />}
    </Stack>}>
      <Stack gap={1.5}>
        {r.muet && e && <Alert severity="error" sx={{ borderRadius: 4 }}>Le veilleur ne publie plus rien depuis plus de deux minutes : les dépôts ne sont plus crédités et les retraits ne partent plus sur ce réseau. Vérifiez le service (npm run veilleur).</Alert>}
        {(e?.alertes ?? []).map((a, i) => <Alert key={i} severity="warning" sx={{ borderRadius: 4 }}>{phrase(a)}</Alert>)}
        {e && e.a_inscrire.length > 0 && (
          <Alert severity="info" sx={{ borderRadius: 4 }} action={
            <IconButton aria-label="Copier les adresses à inscrire" onClick={async () => { try { await navigator.clipboard.writeText(e.a_inscrire.join(" ")); setCopie(true); } catch { /* refusé */ } }} color={copie ? "primary" : "default"}><ContentCopyRounded /></IconButton>
          }>
            <b>{e.a_inscrire.length} adresse{e.a_inscrire.length > 1 ? "s" : ""} de dépôt XAFe</b> attend{e.a_inscrire.length > 1 ? "ent" : ""} leur inscription au contrat. Tant qu'elles ne sont pas inscrites, aucun client ne reçoit d'adresse XAFe neuve. Elles s'inscrivent avec la clé de l'admin du contrat : <code>npm run mise-en-service -- inscrire --reseau {r.reseau} --xafe …</code>
          </Alert>
        )}
        {!e && <Typography variant="body2">Aucun état publié. Le veilleur n'a pas encore tourné sur ce réseau — voir chaine/README.md, « Mise en service ».</Typography>}
        {e && (
          <Paper sx={{ p: 2.5, borderRadius: 5 }}>
            <Ligne label="Wallet chaud"><Adresse valeur={e.chaud} /></Ligne>
            <Ligne label="Au chaud">
              <Typography>{enTranches(e.usdt_chaud, 2)} USDT · {enTranches(e.natif_chaud, decimalesNatif(r.reseau))} {NATIF[r.reseau] ?? ""} pour les frais</Typography>
            </Ligne>
            <Ligne label="Wallet froid">
              {e.froid ? <Adresse valeur={e.froid} /> : <Typography variant="body2">Aucun : rien ne part au froid automatiquement.</Typography>}
            </Ligne>
            {e.froid && (
              <Ligne label="Au froid">
                <Typography>{e.usdt_froid != null ? `${enTranches(e.usdt_froid, 2)} USDT` : "—"}</Typography>
                {e.plafond_chaud != null && <Typography variant="caption">Au-delà de {enTranches(e.plafond_chaud, 0)} USDT au chaud, le surplus part au froid ; il en reste {enTranches(e.garder_chaud ?? 0, 0)} au chaud, plus ce que les retraits en attente demandent.</Typography>}
              </Ligne>
            )}
            <Ligne label="Adresses de dépôt"><Typography>{r.adresses_attribuees} données à des clients · {r.adresses_libres} prêtes</Typography></Ligne>
            <Ligne label="Retraits">
              <Typography>{r.retraits_en_cours} en cours</Typography>
              {r.retraits_remplaces > 0 && <Typography variant="caption">{r.retraits_remplaces} transaction{r.retraits_remplaces > 1 ? "s" : ""} remplacée{r.retraits_remplaces > 1 ? "s" : ""} (elle ne pouvait plus entrer dans un bloc) — chaque retrait n'est parti qu'une fois, la base garde l'ancienne et la nouvelle.</Typography>}
            </Ligne>
            <Ligne label="Lu jusqu'au bloc"><Typography>{r.curseur != null ? enTranches(r.curseur, 0) : "—"}</Typography></Ligne>
          </Paper>
        )}
      </Stack>
    </Section>
  );
}

/* l'état d'un réseau pour l'équipe, en un mot */
function etatDuReseau(r: ReseauRegistre): { valeur: string; label: string } {
  if (r.actif) return { valeur: "actif", label: "ouvert aux clients" };
  if (!r.lisible) return { valeur: "ferme", label: "pas encore de veilleur" };
  if (!r.configure) return { valeur: "ferme", label: "contrat à déployer" };
  return { valeur: "pret", label: "contrat posé, fermé aux clients" };
}

function Registre() {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const { peut } = useSession();
  const { data } = useReseaux();
  const [aBasculer, setABasculer] = useState<ReseauRegistre | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  const [enCours, setEnCours] = useState(false);
  const basculer = async (r: ReseauRegistre) => {
    setEnCours(true); setErreur(null);
    try { await guichet.activerReseau(r.id, !r.actif); setABasculer(null); await rafraichir(); } catch (e) { setErreur(e); setABasculer(null); } finally { setEnCours(false); }
  };
  return (
    <Section titre="Réseaux">
      <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      <Tableau
        colonnes={["Réseau", "Famille", "État", "Contrat XAFe", { label: "Clients", align: "right" }, ""]}
        lignes={(data ?? []).map((r) => {
          const e = etatDuReseau(r);
          const peutOuvrir = r.lisible && r.configure;
          return [
            <Stack key="n" gap={0.25} sx={{ maxWidth: 260 }}>
              <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
                <Typography fontWeight={600}>{r.nom}</Typography>
                {r.norme !== r.nom && <Typography variant="caption">{r.norme}</Typography>}
                {r.maison && <Chip size="small" label="maison · la réserve" sx={{ height: 22 }} />}
              </Stack>
              {r.note && !r.maison && <Typography variant="caption" sx={{ whiteSpace: "normal" }}>{r.note}</Typography>}
            </Stack>,
            r.famille.toUpperCase(),
            <Stack key="e" gap={0.25} alignItems="flex-start"><Etat valeur={e.valeur} /><Typography variant="caption">{e.label}</Typography></Stack>,
            r.contrat ? <Adresse key="c" valeur={r.contrat} /> : "—",
            `${r.adresses_attribuees}${r.retraits_en_cours ? ` · ${r.retraits_en_cours} retrait${r.retraits_en_cours > 1 ? "s" : ""} en cours` : ""}`,
            peut("parametres") && !r.maison && (r.actif || peutOuvrir)
              ? <Button key="b" size="small" variant={r.actif ? "text" : "outlined"} color={r.actif ? "error" : "primary"} sx={{ minHeight: 32 }} onClick={() => setABasculer(r)}>{r.actif ? "Fermer" : "Ouvrir"}</Button>
              : "",
          ];
        })}
      />
      <Typography variant="body2" sx={{ mt: 1 }}>
        Un client a un seul solde ; il choisit le réseau en déposant ou en retirant. La réserve de XAFe vit sur le réseau maison : un retrait sur un autre
        réseau y crée les XAFe et les détruit dans la réserve, si bien que la somme, tous réseaux ensemble, reste égale au registre (voir Parité).
        Ouvrir un réseau demande son contrat XAFe déployé et son nœud posé (mise en service), puis un clic ici.
      </Typography>
      <Dialogue ouvert={Boolean(aBasculer)} titre={aBasculer ? `${aBasculer.actif ? "Fermer" : "Ouvrir"} ${aBasculer.nom} aux clients ?` : ""}
        onFermer={() => setABasculer(null)} onValider={() => aBasculer && void basculer(aBasculer)}
        libelle={aBasculer?.actif ? "Fermer le réseau" : "Ouvrir le réseau"} couleur={aBasculer?.actif ? "error" : "primary"} enCours={enCours}>
        {aBasculer?.actif
          ? <Typography variant="body2">Les clients ne verront plus {aBasculer.nom} au dépôt ni au retrait. Les retraits déjà demandés partent quand même, et ce qui arrive encore sur une adresse déjà donnée est crédité : le veilleur continue.</Typography>
          : <Typography variant="body2">Les clients verront {aBasculer?.nom} au dépôt et au retrait. Vérifiez d'abord, sur le réseau d'essai, un dépôt et un retrait de bout en bout, et que le wallet chaud a de quoi payer les frais en {aBasculer?.natif}.</Typography>}
      </Dialogue>
    </Section>
  );
}

export function Wallets() {
  const { data: w } = useWallets();
  if (!w) return <Coquille titre="Wallets"><Typography variant="body2">Chargement…</Typography></Coquille>;
  const tenu = w.reseaux.reduce((s, r) => s + (r.etat?.usdt_chaud ?? 0) + (r.etat?.usdt_froid ?? 0), 0);
  const couverture = w.du_usdt > 0 ? tenu / w.du_usdt : null;
  return (
    <Coquille titre="Wallets">
      <Stack direction="row" gap={2} flexWrap="wrap">
        <Tuile label="USDT dus aux clients" valeur={enTranches(w.du_usdt, 2)} unite="USDT" tone="blue" aide={`plus ${enTranches(w.maison_usdt, 2)} USDT de frais à la maison`} />
        <Tuile label="Sur nos wallets (chaud + froid)" valeur={enTranches(tenu, 2)} unite="USDT" tone="green" aide="hors adresses de dépôt pas encore balayées" />
        <Tuile label="Couverture" valeur={couverture == null ? "—" : `${enTranches(couverture * 100, 1)} %`} tone={couverture == null || couverture >= 1 ? "green" : "amber"}
          aide={couverture != null && couverture < 1 ? "sous 100 % : un dépôt n'est peut-être pas encore balayé, ou un wallet manque" : "ce que l'on tient, rapporté à ce que l'on doit"} />
      </Stack>
      <Registre />
      {w.reseaux.map((r) => <Reseau key={r.reseau} r={r} />)}
      <Section titre="Dépôts qui n'ont crédité personne">
        <Tableau
          colonnes={["Réseau", "Actif", { label: "Montant", align: "right" }, "Adresse", "Pourquoi", "Vu"]}
          vide="Aucun : chaque dépôt vu sur la chaîne a trouvé son client."
          lignes={w.orphelins.map((o) => [o.reseau.toUpperCase(), o.actif, enTranches(o.montant, 2), <Adresse key="a" valeur={o.adresse} />, o.raison, quand(o.vu_le)])}
        />
        <Typography variant="body2" sx={{ mt: 1 }}>Un envoi sur une adresse jamais montrée à un client : les fonds sont sur NOS adresses (la graine les tient), mais rien ne dit à qui ils sont. Retrouvez l'expéditeur par la transaction, puis créditez-le à la main.</Typography>
      </Section>
    </Coquille>
  );
}
