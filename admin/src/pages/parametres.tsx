/*
 * Les Paramètres : les frais, le marché, les délais des dépôts, les reprises
 * des sorties, les paliers, la crypto, le code secret, le support, la version des conditions. Chaque bloc se modifie
 * en JSON, tel qu'il est en base ; le moteur le relit à l'appel suivant.
 */
import { Button, Paper, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useGuichet, useParametres, useRafraichir } from "../guichet";
import { xaf } from "../noyau/format";
import { useSession } from "../session/session";
import { Coquille, Erreur, Section, Tableau } from "../ui";

const BLOCS: { cle: string; titre: string; aide: string }[] = [
  { cle: "frais", titre: "Frais", aide: "placeur et preneur en fraction (0.001 = 0,10 %) ; sortie en fraction du montant" },
  { cle: "marche", titre: "Marché", aide: "la paire, le pas de prix, la quantité minimale, ouvert ou fermé" },
  { cle: "depot", titre: "Dépôts", aide: "validité d'un dossier (minutes) et grâce après expiration" },
  { cle: "sortie", titre: "Sorties", aide: "ouvertes : true/false ; mode : \"manuel\" (l'équipe paie et tape le transaction ID) ou \"totem\" (le boîtier compose) ; seuil_deux_personnes : au-delà de ce montant en XAF, une autre personne confirme (null = jamais) ; reprises_max : essais d'un transfert TOTEM" },
  { cle: "rapide", titre: "Achat rapide", aide: "la marge de la plateforme (0.01 = 1 %), la validité du prix en secondes, ouvert ou fermé" },
  { cle: "paliers", titre: "Paliers", aide: "plafonds par jour en entrée et en sortie ; null = sans plafond" },
  { cle: "crypto", titre: "Crypto", aide: "frais fixes par actif et confirmations par réseau" },
  { cle: "code_secret", titre: "Code secret", aide: "essais avant verrou, minutes de verrou, longueur" },
  { cle: "support", titre: "Support", aide: "ce que l'application propose dans Aide : l'e-mail, et le WhatsApp au format +2376XXXXXXXX (ou null)" },
  { cle: "parite", titre: "Parité", aide: "alerte_numero : le numéro qui reçoit l'alarme par SMS (null = aucun) ; alerte_operateur : \"mtn\" ou \"om\" ; fraicheur_heures : au-delà, le solde d'un float n'est plus « connu » ; delai_minutes : au-delà, une opération absente de la chaîne est une anomalie ; publier_floats : la page publique montre le total des floats" },
  { cle: "beta", titre: "Bêta", aide: "actif : true pendant la bêta (argent de test) ; message : le bandeau de l'application ; dotation : ce que reçoit chaque nouvel inscrit, {\"XAFe\": …, \"USDT\": …} ; depots_reels : false ferme les dépôts Mobile Money réels (sauf comptes autorisés)" },
  { cle: "robots", titre: "Robots du marché (bêta)", aide: "actif : false retire tous leurs ordres au tour suivant ; teneur : ecart (fraction entre le meilleur achat et la meilleure vente), niveaux, pas entre niveaux, taille_usdt, tolerance avant de recoter, inventaire (combien son stock déplace son milieu) ; traders : probabilite d'agir à chaque tour (30 s), taille_min/taille_max en USDT, part_preneur (au marché), duree_minutes d'un ordre limite, ordres_max ; derive : volatilite par tour, rappel vers le vrai dollar, borne, choc_probabilite, choc_max" },
  { cle: "cours", titre: "Vrai dollar", aide: "actif : relever EUR/USD (BCE) toutes les heures et poser 655,957 / EUR/USD comme prix de référence ; prime : en fraction, ajoutée au cours officiel (0.02 = le marché paie le dollar 2 % plus cher) ; saut_max : au-delà de cet écart avec le dernier cours posé, un relevé est refusé et attend l'équipe" },
  { cle: "numeros", titre: "Numéros", aide: "verification_sms : true exige un code SMS pour ajouter un numéro ; delai_heures : délai avant qu'un numéro neuf reçoive une sortie (0 = tout de suite)" },
  { cle: "conditions", titre: "Conditions d'utilisation", aide: "la version en vigueur (AAAA-MM-JJ) ; la changer AVEC le texte de l'application : chaque client la réacceptera" },
];

export function Parametres() {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const { peut } = useSession();
  const { data } = useParametres();
  const [brouillons, setBrouillons] = useState<Record<string, string>>({});
  /* les blocs que la personne est en train d'écrire : une relecture (retour sur l'onglet, toutes les trois secondes) ne les écrase pas */
  const [touches, setTouches] = useState<Set<string>>(new Set());
  const [erreur, setErreur] = useState<unknown>(null);
  const [fait, setFait] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setBrouillons((avant) => Object.fromEntries(BLOCS.map((b) => [b.cle, touches.has(b.cle) && avant[b.cle] !== undefined ? avant[b.cle] : JSON.stringify(data[b.cle] ?? null, null, 2)])));
  }, [data, touches]);

  const enregistrer = async (cle: string) => {
    setErreur(null);
    try {
      const valeur = JSON.parse(brouillons[cle]);
      await guichet.modifierParametre(cle, valeur);
      setFait(cle); setTimeout(() => setFait(null), 1500);
      await rafraichir();
      /* enregistré et relu : le bloc suit de nouveau la base */
      setTouches((t) => { const n = new Set(t); n.delete(cle); return n; });
    } catch (e) { setErreur(e instanceof SyntaxError ? new Error(`${cle} : JSON illisible — ${e.message}`) : e); }
  };

  return (
    <Coquille titre="Paramètres">
      <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      <Section titre="Opérateurs">
        <Tableau colonnes={["Opérateur", { label: "Plafond par transfert", align: "right" }, { label: "Plafond par jour", align: "right" }]} lignes={(data?.operateurs ?? []).map((o) => [o.nom, `${xaf(o.plafond_par_transfert)} XAF`, o.plafond_jour != null ? `${xaf(o.plafond_jour)} XAF` : "—"])} />
      </Section>
      <Stack direction="row" gap={2} flexWrap="wrap">
        {BLOCS.map((b) => (
          <Paper key={b.cle} sx={{ p: 2.5, borderRadius: 5, flex: "1 1 360px", display: "flex", flexDirection: "column", gap: 1.5 }}>
            <Typography variant="h6">{b.titre}</Typography>
            <Typography variant="body2">{b.aide}</Typography>
            <TextField value={brouillons[b.cle] ?? ""} onChange={(e) => { setTouches((t) => new Set(t).add(b.cle)); setBrouillons({ ...brouillons, [b.cle]: e.target.value }); }} multiline minRows={4} fullWidth disabled={!peut("parametres")} inputProps={{ "aria-label": `paramètre ${b.cle}`, style: { fontFamily: "Roboto Mono, monospace", fontSize: 13 } }} />
            {peut("parametres") && <Button variant="contained" onClick={() => void enregistrer(b.cle)} disabled={!data || brouillons[b.cle] === JSON.stringify(data[b.cle] ?? null, null, 2)}>{fait === b.cle ? "Enregistré" : "Enregistrer"}</Button>}
          </Paper>
        ))}
      </Stack>
    </Coquille>
  );
}
