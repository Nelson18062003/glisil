import { Card, StatsCard } from "compositions";
import {
  IconActivity,
  IconAlertTriangle,
  IconCheckCircle,
  IconDatabase,
  IconDownload,
  IconLayers,
  IconPercent,
  IconRefreshCw,
  IconSearch,
  IconUpload,
  IconUsers,
} from "icons";
import { Flex, Grid } from "layout";
import {
  Button,
  ButtonDanger,
  InputField,
  Navigation,
  NavigationPill,
  Notification,
  Search,
  SwitchField,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHead,
  TableRow,
  Tag,
  Text,
  TextHeading,
  TextSmall,
  TextStrong,
  TextSubheading,
} from "primitives";
import { AdminShell, Line } from "./shell";

/* --------------------------------------------------------- 1 Réserves */

export function Reserves() {
  return (
    <AdminShell
      active="reserves"
      title="Réserves et circulation"
      subtitle="Relevé automatique toutes les 5 minutes depuis les SMS de solde TOTEM et les relevés bancaires. Dernier : il y a 4 min."
      actions={
        <>
          <Button variant="neutral">Inventaire manuel</Button>
          <Button variant="primary">Publier l'attestation</Button>
        </>
      }
    >
      <Grid columns="repeat(4, minmax(0, 1fr))" gap="400">
        <StatsCard icon={<IconLayers size="32" />} stat="1 842 650 000" description="XAFe en circulation · dont 61,2 M sur la blockchain" />
        <StatsCard icon={<IconDatabase size="32" />} stat="1 851 200 000" description="XAF détenus · 6 floats MoMo, 2 banques" />
        <StatsCard icon={<IconCheckCircle size="32" />} stat="100,46 %" description="Couverture · jamais sous 100 % depuis 90 jours" />
        <StatsCard icon={<IconUpload size="32" />} stat="12 · 6 450 000" description="Sorties en attente · délai médian 38 s" />
      </Grid>

      <Grid columns="2fr 1fr" gap="400">
        <Card variant="stroke" padding="600">
          <div className="row">
            <TextSubheading>30 jours</TextSubheading>
            <TextSmall className="t-sec">XAFe en circulation (sombre) · XAF détenus (vert), toujours au-dessus</TextSmall>
          </div>
          <svg width="100%" height="200" viewBox="0 0 600 200" preserveAspectRatio="none" role="img" aria-label="XAFe en circulation et XAF détenus sur 30 jours">
            <line x1="0" y1="50" x2="600" y2="50" style={{ stroke: "var(--sds-color-border-default-default)" }} />
            <line x1="0" y1="100" x2="600" y2="100" style={{ stroke: "var(--sds-color-border-default-default)" }} />
            <line x1="0" y1="150" x2="600" y2="150" style={{ stroke: "var(--sds-color-border-default-default)" }} />
            <polyline fill="none" strokeWidth="2.5" strokeLinejoin="round" style={{ stroke: "var(--sds-color-icon-positive-default)" }} points="0,170 40,166 80,160 120,158 160,148 200,144 240,138 280,130 320,124 360,118 400,110 440,100 480,90 520,78 560,68 600,60" />
            <polyline fill="none" strokeWidth="2.5" strokeLinejoin="round" style={{ stroke: "var(--sds-color-icon-brand-default)" }} points="0,176 40,172 80,166 120,164 160,154 200,150 240,144 280,136 320,130 360,124 400,116 440,106 480,96 520,84 560,74 600,66" />
          </svg>
          <div className="row">
            <TextSmall className="mono t-sec">12 sept.</TextSmall>
            <TextSmall className="mono t-sec">22 sept.</TextSmall>
            <TextSmall className="mono t-sec">2 oct.</TextSmall>
            <TextSmall className="mono t-sec">12 oct.</TextSmall>
          </div>
        </Card>
        <Card variant="stroke" padding="600">
          <TextSubheading>Terminaux TOTEM</TextSubheading>
          <Terminal name="Akwa-1" detail="MTN-01, MTN-02, OM-01 · dernier SMS 14:02:11" state="ok" />
          <Terminal name="Bonabéri-1" detail="MTN-03, OM-02 · dernier SMS 13:58:40" state="ok" />
          <Terminal name="Yaoundé-1" detail="OM-03 · muet depuis 12 min · sorties déroutées vers Akwa-1" state="warn" />
        </Card>
      </Grid>

      <Card variant="stroke" padding="600">
        <div className="row">
          <TextSubheading>Où sont les XAF</TextSubheading>
          <TextSmall className="t-sec">solde lu dans le dernier SMS de solde (MoMo) ou le relevé (banque), comparé au grand livre</TextSmall>
        </div>
        <Table aria-label="Où sont les XAF" dense>
          <TableHead>
            <TableColumn id="compte" isRowHeader>Compte</TableColumn>
            <TableColumn id="terminal">Terminal</TableColumn>
            <TableColumn id="lu" align="right">Solde lu</TableColumn>
            <TableColumn id="livre" align="right">Grand livre</TableColumn>
            <TableColumn id="ecart" align="right">Écart</TableColumn>
            <TableColumn id="releve">Relevé</TableColumn>
            <TableColumn id="plafond">Plafond du jour</TableColumn>
          </TableHead>
          <TableBody>
            <Ligne compte="MTN-01" reseau="MTN" terminal="Akwa-1" lu="94 300 000" livre="94 300 000" ecart="0" releve="14:02" pct={71} plafond="71 M / 100 M" />
            <Ligne compte="MTN-02" reseau="MTN" terminal="Akwa-1" lu="88 150 000" livre="88 150 000" ecart="0" releve="14:00" pct={44} plafond="44 M / 100 M" />
            <Ligne compte="OM-01" reseau="OM" terminal="Akwa-1" lu="4 980 000" livre="4 980 000" ecart="0" releve="13:55" pct={92} plafond="5,5 M / 6 M" warn />
            <Ligne compte="OM-02" reseau="OM" terminal="Bonabéri-1" lu="3 120 000" livre="3 370 000" ecart="−250 000" releve="13:58" pct={30} plafond="1,8 M / 6 M" bad />
            <Ligne compte="Afriland" reseau="BANQUE" terminal="relevé" lu="1 480 000 000" livre="1 480 000 000" ecart="0" releve="09:30" />
            <Ligne compte="[BANQUE 2]" reseau="BANQUE" terminal="relevé" lu="180 650 000" livre="180 650 000" ecart="0" releve="09:30" />
          </TableBody>
        </Table>
      </Card>

      <Grid columns="repeat(2, minmax(0, 1fr))" gap="400">
        <Card variant="stroke" padding="600">
          <TextSubheading>Sorties en attente</TextSubheading>
          <Attente reference="XAFe-WD-000207" what="500 000 → OM 6 99 •• •• 43" state="TOTEM compose · 42 s" tone="warn" />
          <Attente reference="XAFe-WD-000206" what="3 000 000 → MTN 6 77 •• •• 10 · 3 transferts" state="2 / 3 envoyés" tone="pos" />
          <Attente reference="XAFe-WD-000203" what="1 000 000 → OM 6 96 •• •• 71" state="réseau OM muet · reprise dans 60 s" tone="neg" />
        </Card>
        <Card variant="stroke" padding="600">
          <TextSubheading>Entrées reçues sans référence</TextSubheading>
          <div className="sheet">
            <div className="row">
              <TextStrong>250 000 de 6 99 •• •• 18 (OM-02) · 13:58</TextStrong>
              <Tag scheme="warning" variant="secondary">retenu</Tag>
            </div>
            <TextSmall className="t-sec">
              Aucune référence ouverte pour ce numéro et ce montant. Rien n'est crédité au hasard : rapprocher à la main ou rembourser.
            </TextSmall>
            <div className="row-start">
              <Button variant="neutral" size="small">Rapprocher</Button>
              <ButtonDanger variant="danger-subtle" size="small">Rembourser</ButtonDanger>
            </div>
          </div>
          <TextSmall className="t-sec">C'est l'écart de −250 000 sur OM-02 dans le tableau : la même somme, vue des deux côtés.</TextSmall>
        </Card>
      </Grid>
    </AdminShell>
  );
}

function Terminal({ name, detail, state }: { name: string; detail: string; state: "ok" | "warn" | "bad" }) {
  return (
    <div className="sheet">
      <div className="row-start">
        <span className={`dot dot-${state}`} />
        <div className="col grow">
          <TextStrong>{name}</TextStrong>
          <TextSmall className="t-sec">{detail}</TextSmall>
        </div>
        <Tag scheme={state === "ok" ? "positive" : "warning"} variant="secondary">
          {state === "ok" ? "en ligne" : "hors ligne"}
        </Tag>
      </div>
    </div>
  );
}

function Ligne({
  compte, reseau, terminal, lu, livre, ecart, releve, pct, plafond, warn, bad,
}: {
  compte: string; reseau: string; terminal: string; lu: string; livre: string; ecart: string; releve: string; pct?: number; plafond?: string; warn?: boolean; bad?: boolean;
}) {
  return (
    <TableRow id={compte}>
      <TableCell>
        <span className="row-start">
          <Tag scheme="neutral" variant="secondary">{reseau}</Tag>
          {compte}
        </span>
      </TableCell>
      <TableCell>{terminal}</TableCell>
      <TableCell align="right"><span className="num">{lu}</span></TableCell>
      <TableCell align="right"><span className="num">{livre}</span></TableCell>
      <TableCell align="right"><span className={`num ${ecart === "0" ? "t-pos" : "t-neg"}`}>{ecart}</span></TableCell>
      <TableCell><span className="mono">{releve}</span></TableCell>
      <TableCell>
        {pct !== undefined ? (
          <span className="row-start">
            <span className={`bar ${bad ? "bar-bad" : warn ? "bar-warn" : ""}`} style={{ width: 90 }}>
              <span style={{ width: `${pct}%` }} />
            </span>
            <span className="num">{plafond}</span>
          </span>
        ) : (
          <span className="t-sec">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function Attente({ reference, what, state, tone }: { reference: string; what: string; state: string; tone: "pos" | "warn" | "neg" }) {
  return (
    <div className="sheet">
      <div className="row">
        <span className="mono t-sec">{reference}</span>
        <Text className="grow num">{what}</Text>
        <TextSmall className={tone === "pos" ? "t-pos" : tone === "warn" ? "t-warn" : "t-neg"}>{state}</TextSmall>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- 2 Entrées */

export function Entrees() {
  return (
    <AdminShell
      active="entrees"
      title="Entrées (dépôts XAF)"
      subtitle="Chaque dépôt est crédité par TOTEM sans intervention. Vous voyez ici ce qui a été crédité, ce qui attend un paiement, et ce qui est retenu."
      actions={<Button variant="neutral"><IconDownload size="20" />Exporter CSV</Button>}
    >
      <div className="row">
        <Navigation direction="row">
          <NavigationPill isSelected>Aujourd'hui · 184</NavigationPill>
          <NavigationPill>En attente de paiement · 9</NavigationPill>
          <NavigationPill>Retenus · 1</NavigationPill>
          <NavigationPill>Crédités · 174</NavigationPill>
        </Navigation>
        <Search placeholder="Référence, numéro, montant" aria-label="Rechercher" />
      </div>

      <Notification variant="alert" icon={<IconAlertTriangle size="20" />}>
        <Text>
          <strong>1 entrée retenue</strong> : 250 000 XAF reçus de 6 99 •• •• 18 sur OM-02 à 13:58 sans référence ouverte. Rapprocher ou rembourser avant la clôture du jour.
        </Text>
      </Notification>

      <Card variant="stroke" padding="600">
        <Table aria-label="Dépôts du jour" dense>
          <TableHead>
            <TableColumn id="ref" isRowHeader>Référence</TableColumn>
            <TableColumn id="client">Client</TableColumn>
            <TableColumn id="reseau">Réseau</TableColumn>
            <TableColumn id="montant" align="right">Montant</TableColumn>
            <TableColumn id="sms">SMS lu</TableColumn>
            <TableColumn id="credit">Crédité</TableColumn>
            <TableColumn id="etat">État</TableColumn>
          </TableHead>
          <TableBody>
            <Depot reference="XAFe-DP-000418" client="Nelson S. · 6 77 •• •• 56" reseau="MTN-02" montant="1 000 000" sms="14:02:11" credit="14:02:13" etat="crédité" />
            <Depot reference="XAFe-DP-000417" client="Marie K. · 6 99 •• •• 02" reseau="OM-01" montant="400 000" sms="13:57:40" credit="13:57:41" etat="crédité" />
            <Depot reference="XAFe-DP-000416" client="Desk F-003 · 6 77 •• •• 81" reseau="MTN-01" montant="5 000 000" sms="13:51:02 (5 SMS)" credit="13:51:30" etat="crédité" />
            <Depot reference="—" client="inconnu · 6 99 •• •• 18" reseau="OM-02" montant="250 000" sms="13:58:05" credit="—" etat="retenu" />
            <Depot reference="XAFe-DP-000415" client="Alain T. · 6 55 •• •• 30" reseau="MTN-02" montant="50 000" sms="—" credit="—" etat="attente" />
            <Depot reference="XAFe-DP-000414" client="Desk F-001 · 6 77 •• •• 10" reseau="MTN-01" montant="20 000 000" sms="13:20:12 (20 SMS)" credit="13:22:48" etat="crédité" />
          </TableBody>
        </Table>
      </Card>
    </AdminShell>
  );
}

function Depot({ reference, client, reseau, montant, sms, credit, etat }: { reference: string; client: string; reseau: string; montant: string; sms: string; credit: string; etat: "crédité" | "retenu" | "attente" }) {
  const scheme = etat === "crédité" ? "positive" : etat === "retenu" ? "warning" : "neutral";
  return (
    <TableRow id={reference + client}>
      <TableCell><span className="mono">{reference}</span></TableCell>
      <TableCell>{client}</TableCell>
      <TableCell><Tag scheme="neutral" variant="secondary">{reseau}</Tag></TableCell>
      <TableCell align="right"><span className="num">{montant}</span></TableCell>
      <TableCell><span className="mono">{sms}</span></TableCell>
      <TableCell><span className="mono">{credit}</span></TableCell>
      <TableCell><Tag scheme={scheme} variant="secondary">{etat === "attente" ? "attend le paiement" : etat}</Tag></TableCell>
    </TableRow>
  );
}

/* ---------------------------------------------------------- 3 Sorties */

export function Sorties() {
  return (
    <AdminShell
      active="sorties"
      title="Sorties (retraits XAF)"
      subtitle="TOTEM compose les transferts MoMo. Une sortie qui échoue est reprise seule ; au-delà de trois reprises, elle vous est remontée ici."
      actions={<Button variant="neutral"><IconRefreshCw size="20" />Relancer les reprises</Button>}
    >
      <Grid columns="repeat(4, minmax(0, 1fr))" gap="400">
        <StatsCard icon={<IconUpload size="32" />} stat="12" description="en attente · 6 450 000 XAF" />
        <StatsCard icon={<IconActivity size="32" />} stat="38 s" description="délai médian aujourd'hui" />
        <StatsCard icon={<IconCheckCircle size="32" />} stat="212" description="sorties payées aujourd'hui · 148 M XAF" />
        <StatsCard icon={<IconAlertTriangle size="32" />} stat="1" description="à traiter à la main" />
      </Grid>

      <Notification variant="alert" icon={<IconAlertTriangle size="20" />}>
        <Text>
          <strong>XAFe-WD-000203</strong> · 1 000 000 XAF vers OM 6 96 •• •• 71 : le réseau Orange ne répond pas depuis 4 min sur Akwa-1. Reprise automatique dans 60 s. Les XAFe du client restent bloqués, rien n'est perdu.
        </Text>
      </Notification>

      <Card variant="stroke" padding="600">
        <Table aria-label="Sorties en cours" dense>
          <TableHead>
            <TableColumn id="ref" isRowHeader>Référence</TableColumn>
            <TableColumn id="client">Client</TableColumn>
            <TableColumn id="vers">Vers</TableColumn>
            <TableColumn id="montant" align="right">Montant</TableColumn>
            <TableColumn id="transferts">Transferts</TableColumn>
            <TableColumn id="terminal">Terminal</TableColumn>
            <TableColumn id="etat">État</TableColumn>
            <TableColumn id="action">Action</TableColumn>
          </TableHead>
          <TableBody>
            <Sortie reference="XAFe-WD-000207" client="Marie K." vers="OM 6 99 •• •• 43" montant="497 500" transferts="1 / 1" terminal="Akwa-1" etat="TOTEM compose · 42 s" tone="warn" />
            <Sortie reference="XAFe-WD-000206" client="Desk F-003" vers="MTN 6 77 •• •• 10" montant="2 985 000" transferts="2 / 3" terminal="Akwa-1" etat="en cours" tone="pos" />
            <Sortie reference="XAFe-WD-000205" client="Alain T." vers="MTN 6 55 •• •• 30" montant="49 750" transferts="1 / 1" terminal="Bonabéri-1" etat="payé 14:03:20" tone="pos" />
            <Sortie reference="XAFe-WD-000203" client="Desk F-002" vers="OM 6 96 •• •• 71" montant="995 000" transferts="0 / 1" terminal="Akwa-1" etat="réseau OM muet · 3e reprise" tone="neg" action />
          </TableBody>
        </Table>
      </Card>
    </AdminShell>
  );
}

function Sortie({ reference, client, vers, montant, transferts, terminal, etat, tone, action }: { reference: string; client: string; vers: string; montant: string; transferts: string; terminal: string; etat: string; tone: "pos" | "warn" | "neg"; action?: boolean }) {
  return (
    <TableRow id={reference}>
      <TableCell><span className="mono">{reference}</span></TableCell>
      <TableCell>{client}</TableCell>
      <TableCell><span className="num">{vers}</span></TableCell>
      <TableCell align="right"><span className="num">{montant}</span></TableCell>
      <TableCell><span className="mono">{transferts}</span></TableCell>
      <TableCell>{terminal}</TableCell>
      <TableCell><span className={tone === "pos" ? "t-pos" : tone === "warn" ? "t-warn" : "t-neg"}>{etat}</span></TableCell>
      <TableCell>
        {action ? (
          <span className="row-start">
            <Button variant="neutral" size="small">Dérouter vers Bonabéri-1</Button>
            <ButtonDanger variant="danger-subtle" size="small">Annuler et recréditer</ButtonDanger>
          </span>
        ) : (
          <span className="t-sec">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

/* --------------------------------------------------------- 4 Terminaux */

export function Terminaux() {
  return (
    <AdminShell
      active="terminaux"
      title="Terminaux TOTEM"
      subtitle="Les boîtiers qui portent les cartes SIM des floats. Chacun lit les SMS de ses cartes et compose les sorties. Un boîtier muet ne perd rien : les SMS attendent dans le modem."
      actions={<Button variant="primary">Ajouter un terminal</Button>}
    >
      <Grid columns="repeat(3, minmax(0, 1fr))" gap="400">
        <TerminalCard name="Akwa-1" lieu="Douala, Akwa" state="ok" vu="il y a 20 s" cartes={["MTN-01 · 94,3 M · signal 24/31", "MTN-02 · 88,2 M · signal 22/31", "OM-01 · 5,0 M · signal 19/31"]} entrees="128 SMS lus aujourd'hui" sorties="156 transferts composés · 0 échec" />
        <TerminalCard name="Bonabéri-1" lieu="Douala, Bonabéri" state="ok" vu="il y a 1 min" cartes={["MTN-03 · 41,7 M · signal 27/31", "OM-02 · 3,1 M · signal 21/31"]} entrees="44 SMS lus aujourd'hui" sorties="52 transferts composés · 1 reprise" />
        <TerminalCard name="Yaoundé-1" lieu="Yaoundé, Bastos" state="warn" vu="il y a 12 min" cartes={["OM-03 · dernier solde 2,2 M (13:50)"]} entrees="aucun SMS depuis 12 min" sorties="sorties déroutées vers Akwa-1" />
      </Grid>

      <Card variant="stroke" padding="600">
        <TextSubheading>Ce qui s'est passé</TextSubheading>
        <Table aria-label="Journal des terminaux" dense>
          <TableHead>
            <TableColumn id="heure" isRowHeader>Heure</TableColumn>
            <TableColumn id="terminal">Terminal</TableColumn>
            <TableColumn id="evenement">Événement</TableColumn>
          </TableHead>
          <TableBody>
            <TableRow id="1"><TableCell><span className="mono">14:02:11</span></TableCell><TableCell>Akwa-1</TableCell><TableCell>SMS MTN lu sur MTN-02 · entrée XAFe-DP-000418 reconnue et créditée</TableCell></TableRow>
            <TableRow id="2"><TableCell><span className="mono">13:58:40</span></TableCell><TableCell>Bonabéri-1</TableCell><TableCell>SMS OM lu sur OM-02 · aucune référence · entrée retenue</TableCell></TableRow>
            <TableRow id="3"><TableCell><span className="mono">13:50:30</span></TableCell><TableCell>Yaoundé-1</TableCell><TableCell>Dernier signe de vie · le boîtier ne répond plus (coupure de courant probable)</TableCell></TableRow>
            <TableRow id="4"><TableCell><span className="mono">13:50:35</span></TableCell><TableCell>plateforme</TableCell><TableCell>Sorties vers OM-03 déroutées vers Akwa-1 (OM-01)</TableCell></TableRow>
            <TableRow id="5"><TableCell><span className="mono">13:22:48</span></TableCell><TableCell>Akwa-1</TableCell><TableCell>20 SMS MTN recollés en une entrée · XAFe-DP-000414 · 20 000 000</TableCell></TableRow>
          </TableBody>
        </Table>
      </Card>
    </AdminShell>
  );
}

function TerminalCard({ name, lieu, state, vu, cartes, entrees, sorties }: { name: string; lieu: string; state: "ok" | "warn"; vu: string; cartes: string[]; entrees: string; sorties: string }) {
  return (
    <Card variant="stroke" padding="600">
      <div className="row">
        <div className="row-start">
          <span className={`dot dot-${state}`} />
          <div className="col">
            <TextHeading>{name}</TextHeading>
            <TextSmall className="t-sec">{lieu} · vu {vu}</TextSmall>
          </div>
        </div>
        <Tag scheme={state === "ok" ? "positive" : "warning"} variant="secondary">{state === "ok" ? "en ligne" : "hors ligne"}</Tag>
      </div>
      <div className="col">
        {cartes.map((c) => (
          <Text key={c} className="num">{c}</Text>
        ))}
      </div>
      <div className="sep" />
      <TextSmall className="t-sec">{entrees}</TextSmall>
      <TextSmall className="t-sec">{sorties}</TextSmall>
      <div className="row-start">
        <Button variant="neutral" size="small">Journal</Button>
        <Button variant="neutral" size="small">Redémarrer le robot</Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ 5 Marché */

export function Marche() {
  return (
    <AdminShell
      active="marche"
      title="Marché XAFe/USDT"
      subtitle="Ce que le marché fait aujourd'hui, et les quelques réglages qui le gouvernent."
      actions={<SwitchField label="Marché ouvert" defaultSelected />}
    >
      <Grid columns="repeat(4, minmax(0, 1fr))" gap="400">
        <StatsCard icon={<IconActivity size="32" />} stat="412 980 USDT" description="volume 24 h · 255,4 M XAFe" />
        <StatsCard icon={<IconPercent size="32" />} stat="0,08 %" description="écart moyen · 0,50 XAFe" />
        <StatsCard icon={<IconLayers size="32" />} stat="71 718 USDT" description="profondeur à 1 % · 45 054 achats, 26 724 ventes" />
        <StatsCard icon={<IconUsers size="32" />} stat="38" description="comptes actifs aujourd'hui · 9 desks" />
      </Grid>

      <Grid columns="3fr 2fr" gap="400">
        <Card variant="stroke" padding="600">
          <TextSubheading>Plus gros ordres au carnet</TextSubheading>
          <Table aria-label="Plus gros ordres" dense>
            <TableHead>
              <TableColumn id="compte" isRowHeader>Compte</TableColumn>
              <TableColumn id="cote">Côté</TableColumn>
              <TableColumn id="prix" align="right">Prix</TableColumn>
              <TableColumn id="qte" align="right">Quantité</TableColumn>
              <TableColumn id="bloque" align="right">Bloqué</TableColumn>
              <TableColumn id="depuis">Depuis</TableColumn>
            </TableHead>
            <TableBody>
              <TableRow id="a"><TableCell>Desk F-001</TableCell><TableCell><span className="t-pos">Achat</span></TableCell><TableCell align="right"><span className="num">617,50</span></TableCell><TableCell align="right"><span className="num">15 000 USDT</span></TableCell><TableCell align="right"><span className="num">9 262 500 XAFe</span></TableCell><TableCell><span className="mono">13:58</span></TableCell></TableRow>
              <TableRow id="b"><TableCell>Desk F-004</TableCell><TableCell><span className="t-neg">Vente</span></TableCell><TableCell align="right"><span className="num">619,00</span></TableCell><TableCell align="right"><span className="num">12 000 USDT</span></TableCell><TableCell align="right"><span className="num">12 000 USDT</span></TableCell><TableCell><span className="mono">12:41</span></TableCell></TableRow>
              <TableRow id="c"><TableCell>Bonzini Payments</TableCell><TableCell><span className="t-pos">Achat</span></TableCell><TableCell align="right"><span className="num">616,50</span></TableCell><TableCell align="right"><span className="num">10 500 USDT</span></TableCell><TableCell align="right"><span className="num">6 473 250 XAFe</span></TableCell><TableCell><span className="mono">11:05</span></TableCell></TableRow>
              <TableRow id="d"><TableCell>Desk F-002</TableCell><TableCell><span className="t-neg">Vente</span></TableCell><TableCell align="right"><span className="num">620,00</span></TableCell><TableCell align="right"><span className="num">6 100 USDT</span></TableCell><TableCell align="right"><span className="num">6 100 USDT</span></TableCell><TableCell><span className="mono">10:12</span></TableCell></TableRow>
            </TableBody>
          </Table>
        </Card>
        <Card variant="stroke" padding="600">
          <TextSubheading>Réglages</TextSubheading>
          <Flex direction="column" gap="400">
            <Grid columns="repeat(2, minmax(0, 1fr))" gap="200">
              <InputField label="Frais placeur (%)" defaultValue="0,05" inputMode="decimal" />
              <InputField label="Frais preneur (%)" defaultValue="0,10" inputMode="decimal" />
            </Grid>
            <Grid columns="repeat(2, minmax(0, 1fr))" gap="200">
              <InputField label="Pas de prix (XAFe)" defaultValue="0,05" inputMode="decimal" />
              <InputField label="Ordre minimum (USDT)" defaultValue="10" inputMode="decimal" />
            </Grid>
            <InputField label="Bande de protection autour du dernier prix (%)" defaultValue="5" inputMode="decimal" description="Un ordre marché ne s'exécute pas au-delà. Évite qu'un carnet creux vide un compte." />
            <div className="sheet">
              <Line label="Binance P2P, médiane (lecture seule)" value="620,42 · il y a 30 s" />
              <Line label="Dernier prix XAFe/USDT" value="618,40" strong />
              <Line label="Écart au P2P" value="−0,33 %" className="t-pos" />
            </div>
            <Button variant="primary">Enregistrer</Button>
          </Flex>
        </Card>
      </Grid>
    </AdminShell>
  );
}

/* ----------------------------------------------------------- 6 Clients */

export function Clients() {
  return (
    <AdminShell
      active="clients"
      title="Clients et paliers"
      subtitle="Qui est qui, ce qu'il a le droit de faire, et ce qu'il a fait. Les paliers montent avec les pièces fournies, jamais à la main."
      actions={<Search placeholder="Nom, numéro, référence" aria-label="Rechercher un client" />}
    >
      <div className="row">
        <Navigation direction="row">
          <NavigationPill isSelected>Tous · 1 204</NavigationPill>
          <NavigationPill>Palier 0 · 802</NavigationPill>
          <NavigationPill>Palier 1 · 371</NavigationPill>
          <NavigationPill>Palier 2 (entreprises) · 31</NavigationPill>
          <NavigationPill>À vérifier · 14</NavigationPill>
        </Navigation>
        <Button variant="neutral"><IconSearch size="20" />Filtres</Button>
      </div>

      <Card variant="stroke" padding="600">
        <Table aria-label="Clients" dense>
          <TableHead>
            <TableColumn id="client" isRowHeader>Client</TableColumn>
            <TableColumn id="palier">Palier</TableColumn>
            <TableColumn id="numeros">Numéros vérifiés</TableColumn>
            <TableColumn id="xafe" align="right">XAFe</TableColumn>
            <TableColumn id="usdt" align="right">USDT</TableColumn>
            <TableColumn id="volume" align="right">Volume 30 j</TableColumn>
            <TableColumn id="etat">État</TableColumn>
          </TableHead>
          <TableBody>
            <ClientRow nom="Desk F-001 · SARL KAMDEM & FILS" palier="2" numeros="MTN ×2, OM ×1" xafe="12 480 000" usdt="38 200" volume="412 M XAFe" etat="actif" />
            <ClientRow nom="Bonzini Payments · NORTON GAUSS BONZINI SARL" palier="2" numeros="MTN ×2, OM ×1, Afriland" xafe="3 250 000" usdt="2 608" volume="1 690 M XAFe" etat="actif" />
            <ClientRow nom="Marie K." palier="1" numeros="OM ×1" xafe="220 000" usdt="0" volume="6,2 M XAFe" etat="actif" />
            <ClientRow nom="Alain T." palier="0" numeros="MTN ×1" xafe="0" usdt="80" volume="150 000 XAFe" etat="actif" />
            <ClientRow nom="Desk F-004 · ETS. NGUEMO" palier="1 → 2" numeros="MTN ×1" xafe="7 900 000" usdt="12 000" volume="98 M XAFe" etat="à vérifier" />
            <ClientRow nom="inconnu · 6 99 •• •• 18" palier="—" numeros="—" xafe="—" usdt="—" volume="—" etat="entrée retenue" />
          </TableBody>
        </Table>
      </Card>

      <Grid columns="repeat(2, minmax(0, 1fr))" gap="400">
        <Card variant="stroke" padding="600">
          <TextSubheading>À vérifier (palier 2)</TextSubheading>
          <div className="sheet">
            <div className="row">
              <div className="col">
                <TextStrong>Desk F-004 · ETS. NGUEMO</TextStrong>
                <TextSmall className="t-sec">RCCM, bénéficiaires effectifs et pièce du gérant reçus le 11/10 · 98 M XAFe de volume au palier 1</TextSmall>
              </div>
              <span className="row-start">
                <Button variant="primary" size="small">Passer au palier 2</Button>
                <ButtonDanger variant="danger-subtle" size="small">Refuser</ButtonDanger>
              </span>
            </div>
          </div>
        </Card>
        <Card variant="stroke" padding="600">
          <TextSubheading>Paliers et limites</TextSubheading>
          <Line label="Palier 0 · téléphone + e-mail" value="[LIMITE 0] / jour" />
          <Line label="Palier 1 · pièce d'identité + selfie" value="[LIMITE 1] / jour" />
          <Line label="Palier 2 · entreprise" value="sans plafond plateforme" />
          <TextSmall className="t-sec">Les limites des opérateurs (MTN 1 M par transfert, Orange 500 k) s'appliquent toujours à l'entrée et à la sortie.</TextSmall>
        </Card>
      </Grid>
    </AdminShell>
  );
}

function ClientRow({ nom, palier, numeros, xafe, usdt, volume, etat }: { nom: string; palier: string; numeros: string; xafe: string; usdt: string; volume: string; etat: string }) {
  const scheme = etat === "actif" ? "positive" : etat === "à vérifier" ? "warning" : "neutral";
  return (
    <TableRow id={nom}>
      <TableCell>{nom}</TableCell>
      <TableCell><Tag scheme="neutral" variant="secondary">{palier}</Tag></TableCell>
      <TableCell>{numeros}</TableCell>
      <TableCell align="right"><span className="num">{xafe}</span></TableCell>
      <TableCell align="right"><span className="num">{usdt}</span></TableCell>
      <TableCell align="right"><span className="num">{volume}</span></TableCell>
      <TableCell><Tag scheme={scheme} variant="secondary">{etat}</Tag></TableCell>
    </TableRow>
  );
}
