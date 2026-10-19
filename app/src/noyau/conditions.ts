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

import { t } from "./langue";

export const VERSION_CONDITIONS = "2026-10-16";

/** Qui édite Glisil. À compléter : raison sociale, immatriculation, adresse. */
export const EDITEUR: { nom: string; forme: string; rccm: string; niu: string; adresse: string } = {
  nom: "Glisil",
  forme: "",
  rccm: "",
  niu: "",
  // un accesseur, pas une valeur : relu dans la langue de l'écran à chaque affichage
  get adresse() { return t("Douala, Cameroun", "Douala, Cameroon"); },
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

/*
 * Les deux textes sont des ACCESSEURS : un objet écrit en dur serait lu une
 * fois, à l'import, dans la langue de ce moment-là. Ici chaque lecture
 * (doc.titre, doc.articles…) se fait dans la langue de l'écran ; l'objet, lui,
 * reste le même (il sert de valeur dans un useState).
 */
export const CONDITIONS: Document = {
  get titre() { return t("Conditions d'utilisation", "Terms of use"); },
  get resume() { return t("Ce que Glisil fait pour vous, ce que vous vous engagez à faire, et ce qui se passe quand quelque chose ne va pas.", "What Glisil does for you, what you agree to do, and what happens when something goes wrong."); },
  get articles(): Article[] {
    return [
      {
        titre: t("1. Glisil et le XAFe", "1. Glisil and XAFe"),
        paragraphes: [
          t("Glisil émet le XAFe, un jeton numérique qui vaut toujours un franc CFA (1 XAFe = 1 XAF), et opère le marché où il s'échange contre l'USDT.",
            "Glisil issues XAFe, a digital token that is always worth one CFA franc (1 XAFe = 1 XAF), and operates the market where it is exchanged for USDT."),
          t("Un XAFe n'est créé que lorsqu'un franc CFA est reçu sur l'un de nos comptes Mobile Money ou bancaires, et il est détruit lorsqu'un franc CFA vous est renvoyé. Les francs reçus sont gardés en réserve, un pour un.",
            "An XAFe is created only when a CFA franc is received in one of our Mobile Money or bank accounts, and it is destroyed when a CFA franc is paid back to you. The francs received are held in reserve, one for one."),
          t("Glisil n'est pas une banque. Les sommes sur votre compte ne produisent pas d'intérêts et ne sont pas couvertes par un fonds de garantie des dépôts.",
            "Glisil is not a bank. Funds in your account do not earn interest and are not covered by a deposit guarantee scheme."),
        ],
      },
      {
        titre: t("2. Votre compte", "2. Your account"),
        paragraphes: [
          t("Il faut avoir 18 ans révolus. Un compte appartient à une seule personne, qui le gère elle-même ; un numéro de téléphone ne sert qu'à un compte.",
            "You must be at least 18 years old. An account belongs to a single person, who manages it personally; a phone number may be used for only one account."),
          t("Vous entrez avec votre adresse e-mail et un code reçu par e-mail. Vos gestes d'argent sont protégés par un code secret de quatre chiffres que vous seul connaissez. Glisil ne vous demandera jamais ce code, ni le code reçu par e-mail, par téléphone, par WhatsApp ou par e-mail.",
            "You sign in with your email address and a code sent to you by email. Your money transactions are protected by a four-digit PIN that only you know. Glisil will never ask you for this PIN, or for the code sent to you by email, whether by phone, on WhatsApp or by email."),
          t("Les informations que vous donnez doivent être exactes et les vôtres. Nous pouvons vous demander de les prouver (pièce d'identité, documents de votre entreprise) pour ouvrir des plafonds plus larges, ou lorsque la loi l'exige.",
            "The information you provide must be accurate and your own. We may ask you to prove it (ID document, your company's documents) to unlock higher limits, or where the law requires it."),
        ],
      },
      {
        titre: t("3. Entrer des XAF", "3. Adding XAF"),
        paragraphes: [
          t("Vous payez l'un de nos numéros Mobile Money (MTN MoMo ou Orange Money) depuis votre téléphone, puis vous tapez le transaction ID de votre SMS. Notre boîtier lit le SMS reçu sur notre numéro ; lorsque les deux correspondent, les XAFe sont crédités sur votre compte.",
            "You pay one of our Mobile Money numbers (MTN MoMo or Orange Money) from your phone, then enter the transaction ID from your SMS. Our device reads the SMS received on our number; when the two match, the XAFe are credited to your account."),
          t("Seul compte le montant que l'opérateur a réellement transféré, tel que le dit son SMS. Un paiement au-delà de votre plafond du jour, ou qui ne peut être rattaché à votre compte, est retenu, puis remboursé par l'équipe sur le numéro qui a payé.",
            "Only the amount the operator actually transferred, as stated in its SMS, counts. A payment that exceeds your daily limit, or that cannot be linked to your account, is held and then refunded by the team to the number that paid."),
        ],
      },
      {
        titre: t("4. Sortir des XAF", "4. Withdrawing XAF"),
        paragraphes: [
          t("Vous pouvez sortir vos XAFe en francs CFA vers un numéro Mobile Money vérifié à votre nom. Un numéro ajouté ne reçoit de sortie que 24 heures après sa vérification : c'est une protection si votre téléphone vous est pris.",
            "You can withdraw your XAFe in CFA francs to a verified Mobile Money number in your name. A newly added number can receive withdrawals only 24 hours after it is verified: this protects you if your phone is taken from you."),
          t("Une sortie coûte les frais affichés avant que vous ne la confirmiez avec votre code secret. Si l'opérateur refuse le transfert après plusieurs essais, les XAFe correspondants reviennent sur votre compte.",
            "A withdrawal costs the fees shown before you confirm it with your PIN. If the operator rejects the transfer after several attempts, the corresponding XAFe are returned to your account."),
        ],
      },
      {
        titre: t("5. Le marché et la crypto", "5. The market and crypto"),
        paragraphes: [
          t("Sur le marché, vos ordres rencontrent ceux des autres clients, au même prix affiché pour tous. Un ordre exécuté ne s'annule pas. Le prix de l'USDT varie : vous pouvez perdre de la valeur en achetant ou en vendant.",
            "On the market, your orders are matched with those of other customers, at the same price shown to everyone. An executed order cannot be cancelled. The price of USDT fluctuates: you may lose value when buying or selling."),
          t("Vous pouvez déposer et retirer des USDT, et retirer vos XAFe, sur les réseaux indiqués (BEP20, TRC20). Une adresse erronée ou un mauvais réseau peut faire perdre les fonds définitivement : vérifiez toujours l'adresse et le réseau avant de confirmer. Un envoi confirmé sur la blockchain ne peut pas être annulé.",
            "You can deposit and withdraw USDT, and withdraw your XAFe, on the networks indicated (BEP20, TRC20). An incorrect address or the wrong network can cause the permanent loss of funds: always check the address and the network before confirming. A transfer confirmed on the blockchain cannot be reversed."),
        ],
      },
      {
        titre: t("6. Plafonds et vérifications", "6. Limits and checks"),
        paragraphes: [
          t("Chaque palier a ses plafonds par jour, affichés dans Compte → Paliers et limites. Glisil peut demander des justificatifs, retenir une opération le temps de la vérifier, ou refuser une opération qui paraît frauduleuse ou contraire à la loi, notamment à la lutte contre le blanchiment d'argent et le financement du terrorisme.",
            "Each tier has its own daily limits, shown in Account → Tiers and limits. Glisil may request supporting documents, hold a transaction while it is being checked, or refuse a transaction that appears fraudulent or unlawful, in particular under anti-money laundering and counter-terrorist financing rules."),
        ],
      },
      {
        titre: t("7. Frais", "7. Fees"),
        paragraphes: [
          t("Les frais en vigueur sont affichés avant chaque opération et dans l'Aide. Les frais facturés par votre opérateur Mobile Money pour payer nos numéros restent à votre charge.",
            "The fees in force are shown before each transaction and in Help. Any fees charged by your Mobile Money operator for paying our numbers remain your responsibility."),
        ],
      },
      {
        titre: t("8. Ce qui ne va pas", "8. When something goes wrong"),
        paragraphes: [
          t("Si une opération vous semble fausse, écrivez au support avec sa référence (XAFe-…), visible dans l'Historique. Nous répondons et corrigeons ce qui doit l'être.",
            "If a transaction looks wrong to you, contact support with its reference (XAFe-…), shown in History. We will respond and correct whatever needs to be corrected."),
          t("Glisil répond des erreurs de son service. Il ne répond pas des pannes des réseaux des opérateurs ou des blockchains, ni des conséquences d'un code secret que vous auriez communiqué à quelqu'un.",
            "Glisil is liable for errors in its own service. It is not liable for outages of operator networks or blockchains, nor for the consequences of a PIN you have shared with anyone."),
        ],
      },
      {
        titre: t("9. Fermer votre compte", "9. Closing your account"),
        paragraphes: [
          t("Vous pouvez fermer votre compte à tout moment dans Compte → Fermer mon compte, une fois votre argent sorti et vos opérations terminées. Glisil peut suspendre ou fermer un compte qui ne respecte pas ces conditions ; l'argent qui vous appartient vous est alors rendu, sauf décision d'une autorité.",
            "You can close your account at any time in Account → Close my account, once your money has been withdrawn and your transactions are complete. Glisil may suspend or close an account that does not comply with these terms; any money that belongs to you is then returned to you, unless an authority decides otherwise."),
        ],
      },
      {
        titre: t("10. Changements", "10. Changes"),
        paragraphes: [
          t("Ces conditions peuvent évoluer. Vous serez prévenu dans l'application et vous devrez accepter la nouvelle version pour continuer.",
            "These terms may change. You will be notified in the app and will need to accept the new version to continue."),
          t("Elles sont régies par le droit camerounais.", "They are governed by Cameroonian law."),
        ],
      },
    ];
  },
};

export const CONFIDENTIALITE: Document = {
  get titre() { return t("Politique de confidentialité", "Privacy policy"); },
  get resume() { return t("Ce que nous savons de vous, pourquoi, où c'est gardé, combien de temps, et ce que vous pouvez demander.", "What we know about you, why, where it is stored, for how long, and what you can request."); },
  get articles(): Article[] {
    return [
      {
        titre: t("1. Ce que nous recueillons", "1. What we collect"),
        paragraphes: [
          t("À l'inscription : votre adresse e-mail, vos prénom et nom, votre date de naissance, votre numéro de téléphone, votre ville et votre pays de résidence.",
            "When you sign up: your email address, your first and last name, your date of birth, your phone number, and your city and country of residence."),
          t("Pour vos opérations : vos numéros Mobile Money, les transaction ID que vous tapez, les SMS de paiement reçus sur NOS numéros (montant, numéro qui a payé, référence de l'opérateur), vos ordres, vos adresses de dépôt crypto et les adresses vers lesquelles vous retirez.",
            "For your transactions: your Mobile Money numbers, the transaction IDs you enter, the payment SMS messages received on OUR numbers (amount, paying number, operator reference), your orders, your crypto deposit addresses and the addresses you withdraw to."),
          t("Si vous demandez un palier plus élevé : les photos de votre pièce d'identité, un selfie, et pour une entreprise ses documents (RCCM, NIU, pièce du gérant).",
            "If you request a higher tier: photos of your ID document, a selfie and, for a company, its documents (RCCM, NIU, manager's ID document)."),
          t("Pour la sécurité : vos dates de connexion. Votre code secret n'est jamais gardé en clair : seule une empreinte qui ne permet pas de le retrouver l'est.",
            "For security: the dates you signed in. Your PIN is never stored in plain text: only a hash that cannot be used to recover it is stored."),
        ],
      },
      {
        titre: t("2. Pourquoi", "2. Why"),
        paragraphes: [
          t("Pour faire fonctionner votre compte et vos opérations ; pour vérifier votre identité et respecter nos obligations légales (lutte contre le blanchiment et la fraude) ; pour vous prévenir de ce qui se passe sur votre compte ; pour répondre à vos demandes au support.",
            "To operate your account and your transactions; to verify your identity and meet our legal obligations (prevention of money laundering and fraud); to inform you of what happens on your account; to respond to your support requests."),
          t("Nous ne vendons pas vos données, et nous ne nous en servons pas pour de la publicité.",
            "We do not sell your data, and we do not use it for advertising."),
        ],
      },
      {
        titre: t("3. Qui les voit", "3. Who sees it"),
        paragraphes: [
          t("L'équipe de Glisil, selon son rôle, et seulement ce dont elle a besoin. Nos prestataires techniques, qui les traitent pour notre compte : Supabase (la base de données, hébergée dans l'Union européenne, en Irlande), Vercel (l'hébergement des applications) et Resend (l'envoi des e-mails).",
            "The Glisil team, according to each member's role, and only what they need. Our technical service providers, who process it on our behalf: Supabase (the database, hosted in the European Union, in Ireland), Vercel (application hosting) and Resend (email delivery)."),
          t("Les autorités, lorsque la loi nous y oblige.", "The authorities, when the law requires us to share it."),
        ],
      },
      {
        titre: t("4. Combien de temps", "4. How long"),
        paragraphes: [
          t("Tant que votre compte est ouvert. Après sa fermeture, les traces de vos opérations et de votre identité sont gardées le temps qu'impose la loi sur la lutte contre le blanchiment (en général dix ans), puis effacées. C'est pourquoi fermer un compte ne l'efface pas tout de suite.",
            "For as long as your account is open. After it is closed, records of your transactions and your identity are kept for the period required by anti-money laundering law (generally ten years), then deleted. This is why closing an account does not delete it right away."),
        ],
      },
      {
        titre: t("5. Vos droits", "5. Your rights"),
        paragraphes: [
          t("Vous pouvez demander à voir les données que nous avons sur vous, à corriger ce qui est faux, et, dans les limites de nos obligations légales, à les effacer. Écrivez au support : nous répondons sous trente jours.",
            "You can ask to see the data we hold about you, to correct anything that is inaccurate and, within the limits of our legal obligations, to have it deleted. Contact support: we respond within thirty days."),
          t("Vous pouvez aussi vous adresser à l'autorité de protection des données de votre pays.",
            "You may also contact the data protection authority in your country."),
        ],
      },
      {
        titre: t("6. Sécurité", "6. Security"),
        paragraphes: [
          t("Les échanges avec Glisil sont chiffrés. Chaque client ne peut lire que ses propres données, et cette règle est tenue par la base elle-même. Les pièces d'identité sont rangées dans un espace privé que seule l'équipe chargée des vérifications peut ouvrir.",
            "All communication with Glisil is encrypted. Each customer can read only their own data, and this rule is enforced by the database itself. ID documents are stored in a private space that only the team in charge of verifications can open."),
        ],
      },
    ];
  },
};
