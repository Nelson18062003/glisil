// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * XAFe · le franc CFA sur la chaîne. 1 XAFe = 1 XAF.
 *
 * Un XAFe n'existe sur la chaîne que lorsqu'un client sort ses XAFe de la
 * plateforme vers son propre wallet : la plateforme le FRAPPE alors, avec la
 * référence du retrait (XAFe-CR-000012) — une référence ne frappe qu'une fois.
 * Quand des XAFe reviennent (envoyés à l'adresse de dépôt du client), la
 * plateforme les DÉTRUIT et recrédite le compte. La circulation sur la chaîne
 * est donc toujours une part des XAFe de la plateforme, eux-mêmes couverts
 * un pour un par les floats MoMo et les comptes en banque.
 *
 *  - LA RÉSERVE VIT DANS LE CONTRAT (address(this)). Chaque XAFe crédité dans
 *    un compte Glisil y est frappé (frapperReserve) ; chaque XAFe qui en sort
 *    y est détruit (detruireReserve). Elle ne se transfère pas : un XAFe de la
 *    réserve ne quitte le contrat qu'en étant brûlé, et rien n'y entre par
 *    transfert. Une clé chaude volée ne peut donc pas l'emporter — avant, la
 *    réserve dormait sur le wallet chaud, et un seul transfert la vidait.
 *  - ERC-20, six décimales (1 XAF = 1 000 000 unités), comme l'USDT.
 *  - Rôles : ADMIN, FRAPPEUR et DESTRUCTEUR (le signataire de la plateforme),
 *    GELEUR (conformité), PAUSEUR, INSCRIPTEUR. Le constructeur les pose tous
 *    d'un coup ; l'ADMIN (un wallet matériel) ne reçoit QUE le rôle
 *    d'administrer. Il se transmet en deux temps, avec un délai
 *    (AccessControlDefaultAdminRules) : un clic de travers ou une clé volée ne
 *    le cède pas d'un coup, et il ne s'abandonne pas sans préavis.
 *  - Les XAFe qui reviennent arrivent sur l'adresse de dépôt PROPRE à chaque
 *    client. L'ADMIN inscrit ces adresses (ou l'INSCRIPTEUR, d'avance : des
 *    adresses NEUVES seulement, sans jamais en retirer — une clé de mise en
 *    service qui y renonce ensuite) ; le DESTRUCTEUR brûle ce qui y arrive
 *    (detruireDepot), et nulle part ailleurs : jamais le wallet d'un client.
 *  - Pause : plus rien ne bouge, le temps de comprendre. Un PAUSEUR arrête ;
 *    seul l'ADMIN reprend — un rôle qui ne sait qu'arrêter se confie sans
 *    crainte.
 *  - Gel d'une adresse : elle ne peut plus ni envoyer ni recevoir — ce que
 *    la conformité (COBAC, COSUMAF) peut exiger d'un émetteur. La réserve ne
 *    se gèle pas (ce serait une pause hors du PAUSEUR, et sa destruction).
 *  - Chaque frappe et chaque destruction porte sa référence : la chaîne et
 *    le grand livre de la plateforme se rapprochent ligne à ligne.
 *  - Un plafond de frappe par jour VERS L'EXTÉRIEUR : la clé du FRAPPEUR vit
 *    sur un serveur, et une clé volée ne doit pas pouvoir frapper sans limite
 *    vers un wallet. Au-delà, il faut l'ADMIN pour relever le plafond. La
 *    réserve n'y compte pas : ce qui y est frappé ne peut pas en sortir.
 *  - Ce qu'une clé volée a frappé se reprend : l'ADMIN gèle les adresses qui
 *    l'ont reçu, puis détruit leurs fonds gelés.
 *
 *  Il n'y a PAS de voie pour qu'un client « rende » ses XAFe en les brûlant
 *  lui-même : un XAFe revient en l'envoyant à son adresse de dépôt, que le
 *  moteur connaît. Une destruction contre une référence que le moteur ne sait
 *  pas lire détruisait l'argent sans recrédit possible.
 */
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract XAFe is ERC20, AccessControlDefaultAdminRules, Pausable {
    /// Le délai d'une transmission du rôle d'ADMIN : de quoi voir passer une transmission non voulue.
    uint48 public constant DELAI_ADMIN = 2 days;
    bytes32 public constant FRAPPEUR_ROLE = keccak256("FRAPPEUR_ROLE");
    bytes32 public constant DESTRUCTEUR_ROLE = keccak256("DESTRUCTEUR_ROLE");
    bytes32 public constant GELEUR_ROLE = keccak256("GELEUR_ROLE");
    bytes32 public constant PAUSEUR_ROLE = keccak256("PAUSEUR_ROLE");
    /// Inscrire d'avance des adresses de dépôt NEUVES, sans jamais en retirer.
    bytes32 public constant INSCRIPTEUR_ROLE = keccak256("INSCRIPTEUR_ROLE");

    /// Une référence de frappe ne frappe qu'une fois — en réserve comme chez un client.
    mapping(bytes32 => bool) public referenceUtilisee;
    /// Les adresses gelées : ni envoi, ni réception.
    mapping(address => bool) public gele;
    /// Ce qui peut se frapper en un jour (en unités) VERS L'EXTÉRIEUR — la réserve n'y compte pas.
    uint256 public plafondJour;
    /// Ce qui a été frappé vers l'extérieur, par jour (block.timestamp / 1 jour).
    mapping(uint256 => uint256) public frappeLeJour;
    /// Les adresses de dépôt de la plateforme (une par client).
    mapping(address => bool) public estAdresseDeDepot;
    /** une destruction se rapproche du grand livre par SA référence : une seule fois, comme une frappe */
    mapping(bytes32 => bool) public destructionReferencee;
    /// Vrai le temps d'une destruction de fonds gelés : le gel ne bloque pas sa propre reprise.
    bool private _reprise;

    event Frappe(address indexed vers, uint256 montant, bytes32 indexed empreinte);
    event Detruit(address indexed depuis, uint256 montant, bytes32 indexed empreinte);
    event FondsGelesDetruits(address indexed adresse, uint256 montant, bytes32 indexed empreinte);
    event PlafondJour(uint256 plafond);
    event AdresseDeDepot(address indexed adresse, bool inscrite);
    event Gele(address indexed adresse, string motif);
    event Degele(address indexed adresse);

    error ReferenceDejaUtilisee(bytes32 empreinte);
    error ReferenceVide();
    error MontantNul();
    error AdresseGelee(address adresse);
    error AdresseNonGelee(address adresse);
    error PlafondJourAtteint(uint256 dejaFrappe, uint256 montant, uint256 plafond);
    error PasUneAdresseDeDepot(address adresse);
    error AdresseNulle();
    /// Rien n'entre dans la réserve par transfert : elle ne se remplit que par frapperReserve.
    error VersLaReserve();
    /// Rien ne sort de la réserve autrement qu'en étant brûlé.
    error ReserveIntransferable();
    /// La réserve n'est ni un wallet de client, ni une adresse de dépôt, ni gelable.
    error AdresseDeLaReserve();
    /// L'INSCRIPTEUR n'inscrit que des adresses neuves : une adresse qui porte déjà des XAFe n'en est pas une.
    error AdresseDejaPortee(address adresse);

    /**
     * Tous les rôles d'un coup : il n'y a pas de fenêtre où l'ADMIN serait une
     * clé de déploiement. Une adresse nulle ne reçoit rien.
     */
    constructor(address admin, uint256 plafond, address frappeur, address destructeur, address pauseur, address geleur, address inscripteur)
        ERC20("XAFe", "XAFe") AccessControlDefaultAdminRules(DELAI_ADMIN, admin)
    {
        plafondJour = plafond;
        emit PlafondJour(plafond);
        if (frappeur != address(0)) _grantRole(FRAPPEUR_ROLE, frappeur);
        if (destructeur != address(0)) _grantRole(DESTRUCTEUR_ROLE, destructeur);
        if (pauseur != address(0)) _grantRole(PAUSEUR_ROLE, pauseur);
        if (geleur != address(0)) _grantRole(GELEUR_ROLE, geleur);
        if (inscripteur != address(0)) _grantRole(INSCRIPTEUR_ROLE, inscripteur);
    }

    /// Relever (ou baisser) le plafond de frappe : l'ADMIN seul, jamais le FRAPPEUR. Effet immédiat.
    function fixerPlafondJour(uint256 plafond) external onlyRole(DEFAULT_ADMIN_ROLE) {
        plafondJour = plafond;
        emit PlafondJour(plafond);
    }

    /// Six décimales : 1 XAF = 1 000 000 unités.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /**
     * La plateforme frappe des XAFe pour un retrait vers un wallet externe.
     * @param vers       le wallet du client
     * @param montant    en unités (1 XAF = 1e6)
     * @param empreinte  keccak256 de la référence du retrait (XAFe-CR-…) : unique
     */
    function frapper(address vers, uint256 montant, bytes32 empreinte) external onlyRole(FRAPPEUR_ROLE) whenNotPaused {
        if (empreinte == bytes32(0)) revert ReferenceVide();
        if (montant == 0) revert MontantNul();
        if (vers == address(this)) revert AdresseDeLaReserve();
        if (referenceUtilisee[empreinte]) revert ReferenceDejaUtilisee(empreinte);
        uint256 jour = block.timestamp / 1 days;
        uint256 deja = frappeLeJour[jour];
        if (deja + montant > plafondJour) revert PlafondJourAtteint(deja, montant, plafondJour);
        frappeLeJour[jour] = deja + montant;
        referenceUtilisee[empreinte] = true;
        _mint(vers, montant);
        emit Frappe(vers, montant, empreinte);
    }

    /**
     * La réserve reçoit les XAFe crédités dans les comptes Glisil (un dépôt
     * MoMo, un retour de la chaîne). Sans plafond : ce qui est frappé ici ne
     * peut pas sortir du contrat, et une frappe que le grand livre n'explique
     * pas lève l'alarme de la parité.
     */
    function frapperReserve(uint256 montant, bytes32 empreinte) external onlyRole(FRAPPEUR_ROLE) whenNotPaused {
        if (empreinte == bytes32(0)) revert ReferenceVide();
        if (montant == 0) revert MontantNul();
        if (referenceUtilisee[empreinte]) revert ReferenceDejaUtilisee(empreinte);
        referenceUtilisee[empreinte] = true;
        _mint(address(this), montant);
        emit Frappe(address(this), montant, empreinte);
    }

    /**
     * Des XAFe quittent les comptes Glisil (un remboursement MoMo, une sortie
     * vers un wallet frappée ailleurs) : la réserve les brûle. Jamais plus
     * qu'elle ne tient.
     */
    function detruireReserve(uint256 montant, bytes32 empreinte) external onlyRole(DESTRUCTEUR_ROLE) whenNotPaused {
        if (montant == 0) revert MontantNul();
        _referencer(empreinte);
        _burn(address(this), montant);
        emit Detruit(address(this), montant, empreinte);
    }

    /// Ce que la réserve tient.
    function reserve() external view returns (uint256) {
        return balanceOf(address(this));
    }

    /// Ce qui peut encore se frapper vers l'extérieur aujourd'hui : un retrait qui n'y tient pas attend.
    function resteDuJour() external view returns (uint256) {
        uint256 d = frappeLeJour[block.timestamp / 1 days];
        return d >= plafondJour ? 0 : plafondJour - d;
    }

    /** Une destruction sans référence, ou deux sous la même, ne se rapprocheraient de rien. */
    function _referencer(bytes32 empreinte) private {
        if (empreinte == bytes32(0)) revert ReferenceVide();
        if (destructionReferencee[empreinte]) revert ReferenceDejaUtilisee(empreinte);
        destructionReferencee[empreinte] = true;
    }

    /** L'ADMIN inscrit (ou retire) les adresses de dépôt que le moteur a préparées. */
    function inscrireAdressesDeDepot(address[] calldata adresses, bool inscrites) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint256 i = 0; i < adresses.length; i++) {
            address a = adresses[i];
            if (a == address(0)) revert AdresseNulle();
            if (a == address(this)) revert AdresseDeLaReserve();
            estAdresseDeDepot[a] = inscrites;
            emit AdresseDeDepot(a, inscrites);
        }
    }

    /**
     * L'INSCRIPTEUR inscrit d'avance un stock d'adresses de dépôt NEUVES (dérivées,
     * jamais servies). Il ne retire rien, et refuse une adresse qui porte déjà
     * des XAFe : une clé volée ne transforme pas le wallet d'un client en
     * adresse de dépôt (dont le DESTRUCTEUR brûlerait le contenu).
     */
    function inscrireAdressesNeuves(address[] calldata adresses) external onlyRole(INSCRIPTEUR_ROLE) {
        for (uint256 i = 0; i < adresses.length; i++) {
            address a = adresses[i];
            if (a == address(0)) revert AdresseNulle();
            if (a == address(this)) revert AdresseDeLaReserve();
            if (balanceOf(a) != 0) revert AdresseDejaPortee(a);
            if (!estAdresseDeDepot[a]) {
                estAdresseDeDepot[a] = true;
                emit AdresseDeDepot(a, true);
            }
        }
    }

    /**
     * Les XAFe revenus sur l'adresse de dépôt d'un client sont détruits LÀ,
     * sans balayage (une transaction et du gaz par retour) ni clé privilégiée
     * par adresse. Le compte du client est recrédité par le moteur
     * (crediter_crypto), avec la même empreinte.
     */
    function detruireDepot(address adresse, uint256 montant, bytes32 empreinte) external onlyRole(DESTRUCTEUR_ROLE) whenNotPaused {
        if (!estAdresseDeDepot[adresse]) revert PasUneAdresseDeDepot(adresse);
        if (montant == 0) revert MontantNul();
        _referencer(empreinte);
        _burn(adresse, montant);
        emit Detruit(adresse, montant, empreinte);
    }

    /* ---------------------------------------------------- conformité */

    function geler(address adresse, string calldata motif) external onlyRole(GELEUR_ROLE) {
        // geler l'adresse zéro arrêtait toute frappe et toute destruction : une pause, hors du rôle PAUSEUR
        if (adresse == address(0)) revert AdresseNulle();
        // geler la réserve aussi — et detruireFondsGeles l'aurait effacée
        if (adresse == address(this)) revert AdresseDeLaReserve();
        gele[adresse] = true;
        emit Gele(adresse, motif);
    }

    function degeler(address adresse) external onlyRole(GELEUR_ROLE) {
        gele[adresse] = false;
        emit Degele(adresse);
    }

    /**
     * Reprendre ce qu'une clé volée a frappé, ou ce qu'une autorité a saisi :
     * l'adresse doit d'abord être gelée (un geste séparé, qui se voit), puis
     * l'ADMIN détruit tout son solde. L'empreinte dit pourquoi (la décision,
     * l'incident) et se rapproche du grand livre comme une frappe.
     */
    function detruireFondsGeles(address adresse, bytes32 empreinte) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        if (!gele[adresse]) revert AdresseNonGelee(adresse);
        if (empreinte == bytes32(0)) revert ReferenceVide();
        uint256 montant = balanceOf(adresse);
        if (montant == 0) revert MontantNul();
        _reprise = true;
        _burn(adresse, montant);
        _reprise = false;
        emit FondsGelesDetruits(adresse, montant, empreinte);
    }

    function pauser() external onlyRole(PAUSEUR_ROLE) {
        _pause();
    }

    /// Seul l'ADMIN reprend : un PAUSEUR (même volé) ne fait qu'arrêter.
    function reprendre() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * Tout mouvement passe ici (OpenZeppelin 5) : frappe, transfert,
     * destruction. En pause, rien ne bouge ; une adresse gelée ne bouge pas ;
     * la réserve ne se remplit et ne se vide que par frappe et destruction.
     */
    function _update(address depuis, address vers, uint256 montant) internal override whenNotPaused {
        if (!_reprise) {
            if (gele[depuis]) revert AdresseGelee(depuis);
            if (gele[vers]) revert AdresseGelee(vers);
            // une adresse gelée ne dépense pas non plus les autorisations qu'on lui a données
            if (gele[_msgSender()]) revert AdresseGelee(_msgSender());
        }
        if (vers == address(this) && depuis != address(0)) revert VersLaReserve();
        if (depuis == address(this) && vers != address(0)) revert ReserveIntransferable();
        super._update(depuis, vers, montant);
    }
}
