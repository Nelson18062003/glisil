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
 *    GELEUR (conformité), PAUSEUR.
 *  - Pause : plus rien ne bouge, le temps de comprendre.
 *  - Gel d'une adresse : elle ne peut plus ni envoyer ni recevoir — ce que
 *    la conformité (COBAC, COSUMAF) peut exiger d'un émetteur.
 *  - Chaque frappe et chaque destruction porte sa référence : la chaîne et
 *    le grand livre de la plateforme se rapprochent ligne à ligne.
 */
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract XAFe is ERC20, AccessControl, Pausable {
    bytes32 public constant FRAPPEUR_ROLE = keccak256("FRAPPEUR_ROLE");
    bytes32 public constant DESTRUCTEUR_ROLE = keccak256("DESTRUCTEUR_ROLE");
    bytes32 public constant GELEUR_ROLE = keccak256("GELEUR_ROLE");
    bytes32 public constant PAUSEUR_ROLE = keccak256("PAUSEUR_ROLE");

    /// Une référence de retrait ne frappe qu'une fois.
    mapping(bytes32 => bool) public referenceUtilisee;
    /// Les adresses gelées : ni envoi, ni réception.
    mapping(address => bool) public gele;

    event Frappe(address indexed vers, uint256 montant, bytes32 indexed empreinte);
    event Detruit(address indexed depuis, uint256 montant, bytes32 indexed empreinte);
    event Rendu(address indexed depuis, uint256 montant, bytes32 indexed compte);
    event Gele(address indexed adresse, string motif);
    event Degele(address indexed adresse);

    error ReferenceDejaUtilisee(bytes32 empreinte);
    error ReferenceVide();
    error MontantNul();
    error AdresseGelee(address adresse);

    constructor(address admin) ERC20("XAFe", "XAFe") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(FRAPPEUR_ROLE, admin);
        _grantRole(DESTRUCTEUR_ROLE, admin);
        _grantRole(GELEUR_ROLE, admin);
        _grantRole(PAUSEUR_ROLE, admin);
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

    /**
     * Un client rend lui-même ses XAFe à la plateforme, en les brûlant avec
     * l'empreinte de son code de compte : le veilleur de chaîne recrédite.
     * (La voie simple reste d'envoyer à son adresse de dépôt.)
     */
    function rendre(uint256 montant, bytes32 compte) external whenNotPaused {
        if (montant == 0) revert MontantNul();
        if (compte == bytes32(0)) revert ReferenceVide();
        _burn(_msgSender(), montant);
        emit Rendu(_msgSender(), montant, compte);
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
        if (gele[depuis]) revert AdresseGelee(depuis);
        if (gele[vers]) revert AdresseGelee(vers);
        super._update(depuis, vers, montant);
    }
}
