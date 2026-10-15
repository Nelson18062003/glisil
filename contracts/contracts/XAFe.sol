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
 *  - ERC-20, six décimales (1 XAF = 1 000 000 unités), comme l'USDT.
 *  - Rôles : ADMIN, FRAPPEUR (le signataire de la plateforme), DESTRUCTEUR,
 *    GELEUR (conformité), PAUSEUR. L'ADMIN (un wallet matériel) ne reçoit
 *    QUE le rôle d'administrer : il donne les autres, il ne frappe pas lui-même.
 *    Il se transmet en deux temps, avec un délai (AccessControlDefaultAdminRules) :
 *    un clic de travers ou une clé volée ne le cède pas d'un coup, et il ne
 *    s'abandonne pas sans préavis.
 *  - Les XAFe qui reviennent arrivent sur l'adresse de dépôt PROPRE à chaque
 *    client. L'ADMIN inscrit ces adresses ; le DESTRUCTEUR brûle ce qui y
 *    arrive (detruireDepot), et nulle part ailleurs : jamais le wallet d'un
 *    client.
 *  - Pause : plus rien ne bouge, le temps de comprendre.
 *  - Gel d'une adresse : elle ne peut plus ni envoyer ni recevoir — ce que
 *    la conformité (COBAC, COSUMAF) peut exiger d'un émetteur.
 *  - Chaque frappe et chaque destruction porte sa référence : la chaîne et
 *    le grand livre de la plateforme se rapprochent ligne à ligne.
 *  - Un plafond de frappe par jour : la clé du FRAPPEUR vit sur un serveur,
 *    et une clé volée ne doit pas pouvoir frapper sans limite. Au-delà, il
 *    faut l'ADMIN (une autre clé, hors ligne) pour relever le plafond.
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

    /// Une référence de retrait ne frappe qu'une fois.
    mapping(bytes32 => bool) public referenceUtilisee;
    /// Les adresses gelées : ni envoi, ni réception.
    mapping(address => bool) public gele;
    /// Ce qui peut se frapper en un jour (en unités), toutes frappes confondues.
    uint256 public plafondJour;
    /// Ce qui a été frappé, par jour (block.timestamp / 1 jour).
    mapping(uint256 => uint256) public frappeLeJour;
    /// Les adresses de dépôt de la plateforme (une par client), inscrites par l'ADMIN.
    mapping(address => bool) public estAdresseDeDepot;
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

    constructor(address admin, uint256 plafond) ERC20("XAFe", "XAFe") AccessControlDefaultAdminRules(DELAI_ADMIN, admin) {
        plafondJour = plafond;
        emit PlafondJour(plafond);
    }

    /// Relever (ou baisser) le plafond de frappe : l'ADMIN seul, jamais le FRAPPEUR.
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
     * La plateforme détruit des XAFe revenus sur l'une de ses adresses
     * (le client les a envoyés à son adresse de dépôt ; son compte est
     * recrédité). Seules les adresses de la plateforme ont des XAFe à y
     * détruire : la fonction n'agit que sur le solde de l'appelant.
     */
    function detruire(uint256 montant, bytes32 empreinte) external onlyRole(DESTRUCTEUR_ROLE) whenNotPaused {
        if (montant == 0) revert MontantNul();
        _burn(_msgSender(), montant);
        emit Detruit(_msgSender(), montant, empreinte);
    }

    /** L'ADMIN inscrit (ou retire) les adresses de dépôt que le moteur a préparées. */
    function inscrireAdressesDeDepot(address[] calldata adresses, bool inscrites) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint256 i = 0; i < adresses.length; i++) {
            estAdresseDeDepot[adresses[i]] = inscrites;
            emit AdresseDeDepot(adresses[i], inscrites);
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
        _burn(adresse, montant);
        emit Detruit(adresse, montant, empreinte);
    }

    /* ---------------------------------------------------- conformité */

    function geler(address adresse, string calldata motif) external onlyRole(GELEUR_ROLE) {
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

    function reprendre() external onlyRole(PAUSEUR_ROLE) {
        _unpause();
    }

    /**
     * Tout mouvement passe ici (OpenZeppelin 5) : frappe, transfert,
     * destruction. En pause, rien ne bouge ; une adresse gelée ne bouge pas.
     */
    function _update(address depuis, address vers, uint256 montant) internal override whenNotPaused {
        if (!_reprise) {
            if (gele[depuis]) revert AdresseGelee(depuis);
            if (gele[vers]) revert AdresseGelee(vers);
        }
        super._update(depuis, vers, montant);
    }
}
