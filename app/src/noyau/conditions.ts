/*
 * Les conditions d'utilisation, la politique de confidentialité, et le contact
 * du support. Un seul endroit pour les trois.
 *
 * LA VERSION se change ICI et dans la base (paramètre « conditions », page
 * Paramètres de l'administration) en même temps : la base refuse d'ouvrir un
 * compte sur une autre version, et un client dont la version acceptée n'est
 * plus celle en vigueur la relit et l'accepte à sa prochaine ouverture.
 *
 * Ces textes décrivent ce que Glisil FAIT, tel que le code le fait. Ils sont un
 * premier jet à faire relire par un juriste avant l'ouverture au public ; les
 * informations sur la société (EDITEUR) se remplissent quand elles existent —
 * une ligne vide ne s'affiche pas, plutôt qu'un bouche-trou.
 */

export const VERSION_CONDITIONS = "2026-10-16";

/** Qui édite Glisil. À compléter : raison sociale, immatriculation, adresse. */
export const EDITEUR: { nom: string; forme: string; rccm: string; niu: string; adresse: string } = {
  nom: "Glisil",
  forme: "",
  rccm: "",
  niu: "",
  adresse: "Douala, Cameroun",
};

/**
 * Le support. L'équipe le règle dans l'administration (paramètre « support ») ;
 * à défaut, la configuration de l'application (VITE_SUPPORT_WHATSAPP).
 * WhatsApp : des chiffres avec l'indicatif, sans « + » (237677123456).
 */
export const SUPPORT: { email: string | null; whatsapp: string | null } = {
  email: "support@glisil.com",
  whatsapp: /^\d{11,15}$/.test(String(import.meta.env?.VITE_SUPPORT_WHATSAPP ?? "")) ? String(import.meta.env.VITE_SUPPORT_WHATSAPP) : null,
};

/** Pose le support lu dans la base ; une valeur mal formée laisse l'ancienne. */
export function appliquerSupport(p: unknown): void {
  if (!p || typeof p !== "object") return;
  const s = (p as { support?: { email?: unknown; whatsapp?: unknown } }).support;
  if (!s || typeof s !== "object") return;
  if (typeof s.email === "string" && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s.email)) SUPPORT.email = s.email;
  if (typeof s.whatsapp === "string" && /^\+?\d{11,15}$/.test(s.whatsapp)) SUPPORT.whatsapp = s.whatsapp.replace(/^\+/, "");
}

export function lienWhatsapp(texte: string): string | null {
  return SUPPORT.whatsapp ? `https://wa.me/${SUPPORT.whatsapp}?text=${encodeURIComponent(texte)}` : null;
}

export function lienEmail(sujet: string, corps = ""): string | null {
  return SUPPORT.email ? `mailto:${SUPPORT.email}?subject=${encodeURIComponent(sujet)}${corps ? `&body=${encodeURIComponent(corps)}` : ""}` : null;
}

/* ---------------------------------------------------------------- textes */

export type Article = { titre: string; paragraphes: string[] };
export type Document = { titre: string; resume: string; articles: Article[] };

export const CONDITIONS: Document = {
  titre: "Conditions d'utilisation",
  resume: "Ce que Glisil fait pour vous, ce que vous vous engagez à faire, et ce qui se passe quand quelque chose ne va pas.",
  articles: [
    {
      titre: "1. Glisil et le XAFe",
      paragraphes: [
        "Glisil émet le XAFe, un jeton numérique qui vaut toujours un franc CFA (1 XAFe = 1 XAF), et opère le marché où il s'échange contre l'USDT.",
        "Un XAFe n'est créé que lorsqu'un franc CFA est reçu sur l'un de nos comptes Mobile Money ou bancaires, et il est détruit lorsqu'un franc CFA vous est renvoyé. Les francs reçus sont gardés en réserve, un pour un.",
        "Glisil n'est pas une banque. Les sommes sur votre compte ne produisent pas d'intérêts et ne sont pas couvertes par un fonds de garantie des dépôts.",
      ],
    },
    {
      titre: "2. Votre compte",
      paragraphes: [
        "Il faut avoir 18 ans révolus. Un compte appartient à une seule personne, qui le gère elle-même ; un numéro de téléphone ne sert qu'à un compte.",
        "Vous entrez avec votre adresse e-mail et un code reçu par e-mail. Vos gestes d'argent sont protégés par un code secret de quatre chiffres que vous seul connaissez. Glisil ne vous demandera jamais ce code, ni le code reçu par e-mail, par téléphone, par WhatsApp ou par e-mail.",
        "Les informations que vous donnez doivent être exactes et les vôtres. Nous pouvons vous demander de les prouver (pièce d'identité, documents de votre entreprise) pour ouvrir des plafonds plus larges, ou lorsque la loi l'exige.",
      ],
    },
    {
      titre: "3. Entrer des XAF",
      paragraphes: [
        "Vous payez l'un de nos numéros Mobile Money (MTN MoMo ou Orange Money) depuis votre téléphone, puis vous tapez le transaction ID de votre SMS. Notre boîtier lit le SMS reçu sur notre numéro ; lorsque les deux correspondent, les XAFe sont crédités sur votre compte.",
        "Seul compte le montant que l'opérateur a réellement transféré, tel que le dit son SMS. Un paiement au-delà de votre plafond du jour, ou qui ne peut être rattaché à votre compte, est retenu, puis remboursé par l'équipe sur le numéro qui a payé.",
      ],
    },
    {
      titre: "4. Sortir des XAF",
      paragraphes: [
        "Vous pouvez sortir vos XAFe en francs CFA vers un numéro Mobile Money vérifié à votre nom. Un numéro ajouté ne reçoit de sortie que 24 heures après sa vérification : c'est une protection si votre téléphone vous est pris.",
        "Une sortie coûte les frais affichés avant que vous ne la confirmiez avec votre code secret. Si l'opérateur refuse le transfert après plusieurs essais, les XAFe correspondants reviennent sur votre compte.",
      ],
    },
    {
      titre: "5. Le marché et la crypto",
      paragraphes: [
        "Sur le marché, vos ordres rencontrent ceux des autres clients, au même prix affiché pour tous. Un ordre exécuté ne s'annule pas. Le prix de l'USDT varie : vous pouvez perdre de la valeur en achetant ou en vendant.",
        "Vous pouvez déposer et retirer des USDT, et retirer vos XAFe, sur les réseaux indiqués (BEP20, TRC20). Une adresse erronée ou un mauvais réseau peut faire perdre les fonds définitivement : vérifiez toujours l'adresse et le réseau avant de confirmer. Un envoi confirmé sur la blockchain ne peut pas être annulé.",
      ],
    },
    {
      titre: "6. Plafonds et vérifications",
      paragraphes: [
        "Chaque palier a ses plafonds par jour, affichés dans Compte → Paliers et limites. Glisil peut demander des justificatifs, retenir une opération le temps de la vérifier, ou refuser une opération qui paraît frauduleuse ou contraire à la loi, notamment à la lutte contre le blanchiment d'argent et le financement du terrorisme.",
      ],
    },
    {
      titre: "7. Frais",
      paragraphes: [
        "Les frais en vigueur sont affichés avant chaque opération et dans l'Aide. Les frais facturés par votre opérateur Mobile Money pour payer nos numéros restent à votre charge.",
      ],
    },
    {
      titre: "8. Ce qui ne va pas",
      paragraphes: [
        "Si une opération vous semble fausse, écrivez au support avec sa référence (XAFe-…), visible dans l'Historique. Nous répondons et corrigeons ce qui doit l'être.",
        "Glisil répond des erreurs de son service. Il ne répond pas des pannes des réseaux des opérateurs ou des blockchains, ni des conséquences d'un code secret que vous auriez communiqué à quelqu'un.",
      ],
    },
    {
      titre: "9. Fermer votre compte",
      paragraphes: [
        "Vous pouvez fermer votre compte à tout moment dans Compte → Fermer mon compte, une fois votre argent sorti et vos opérations terminées. Glisil peut suspendre ou fermer un compte qui ne respecte pas ces conditions ; l'argent qui vous appartient vous est alors rendu, sauf décision d'une autorité.",
      ],
    },
    {
      titre: "10. Changements",
      paragraphes: [
        "Ces conditions peuvent évoluer. Vous serez prévenu dans l'application et vous devrez accepter la nouvelle version pour continuer.",
        "Elles sont régies par le droit camerounais.",
      ],
    },
  ],
};

export const CONFIDENTIALITE: Document = {
  titre: "Politique de confidentialité",
  resume: "Ce que nous savons de vous, pourquoi, où c'est gardé, combien de temps, et ce que vous pouvez demander.",
  articles: [
    {
      titre: "1. Ce que nous recueillons",
      paragraphes: [
        "À l'inscription : votre adresse e-mail, vos prénom et nom, votre date de naissance, votre numéro de téléphone, votre ville et votre pays de résidence.",
        "Pour vos opérations : vos numéros Mobile Money, les transaction ID que vous tapez, les SMS de paiement reçus sur NOS numéros (montant, numéro qui a payé, référence de l'opérateur), vos ordres, vos adresses de dépôt crypto et les adresses vers lesquelles vous retirez.",
        "Si vous demandez un palier plus élevé : les photos de votre pièce d'identité, un selfie, et pour une entreprise ses documents (RCCM, NIU, pièce du gérant).",
        "Pour la sécurité : vos dates de connexion. Votre code secret n'est jamais gardé en clair : seule une empreinte qui ne permet pas de le retrouver l'est.",
      ],
    },
    {
      titre: "2. Pourquoi",
      paragraphes: [
        "Pour faire fonctionner votre compte et vos opérations ; pour vérifier votre identité et respecter nos obligations légales (lutte contre le blanchiment et la fraude) ; pour vous prévenir de ce qui se passe sur votre compte ; pour répondre à vos demandes au support.",
        "Nous ne vendons pas vos données, et nous ne nous en servons pas pour de la publicité.",
      ],
    },
    {
      titre: "3. Qui les voit",
      paragraphes: [
        "L'équipe de Glisil, selon son rôle, et seulement ce dont elle a besoin. Nos prestataires techniques, qui les traitent pour notre compte : Supabase (la base de données, hébergée dans l'Union européenne, en Irlande), Vercel (l'hébergement des applications) et Resend (l'envoi des e-mails).",
        "Les autorités, lorsque la loi nous y oblige.",
      ],
    },
    {
      titre: "4. Combien de temps",
      paragraphes: [
        "Tant que votre compte est ouvert. Après sa fermeture, les traces de vos opérations et de votre identité sont gardées le temps qu'impose la loi sur la lutte contre le blanchiment (en général dix ans), puis effacées. C'est pourquoi fermer un compte ne l'efface pas tout de suite.",
      ],
    },
    {
      titre: "5. Vos droits",
      paragraphes: [
        "Vous pouvez demander à voir les données que nous avons sur vous, à corriger ce qui est faux, et, dans les limites de nos obligations légales, à les effacer. Écrivez au support : nous répondons sous trente jours.",
        "Vous pouvez aussi vous adresser à l'autorité de protection des données de votre pays.",
      ],
    },
    {
      titre: "6. Sécurité",
      paragraphes: [
        "Les échanges avec Glisil sont chiffrés. Chaque client ne peut lire que ses propres données, et cette règle est tenue par la base elle-même. Les pièces d'identité sont rangées dans un espace privé que seule l'équipe chargée des vérifications peut ouvrir.",
      ],
    },
  ],
};
