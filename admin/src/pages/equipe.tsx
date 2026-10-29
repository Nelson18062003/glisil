/*
 * L'Équipe : qui administre Glisil, avec quel rôle, quand chacun est venu ;
 * les invitations qui attendent leur première connexion ; inviter quelqu'un.
 * On n'entre qu'avec son adresse e-mail et un code : inviter, c'est donner
 * une adresse et un rôle, rien d'autre. Le super administrateur seulement.
 */
import { Button, Chip, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { useEquipe, useGuichet, useRafraichir } from "../guichet";
import { DROITS, NOMS_DES_ROLES, type Role } from "../noyau/droits";
import { heure, jourRelatif } from "../noyau/format";
import { Coquille, Dialogue, Erreur, Etat, Section, Tableau } from "../ui";

const ROLES: Role[] = ["super_admin", "operateur", "tresorier", "support"];

/** Ce que chaque rôle permet, dit simplement. */
const CE_QUE_FAIT: Record<Role, string> = {
  super_admin: "Tout, y compris l'équipe et les paramètres.",
  operateur: "Rapproche les SMS, suit les sorties et les boîtiers, voit les clients.",
  tresorier: "Rembourse, règle les paramètres et le marché, voit les clients.",
  support: "Voit tout et les fiches clients, sans rien changer.",
};

const emailValide = (e: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e.trim());

export function EquipePage() {
  const guichet = useGuichet();
  const rafraichir = useRafraichir();
  const { data } = useEquipe();
  const [dialogue, setDialogue] = useState<"inviter" | null>(null);
  const [email, setEmail] = useState("");
  const [nom, setNom] = useState("");
  const [role, setRole] = useState<Role>("operateur");
  const [erreur, setErreur] = useState<unknown>(null);
  const [enCours, setEnCours] = useState(false);

  const agir = async (f: () => Promise<unknown>, fermer = false) => {
    setEnCours(true); setErreur(null);
    try { await f(); if (fermer) { setDialogue(null); setEmail(""); setNom(""); setRole("operateur"); } await rafraichir(); }
    catch (e) { setErreur(e); }
    finally { setEnCours(false); }
  };

  return (
    <Coquille titre="Équipe" actions={<Button variant="contained" onClick={() => setDialogue("inviter")}>Inviter quelqu'un</Button>}>
      <Typography variant="body2" sx={{ maxWidth: 720 }}>
        Une personne invitée ouvre l'administration, touche « Première connexion », choisit son mot de passe, confirme son adresse par un code, ajoute son application d'authentification et note ses codes de secours : l'invitation devient alors son accès. Utilisez une adresse réservée à l'administration, pas celle d'un compte client.
      </Typography>
      {!dialogue && <Erreur erreur={erreur} onFermer={() => setErreur(null)} />}

      <Section titre="Administrateurs">
        <Tableau
          colonnes={["Nom", "Adresse e-mail", "Rôle", "Dernière connexion", "Depuis", "État", ""]}
          lignes={(data?.administrateurs ?? []).map((a) => [
            <Typography key="n" fontWeight={600}>{a.nom}{a.moi ? <Chip label="vous" size="small" sx={{ ml: 1, height: 20 }} /> : null}</Typography>,
            a.email,
            a.moi ? NOMS_DES_ROLES[a.role] : (
              <TextField key="r" select size="small" value={a.role} disabled={enCours} onChange={(e) => void agir(() => guichet.changerRole(a.id, e.target.value))} sx={{ minWidth: 190 }} slotProps={{ htmlInput: { "aria-label": `Rôle de ${a.nom}` } }}>
                {ROLES.map((r) => <MenuItem key={r} value={r}>{NOMS_DES_ROLES[r]}</MenuItem>)}
              </TextField>
            ),
            a.derniere_connexion ? `${jourRelatif(a.derniere_connexion)} ${heure(a.derniere_connexion)}` : "jamais",
            jourRelatif(a.cree_le),
            <Etat key="e" valeur={a.actif ? "actif" : "inactif"} />,
            a.moi ? "" : (
              <Button key="b" size="small" color={a.actif ? "error" : "primary"} disabled={enCours} onClick={() => void agir(() => guichet.activerAdministrateur(a.id, !a.actif))}>
                {a.actif ? "Mettre en pause" : "Réactiver"}
              </Button>
            ),
          ])}
          vide="Personne pour l'instant."
        />
      </Section>

      <Section titre="Invitations en attente">
        <Tableau
          colonnes={["Nom", "Adresse e-mail", "Rôle", "Invité", ""]}
          lignes={(data?.invitations ?? []).map((i) => [
            i.nom, i.email, NOMS_DES_ROLES[i.role], `${jourRelatif(i.invite_le)} ${heure(i.invite_le)}`,
            <Button key="b" size="small" color="error" disabled={enCours} onClick={() => void agir(() => guichet.retirerInvitation(i.email))}>Retirer</Button>,
          ])}
          vide="Aucune invitation en attente."
        />
      </Section>

      <Section titre="Ce que chaque rôle permet">
        <Stack direction="row" gap={2} flexWrap="wrap">
          {ROLES.map((r) => (
            <Paper key={r} sx={{ p: 2.5, borderRadius: 5, flex: 1, minWidth: 220 }}>
              <Typography fontWeight={600}>{NOMS_DES_ROLES[r]}</Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>{CE_QUE_FAIT[r]}</Typography>
              <Typography variant="caption" sx={{ display: "block", mt: 1 }}>{DROITS[r].join(" · ")}</Typography>
            </Paper>
          ))}
        </Stack>
      </Section>

      <Dialogue ouvert={dialogue === "inviter"} titre="Inviter quelqu'un dans l'équipe" onFermer={() => { setDialogue(null); setErreur(null); }}
        onValider={() => void agir(() => guichet.inviterAdministrateur({ email: email.trim().toLowerCase(), nom: nom.trim(), role }), true)}
        libelle="Inviter" enCours={enCours} desactive={!emailValide(email) || nom.trim().length < 2}>
        <TextField label="Adresse e-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value.replace(/\s/g, ""))} fullWidth autoFocus />
        <TextField label="Nom" value={nom} onChange={(e) => setNom(e.target.value)} fullWidth />
        <TextField select label="Rôle" value={role} onChange={(e) => setRole(e.target.value as Role)} fullWidth helperText={CE_QUE_FAIT[role]}>
          {ROLES.map((r) => <MenuItem key={r} value={r}>{NOMS_DES_ROLES[r]}</MenuItem>)}
        </TextField>
        <Typography variant="body2">La personne ira sur admin.glisil.com, entrera cette adresse et recevra un code. Envoyez-lui le lien vous-même.</Typography>
        <Erreur erreur={erreur} onFermer={() => setErreur(null)} />
      </Dialogue>
    </Coquille>
  );
}
