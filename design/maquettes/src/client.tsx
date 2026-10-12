import { Card } from "compositions";
import {
  IconAlertCircle,
  IconArrowDownLeft,
  IconArrowUpRight,
  IconBell,
  IconCheck,
  IconCheckCircle,
  IconChevronRight,
  IconCopy,
  IconDownload,
  IconExternalLink,
  IconEye,
  IconInfo,
  IconLock,
  IconRefreshCw,
  IconTrendingUp,
  IconUpload,
} from "icons";
import { Flex, Grid } from "layout";
import {
  Avatar,
  AvatarBlock,
  Button,
  ButtonGroup,
  IconButton,
  InputField,
  Navigation,
  NavigationPill,
  Notification,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Tag,
  Text,
  TextHeading,
  TextSmall,
  TextStrong,
  TextSubheading,
  TextTitlePage,
} from "primitives";
import type { ReactNode } from "react";
import { ClientShell, Line } from "./shell";

/* ----------------------------------------------------------- 1 Connexion */

export function Connexion() {
  return (
    <ClientShell>
      <Flex direction="column" gap="800">
        <div className="col">
          <TextTitlePage>Bienvenue</TextTitlePage>
          <Text className="t-sec">
            Entrez des XAF par MoMo, tradez des USDT au vrai prix du marché,
            ressortez vos XAF en moins d'une minute.
          </Text>
        </div>
        <Flex direction="column" gap="400">
          <InputField
            label="Numéro de téléphone"
            placeholder="6 77 12 34 56"
            type="tel"
            description="Celui de votre compte MoMo. Il reçoit le code de connexion."
          />
          <InputField label="Code secret" placeholder="6 chiffres" type="password" />
        </Flex>
        <ButtonGroup align="stack">
          <Button variant="primary" href="/client/portefeuille">
            Se connecter
          </Button>
          <Button variant="subtle">Créer un compte</Button>
        </ButtonGroup>
        <TextSmall className="t-sec">
          Un compte s'ouvre avec un numéro et un e-mail. Les limites montent avec
          la vérification d'identité (paliers 1 et 2).
        </TextSmall>
      </Flex>
    </ClientShell>
  );
}

/* -------------------------------------------------------- 2 Portefeuille */

export function Portefeuille() {
  return (
    <ClientShell
      active="portefeuille"
      action={
        <IconButton variant="subtle" aria-label="Notifications">
          <IconBell size="24" />
        </IconButton>
      }
    >
      <Card variant="brand" padding="600">
        <Flex direction="column" gap="400">
          <div className="row">
            <TextSmall>Solde total</TextSmall>
            <IconEye size="20" />
          </div>
          <TextTitlePage className="num">4 862 350 XAF</TextTitlePage>
          <Grid columns="repeat(2, minmax(0, 1fr))" gap="400">
            <div className="col">
              <TextSmall>XAFe</TextSmall>
              <TextHeading className="num">3 250 000</TextHeading>
              <TextSmall>1 XAFe = 1 XAF</TextSmall>
            </div>
            <div className="col">
              <TextSmall>USDT</TextSmall>
              <TextHeading className="num">2 608,05</TextHeading>
              <TextSmall>≈ 1 612 350 XAF</TextSmall>
            </div>
          </Grid>
        </Flex>
      </Card>

      <Grid columns="repeat(2, minmax(0, 1fr))" gap="200">
        <Button variant="primary" href="/client/entrer-xaf">
          <IconDownload size="20" />
          Entrer des XAF
        </Button>
        <Button variant="neutral" href="/client/sortir-xaf">
          <IconUpload size="20" />
          Sortir des XAF
        </Button>
        <Button variant="neutral" href="/client/crypto">
          <IconArrowDownLeft size="20" />
          Déposer crypto
        </Button>
        <Button variant="neutral" href="/client/crypto">
          <IconArrowUpRight size="20" />
          Retirer crypto
        </Button>
      </Grid>

      <Card
        variant="stroke"
        padding="600"
        interactionProps={{ href: "/client/marche", "aria-label": "Ouvrir le marché" }}
      >
        <div className="row">
          <div className="col">
            <div className="row-start">
              <TextStrong>XAFe / USDT</TextStrong>
              <Tag scheme="positive" variant="secondary">
                +0,31 %
              </Tag>
            </div>
            <TextHeading className="num">618,40</TextHeading>
            <TextSmall className="t-sec">
              XAFe par USDT · vol. 24 h 412 980 USDT
            </TextSmall>
          </div>
          <IconTrendingUp size="32" />
        </div>
      </Card>

      <div className="row">
        <TextSubheading>Dernières opérations</TextSubheading>
        <Button variant="subtle" size="small" href="/client/historique">
          Tout voir
        </Button>
      </div>
      <Flex direction="column" gap="200">
        <Operation
          icon={<IconDownload size="20" />}
          title="Entrée MTN MoMo"
          detail="14:02 · confirmée par TOTEM"
          amount="+1 000 000"
          tone="pos"
        />
        <Operation
          icon={<IconTrendingUp size="20" />}
          title="Achat 1 500 USDT à 618,20"
          detail="13:41 · ordre limite exécuté"
          amount="−927 300"
        />
        <Operation
          icon={<IconUpload size="20" />}
          title="Sortie Orange Money"
          detail="en cours · TOTEM compose le transfert"
          amount="−500 000"
          tone="warn"
        />
      </Flex>
    </ClientShell>
  );
}

function Operation({
  icon,
  title,
  detail,
  amount,
  tone,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  amount: string;
  tone?: "pos" | "warn";
}) {
  return (
    <div className="sheet">
      <div className="row-start">
        {icon}
        <div className="col grow">
          <TextStrong>{title}</TextStrong>
          <TextSmall className={tone === "warn" ? "t-warn" : "t-sec"}>{detail}</TextSmall>
        </div>
        <TextStrong className={`num ${tone === "pos" ? "t-pos" : ""}`}>{amount}</TextStrong>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- 3 Entrer XAF */

export function EntrerXAF() {
  return (
    <ClientShell title="Entrer des XAF" subtitle="1 Montant · 2 Payer · 3 Crédité" back="/client/portefeuille">
      <Flex direction="column" gap="600">
        <div className="col">
          <TextSmall className="t-sec">Depuis</TextSmall>
          <Navigation direction="row">
            <NavigationPill isSelected>MTN MoMo</NavigationPill>
            <NavigationPill>Orange Money</NavigationPill>
            <NavigationPill>Banque · bientôt</NavigationPill>
          </Navigation>
        </div>

        <InputField
          label="Montant à entrer (XAF)"
          defaultValue="1 000 000"
          inputMode="numeric"
          description="MTN : 1 000 000 XAF par transfert, 100 000 000 par jour."
        />
        <Navigation direction="row">
          <NavigationPill>500 000</NavigationPill>
          <NavigationPill isSelected>1 000 000</NavigationPill>
          <NavigationPill>5 000 000</NavigationPill>
          <NavigationPill>20 000 000</NavigationPill>
        </Navigation>

        <InputField
          label="Le numéro MoMo qui va payer"
          defaultValue="6 77 12 34 56"
          type="tel"
          description="TOTEM ne crédite que ce qui vient de ce numéro, pour ce montant, avec cette référence."
        />

        <div className="sheet">
          <Line label="Vous recevez" value="1 000 000 XAFe" strong />
          <Line label="Frais d'entrée" value="0" />
          <Line label="Crédit" value="dès lecture du SMS" className="t-pos" />
          <Line label="Transferts MTN à faire" value="1 × 1 000 000" />
        </div>

        <ButtonGroup align="stack">
          <Button variant="primary" href="/client/suivi-depot">
            Obtenir le numéro à payer
            <IconChevronRight size="20" />
          </Button>
        </ButtonGroup>
        <TextSmall className="t-sec">Le numéro et la référence restent valables 30 minutes.</TextSmall>
      </Flex>
    </ClientShell>
  );
}

/* -------------------------------------------------------- 4 Suivi dépôt */

export function SuiviDepot() {
  return (
    <ClientShell title="Dépôt XAFe-DP-000418" subtitle="MTN MoMo · aujourd'hui" back="/client/entrer-xaf">
      <Card variant="stroke" padding="600">
        <div className="row-start">
          <IconCheckCircle size="40" />
          <div className="col">
            <TextHeading className="num t-pos">+1 000 000 XAFe</TextHeading>
            <TextSmall className="t-sec">crédités 2 s après le SMS de MTN</TextSmall>
          </div>
        </div>
      </Card>

      <div className="timeline">
        <Step
          time="14:01:48"
          title="Référence créée"
          body="À payer : 1 000 000 XAF au numéro du float XAFe (MTN) depuis le 6 77 12 34 56."
        />
        <Step
          time="14:02:11"
          title="TOTEM a lu le SMS de MTN"
          body="Terminal Akwa-1 · carte MTN-02. Le SMS est gardé tel quel, jamais réécrit."
          sms="Vous avez recu 1,000,000 FCFA de JEAN KAMDEM (677123456). Ref: 1234567890. Votre nouveau solde est 94,300,000 FCFA."
        />
        <Step
          time="14:02:13"
          title="Montant et numéro reconnus, XAFe crédités"
          body="1 000 000 XAF reçus = 1 000 000 XAFe. La réserve XAF augmente du même montant."
          last
        />
      </div>

      <div className="sheet">
        <Line label="Référence XAFe" value={<span className="mono">XAFe-DP-000418</span>} />
        <Line label="Référence MTN" value={<span className="mono">1234567890</span>} />
        <Line label="Reçu" value="Télécharger le PDF" className="t-sec" />
      </div>

      <ButtonGroup align="stack">
        <Button variant="primary" href="/client/marche">
          Aller au marché
        </Button>
        <Button variant="subtle" href="/client/portefeuille">
          Retour au portefeuille
        </Button>
      </ButtonGroup>
    </ClientShell>
  );
}

function Step({
  time,
  title,
  body,
  sms,
  last,
}: {
  time: string;
  title: string;
  body: string;
  sms?: string;
  last?: boolean;
}) {
  return (
    <div className="timeline-step">
      <div className="timeline-rail">
        <IconCheckCircle size="24" />
        {!last && <span />}
      </div>
      <div className="timeline-body">
        <div className="row">
          <TextStrong>{title}</TextStrong>
          <TextSmall className="mono t-sec">{time}</TextSmall>
        </div>
        {sms && <div className="sms">{sms}</div>}
        <TextSmall className="t-sec">{body}</TextSmall>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- 5 Sortir XAF */

export function SortirXAF() {
  return (
    <ClientShell title="Sortir des XAF" back="/client/portefeuille">
      <Flex direction="column" gap="600">
        <InputField
          label="Montant à sortir (XAFe)"
          defaultValue="500 000"
          inputMode="numeric"
          description="Disponible : 3 250 000 XAFe"
        />

        <div className="col">
          <TextSmall className="t-sec">Vers</TextSmall>
          <Navigation direction="row">
            <NavigationPill isSelected>MTN MoMo</NavigationPill>
            <NavigationPill>Orange Money</NavigationPill>
          </Navigation>
        </div>

        <div className="sheet">
          <div className="row">
            <div className="col">
              <TextSmall className="t-sec">Numéro</TextSmall>
              <TextStrong className="num">+237 6 77 12 34 56</TextStrong>
            </div>
            <Tag scheme="positive" variant="secondary">
              vérifié
            </Tag>
            <Button variant="subtle" size="small">
              Changer
            </Button>
          </div>
          <TextSmall className="t-sec">
            Seuls vos numéros vérifiés peuvent recevoir une sortie. Un nouveau numéro attend 24 h.
          </TextSmall>
        </div>

        <div className="sheet">
          <Line label="Montant" value="500 000 XAFe" />
          <Line label="Frais de sortie (0,5 %)" value="2 500" />
          <div className="sep" />
          <Line label="Vous recevez" value="497 500 XAF" strong />
          <Line label="Transferts MTN" value="1 × 497 500" />
          <Line
            label="Délai habituel"
            value={
              <span className="row-start">
                <span className="dot dot-ok" />
                40 s · terminal Akwa-1 en ligne
              </span>
            }
          />
        </div>

        <Notification icon={<IconInfo size="20" />}>
          <Text>
            Au-delà de 1 000 000 XAF, TOTEM enchaîne plusieurs transferts MTN sur la même sortie.
          </Text>
        </Notification>

        <ButtonGroup align="stack">
          <Button variant="primary">
            <IconLock size="20" />
            Confirmer avec mon code
          </Button>
        </ButtonGroup>
        <TextSmall className="t-sec">
          Les XAFe sont bloqués dès la confirmation et détruits quand le transfert est parti.
        </TextSmall>
      </Flex>
    </ClientShell>
  );
}

/* ------------------------------------------------------------- 6 Marché */

const BIDS: [string, string][] = [
  ["617,90", "4 954"],
  ["617,85", "2 200"],
  ["617,50", "15 000"],
  ["617,20", "1 100"],
  ["617,00", "8 300"],
  ["616,80", "3 000"],
  ["616,50", "10 500"],
];
const ASKS: [string, string][] = [
  ["618,40", "341"],
  ["618,55", "483"],
  ["618,90", "2 600"],
  ["619,00", "12 000"],
  ["619,40", "1 800"],
  ["620,00", "6 100"],
  ["620,40", "3 400"],
];
const depth = (q: string, max: number) =>
  `${Math.min(100, Math.round((Number(q.replace(/\s/g, "")) / max) * 100))}%`;

export function Marche() {
  return (
    <ClientShell
      active="marche"
      title="XAFe / USDT"
      subtitle="Haut 621,05 · Bas 616,20 · Vol. 412 980 USDT"
      action={
        <div className="col" style={{ alignItems: "flex-end" }}>
          <TextHeading className="num t-pos">618,40</TextHeading>
          <TextSmall className="t-pos">+0,31 % · 24 h</TextSmall>
        </div>
      }
    >
      <Tabs defaultSelectedKey="carnet">
        <TabList aria-label="Vues du marché">
          <Tab id="carnet">Carnet</Tab>
          <Tab id="graphique">Graphique</Tab>
          <Tab id="transactions">Transactions</Tab>
        </TabList>
        <TabPanel id="carnet">
          <Grid columns="repeat(2, minmax(0, 1fr))" gap="300">
            <div className="book">
              <div className="book-head book-head-2">
                <TextSmall className="t-sec">Qté USDT</TextSmall>
                <TextSmall className="t-sec r" style={{ textAlign: "right" }}>
                  Achat
                </TextSmall>
              </div>
              {BIDS.map(([p, q]) => (
                <div className="book-row book-row-2" key={p}>
                  <span className="book-depth book-depth-bid" style={{ left: "auto", width: depth(q, 15000) }} />
                  <span>{q}</span>
                  <span className="r t-pos">{p}</span>
                </div>
              ))}
            </div>
            <div className="book">
              <div className="book-head book-head-2">
                <TextSmall className="t-sec">Vente</TextSmall>
                <TextSmall className="t-sec" style={{ textAlign: "right" }}>
                  Qté USDT
                </TextSmall>
              </div>
              {ASKS.map(([p, q]) => (
                <div className="book-row book-row-2" key={p}>
                  <span className="book-depth book-depth-ask" style={{ right: "auto", width: depth(q, 12000) }} />
                  <span className="t-neg">{p}</span>
                  <span className="r">{q}</span>
                </div>
              ))}
            </div>
          </Grid>
          <div className="row" style={{ justifyContent: "center", marginTop: "var(--sds-size-space-200)" }}>
            <TextSmall className="t-sec">Écart 0,50 XAFe (0,08 %) · dernier</TextSmall>
            <TextSmall className="t-pos num">618,40 ▲</TextSmall>
          </div>
        </TabPanel>
        <TabPanel id="graphique">
          <Text className="t-sec">Le graphique en chandeliers est sur l'écran ordinateur.</Text>
        </TabPanel>
        <TabPanel id="transactions">
          <Text className="t-sec">Dernières exécutions, heure, prix, quantité.</Text>
        </TabPanel>
      </Tabs>

      <div className="sheet sheet-stroke">
        <Navigation direction="row">
          <NavigationPill isSelected>Acheter USDT</NavigationPill>
          <NavigationPill>Vendre USDT</NavigationPill>
        </Navigation>
        <div className="row">
          <Navigation direction="row">
            <NavigationPill isSelected>Limite</NavigationPill>
            <NavigationPill>Marché</NavigationPill>
          </Navigation>
          <TextSmall className="t-sec num">Dispo 3 250 000 XAFe</TextSmall>
        </div>
        <Grid columns="repeat(2, minmax(0, 1fr))" gap="200">
          <InputField label="Prix (XAFe/USDT)" defaultValue="618,40" inputMode="decimal" />
          <InputField label="Quantité (USDT)" defaultValue="1 500" inputMode="decimal" />
        </Grid>
        <Navigation direction="row">
          <NavigationPill>25 %</NavigationPill>
          <NavigationPill>50 %</NavigationPill>
          <NavigationPill>75 %</NavigationPill>
          <NavigationPill>100 %</NavigationPill>
        </Navigation>
        <Line label="Total" value="927 600 XAFe" strong />
        <Line label="Frais preneur 0,10 %" value="928 XAFe" />
        <Button variant="primary">Acheter 1 500 USDT</Button>
      </div>
    </ClientShell>
  );
}

/* ------------------------------------------------------------- 7 Crypto */

export function Crypto() {
  return (
    <ClientShell title="Crypto" back="/client/portefeuille" active="portefeuille">
      <Tabs defaultSelectedKey="deposer">
        <TabList aria-label="Dépôt ou retrait">
          <Tab id="deposer">Déposer</Tab>
          <Tab id="retirer">Retirer</Tab>
        </TabList>
        <TabPanel id="deposer">
          <Flex direction="column" gap="600">
            <div className="col">
              <TextSmall className="t-sec">Actif</TextSmall>
              <Navigation direction="row">
                <NavigationPill isSelected>USDT</NavigationPill>
                <NavigationPill>XAFe</NavigationPill>
              </Navigation>
            </div>
            <div className="col">
              <TextSmall className="t-sec">Réseau</TextSmall>
              <Navigation direction="row">
                <NavigationPill isSelected>BEP20 · BNB Smart Chain</NavigationPill>
                <NavigationPill>TRC20 · Tron</NavigationPill>
              </Navigation>
              <TextSmall className="t-sec">15 confirmations · environ 45 s</TextSmall>
            </div>

            <Card variant="stroke" padding="600" align="center">
              <svg width="148" height="148" viewBox="0 0 21 21" role="img" aria-label="Code QR de l'adresse (illustration)" shapeRendering="crispEdges" style={{ fill: "var(--sds-color-icon-default-default)" }}>
                <rect x="0" y="0" width="7" height="7" /><rect x="1" y="1" width="5" height="5" style={{ fill: "var(--sds-color-background-default-default)" }} /><rect x="2" y="2" width="3" height="3" />
                <rect x="14" y="0" width="7" height="7" /><rect x="15" y="1" width="5" height="5" style={{ fill: "var(--sds-color-background-default-default)" }} /><rect x="16" y="2" width="3" height="3" />
                <rect x="0" y="14" width="7" height="7" /><rect x="1" y="15" width="5" height="5" style={{ fill: "var(--sds-color-background-default-default)" }} /><rect x="2" y="16" width="3" height="3" />
                <rect x="8" y="0" width="1" height="1" /><rect x="10" y="0" width="2" height="1" /><rect x="8" y="2" width="2" height="1" /><rect x="11" y="2" width="1" height="2" /><rect x="9" y="4" width="1" height="1" /><rect x="8" y="6" width="1" height="1" /><rect x="10" y="6" width="1" height="1" /><rect x="12" y="5" width="1" height="2" />
                <rect x="0" y="8" width="2" height="1" /><rect x="3" y="8" width="1" height="2" /><rect x="5" y="9" width="2" height="1" /><rect x="1" y="10" width="1" height="1" /><rect x="4" y="11" width="2" height="1" /><rect x="0" y="12" width="1" height="1" /><rect x="2" y="12" width="3" height="1" />
                <rect x="8" y="8" width="2" height="2" /><rect x="11" y="8" width="1" height="1" /><rect x="12" y="9" width="2" height="1" /><rect x="9" y="11" width="1" height="2" /><rect x="11" y="11" width="2" height="1" /><rect x="8" y="13" width="1" height="1" /><rect x="10" y="13" width="3" height="1" />
                <rect x="14" y="8" width="1" height="1" /><rect x="16" y="8" width="2" height="1" /><rect x="19" y="8" width="2" height="1" /><rect x="15" y="10" width="1" height="2" /><rect x="17" y="10" width="1" height="1" /><rect x="19" y="10" width="1" height="2" /><rect x="14" y="12" width="2" height="1" /><rect x="18" y="12" width="1" height="1" /><rect x="20" y="13" width="1" height="1" />
                <rect x="8" y="14" width="1" height="2" /><rect x="10" y="15" width="2" height="1" /><rect x="13" y="14" width="1" height="1" /><rect x="15" y="15" width="1" height="1" /><rect x="17" y="14" width="2" height="2" /><rect x="20" y="15" width="1" height="1" />
                <rect x="9" y="17" width="2" height="1" /><rect x="12" y="17" width="1" height="2" /><rect x="14" y="17" width="1" height="1" /><rect x="16" y="18" width="2" height="1" /><rect x="19" y="17" width="1" height="1" /><rect x="8" y="19" width="1" height="2" /><rect x="10" y="20" width="2" height="1" /><rect x="13" y="20" width="2" height="1" /><rect x="16" y="20" width="1" height="1" /><rect x="18" y="19" width="3" height="1" />
              </svg>
              <TextSmall className="t-sec">Votre adresse USDT BEP20</TextSmall>
              <div className="row" style={{ width: "100%" }}>
                <span className="mono grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  0x3fA8c19E2b7D4e5F60a1B2c3D4e5F60a1B2c9C21
                </span>
                <IconButton variant="neutral" aria-label="Copier l'adresse">
                  <IconCopy size="20" />
                </IconButton>
              </div>
            </Card>

            <Notification icon={<IconAlertCircle size="20" />}>
              <Text>Envoyez uniquement de l'USDT sur BNB Smart Chain. Crédit automatique après 15 confirmations.</Text>
            </Notification>

            <div className="sheet">
              <TextStrong>XAFe sur la blockchain</TextStrong>
              <Line label="Contrat BEP20" value={<span className="mono">[ADRESSE APRÈS DÉPLOIEMENT]</span>} />
              <Line label="Contrat TRC20" value={<span className="mono">[ADRESSE APRÈS DÉPLOIEMENT]</span>} />
              <TextSmall className="t-sec">
                Retirez vos XAFe vers votre propre wallet : ils sont frappés à la sortie et détruits au retour. 1 XAFe = 1 XAF, couvert par les XAF détenus sur les floats TOTEM.
              </TextSmall>
            </div>
          </Flex>
        </TabPanel>
        <TabPanel id="retirer">
          <Text className="t-sec">Adresse de destination, réseau, montant, frais réseau, confirmation par code.</Text>
        </TabPanel>
      </Tabs>
    </ClientShell>
  );
}

/* --------------------------------------------------------- 8 Historique */

export function Historique() {
  return (
    <ClientShell
      active="historique"
      title="Historique"
      action={
        <IconButton variant="subtle" aria-label="Exporter en CSV">
          <IconDownload size="24" />
        </IconButton>
      }
    >
      <Navigation direction="row">
        <NavigationPill isSelected>Tout</NavigationPill>
        <NavigationPill>Entrées XAF</NavigationPill>
        <NavigationPill>Sorties XAF</NavigationPill>
        <NavigationPill>Ordres</NavigationPill>
        <NavigationPill>Crypto</NavigationPill>
      </Navigation>

      <TextSmall className="t-sec">AUJOURD'HUI</TextSmall>
      <Histo title="Entrée MTN MoMo" amount="+1 000 000 XAFe" tone="pos" detail="14:02 · crédité par TOTEM (Akwa-1)" reference="XAFe-DP-000418 · MTN 1234567890" />
      <Histo title="Achat 1 500 USDT à 618,20" amount="−927 300 XAFe" detail="13:41 · ordre limite, exécuté en 2 fois" reference="ORD-A-20931 · frais 927" />
      <Histo title="Sortie Orange Money" amount="−500 000 XAFe" tone="warn" detail="en cours · TOTEM compose le transfert" reference="XAFe-WD-000207" />
      <Histo title="Vente 800 USDT à 618,90" amount="+495 120 XAFe" tone="pos" detail="11:08 · ordre limite" reference="ORD-V-20874 · frais 248" />
      <TextSmall className="t-sec">HIER</TextSmall>
      <Histo title="Retrait USDT · BEP20" amount="−2 000 USDT" detail="18:52 · 15 confirmations · frais réseau 0,30" reference="0x8b4e…e4a1" link />
      <Histo title="Dépôt XAFe · BEP20" amount="+250 000 XAFe" tone="pos" detail="16:20 · XAFe détruits sur la chaîne, crédités ici" reference="0x19c7…b2f0" link />
      <Histo title="Entrée MTN MoMo" amount="+3 000 000 XAFe" tone="pos" detail="09:14 · 3 transferts, une référence" reference="XAFe-DP-000391" />
    </ClientShell>
  );
}

function Histo({
  title,
  amount,
  detail,
  reference,
  tone,
  link,
}: {
  title: string;
  amount: string;
  detail: string;
  reference: string;
  tone?: "pos" | "warn";
  link?: boolean;
}) {
  return (
    <div className="sheet">
      <div className="row">
        <TextStrong>{title}</TextStrong>
        <TextStrong className={`num ${tone === "pos" ? "t-pos" : ""}`}>{amount}</TextStrong>
      </div>
      <div className="row">
        <TextSmall className={tone === "warn" ? "t-warn" : "t-sec"}>{detail}</TextSmall>
        <span className="mono t-sec row-start">
          {reference}
          {link && <IconExternalLink size="14" />}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- 9 Compte */

export function Compte() {
  return (
    <ClientShell active="compte" title="Compte" action={<Button variant="subtle" size="small">Se déconnecter</Button>}>
      <Card variant="stroke" padding="600">
        <AvatarBlock title="Nelson S." description="NORTON GAUSS BONZINI SARL · Douala">
          <Avatar initials="NS" size="large" />
        </AvatarBlock>
        <Tag scheme="positive" variant="secondary">
          <IconCheck size="16" /> Palier 2 · Entreprise vérifiée
        </Tag>
      </Card>

      <div className="row">
        <TextSubheading>Paliers et limites</TextSubheading>
        <Tag scheme="warning" variant="secondary">
          montants à fixer
        </Tag>
      </div>
      <Palier n="0" title="Téléphone + e-mail" detail="Entrées et sorties limitées par jour" limit="[LIMITE 0]" />
      <Palier n="1" title="Pièce d'identité + selfie" detail="Plafond relevé, retraits crypto" limit="[LIMITE 1]" />
      <Palier n="2" title="Entreprise (RCCM, bénéficiaires)" detail="Sans plafond plateforme, limites des opérateurs seulement" limit="actif" active />

      <TextSubheading>Numéros MoMo vérifiés</TextSubheading>
      <div className="sheet">
        <div className="row">
          <Tag scheme="neutral" variant="secondary">MTN</Tag>
          <TextStrong className="num grow">6 77 12 34 56</TextStrong>
          <Tag scheme="positive" variant="secondary">vérifié</Tag>
        </div>
        <div className="row">
          <Tag scheme="neutral" variant="secondary">OM</Tag>
          <TextStrong className="num grow">6 99 87 65 43</TextStrong>
          <Tag scheme="positive" variant="secondary">vérifié</Tag>
        </div>
      </div>
      <Button variant="neutral">+ Ajouter un numéro (actif après 24 h)</Button>

      <Flex direction="column" gap="200">
        <Button variant="neutral" href="/client/compte">
          Sécurité : code, clé d'accès, appareils
          <IconChevronRight size="20" />
        </Button>
        <Button variant="neutral" href="/client/compte">
          Accès API (clés, webhooks)
          <IconChevronRight size="20" />
        </Button>
        <Button variant="neutral" href="/admin/reserves">
          <IconRefreshCw size="20" />
          Réserve XAF publiée : 100,46 %
        </Button>
      </Flex>
    </ClientShell>
  );
}

function Palier({
  n,
  title,
  detail,
  limit,
  active,
}: {
  n: string;
  title: string;
  detail: string;
  limit: string;
  active?: boolean;
}) {
  return (
    <div className={`sheet ${active ? "sheet-stroke" : ""}`}>
      <div className="row-start">
        <Avatar initials={n} size="small" />
        <div className="col grow">
          <TextStrong>{title}</TextStrong>
          <TextSmall className="t-sec">{detail}</TextSmall>
        </div>
        {active ? (
          <Tag scheme="positive" variant="secondary">{limit}</Tag>
        ) : (
          <span className="mono t-sec">{limit}</span>
        )}
      </div>
    </div>
  );
}
