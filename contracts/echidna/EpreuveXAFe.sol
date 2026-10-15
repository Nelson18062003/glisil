// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * LE JETON, FUZZÉ (Echidna).  cd contracts && sh echidna/eprouver.sh
 *
 * Les épreuves Hardhat jouent des cas choisis. Ici, Echidna enchaîne au
 * hasard des dizaines de milliers d'appels — frappes de toutes tailles et de
 * toutes références, jours qui passent, gels, dégels, reprises, pauses,
 * transferts entre trois porteurs, et un INTRUS sans aucun rôle qui essaie
 * tout — et vérifie après chacun que les promesses du jeton tiennent :
 *   · jamais plus que plafondJour frappé dans un même jour ;
 *   · une référence ne frappe qu'une fois ;
 *   · l'offre vaut exactement ce qui a été frappé moins ce qui a été détruit ;
 *   · un porteur gelé ne bouge pas (ni envoi, ni réception) ;
 *   · en pause, rien ne bouge ;
 *   · l'intrus ne réussit rien : ni frapper, ni relever le plafond, ni geler,
 *     ni reprendre des fonds.
 */
import "../contracts/XAFe.sol";

contract Porteur {
    function essayer(address cible, bytes calldata donnees) external returns (bool ok) {
        (ok, ) = cible.call(donnees);
    }
}

contract EpreuveXAFe {
    uint256 internal constant PLAFOND = 1_000_000 * 1e6;
    XAFe internal jeton;
    Porteur internal intrus;
    Porteur[3] internal porteurs;

    mapping(uint256 => uint256) internal frappeDuJour;
    mapping(bytes32 => bool) internal referenceVue;
    uint256 internal frappe;
    uint256 internal detruit;

    bool internal plafondFranchi;
    bool internal referenceRejouee;
    bool internal geleABouge;
    bool internal pauseABouge;
    bool internal intrusAReussi;

    constructor() {
        jeton = new XAFe(address(this), PLAFOND);
        intrus = new Porteur();
        for (uint256 i = 0; i < 3; i++) porteurs[i] = new Porteur();
    }

    function _p(uint8 i) internal view returns (address) { return address(porteurs[i % 3]); }

    /* ------------------------------------------------------- les gestes */

    function frapper(uint8 vers, uint256 montant, bytes32 empreinte) public {
        montant = montant % (PLAFOND + PLAFOND / 2);
        uint256 jour = block.timestamp / 1 days;
        try jeton.frapper(_p(vers), montant, empreinte) {
            if (referenceVue[empreinte]) referenceRejouee = true;
            referenceVue[empreinte] = true;
            frappeDuJour[jour] += montant;
            frappe += montant;
            if (frappeDuJour[jour] > PLAFOND) plafondFranchi = true;
            if (jeton.paused() || jeton.gele(_p(vers))) pauseABouge = pauseABouge || jeton.paused();
            if (jeton.gele(_p(vers))) geleABouge = true;
        } catch {}
    }

    function transferer(uint8 de, uint8 vers, uint256 montant) public {
        address a = _p(de);
        address b = _p(vers);
        uint256 avantA = jeton.balanceOf(a);
        bool ok = porteurs[de % 3].essayer(address(jeton), abi.encodeCall(IERC20.transfer, (b, montant)));
        if (ok && montant > 0 && a != b) {
            if (jeton.gele(a) || jeton.gele(b)) geleABouge = true;
            if (jeton.paused()) pauseABouge = true;
            if (jeton.balanceOf(a) != avantA - montant) geleABouge = true;
        }
    }

    function geler(uint8 qui) public { jeton.geler(_p(qui), "epreuve"); }
    function degeler(uint8 qui) public { jeton.degeler(_p(qui)); }
    function pauser() public { try jeton.pauser() {} catch {} }
    function reprendre() public { try jeton.reprendre() {} catch {} }

    function reprendreFondsGeles(uint8 qui, bytes32 empreinte) public {
        address a = _p(qui);
        uint256 solde = jeton.balanceOf(a);
        try jeton.detruireFondsGeles(a, empreinte) {
            detruit += solde;
            if (!jeton.gele(a)) geleABouge = true;   // on ne reprend qu'à un porteur gelé
        } catch {}
    }

    function intrusEssaie(uint8 quoi, uint256 montant, bytes32 empreinte) public {
        bytes memory d;
        uint8 q = quoi % 6;
        if (q == 0) d = abi.encodeCall(XAFe.frapper, (address(intrus), montant, empreinte));
        else if (q == 1) d = abi.encodeCall(XAFe.fixerPlafondJour, (type(uint256).max));
        else if (q == 2) d = abi.encodeCall(XAFe.detruireFondsGeles, (_p(0), empreinte));
        else if (q == 3) d = abi.encodeCall(XAFe.geler, (_p(1), "intrus"));
        else if (q == 4) d = abi.encodeCall(XAFe.pauser, ());
        else d = abi.encodeCall(AccessControl.grantRole, (jeton.FRAPPEUR_ROLE(), address(intrus)));
        if (intrus.essayer(address(jeton), d)) intrusAReussi = true;
    }

    /* ----------------------------------------------------- les promesses */

    function echidna_jamais_plus_que_le_plafond_du_jour() public view returns (bool) { return !plafondFranchi; }
    function echidna_une_reference_ne_frappe_qu_une_fois() public view returns (bool) { return !referenceRejouee; }
    function echidna_offre_egale_frappe_moins_detruit() public view returns (bool) { return jeton.totalSupply() == frappe - detruit; }
    function echidna_un_porteur_gele_ne_bouge_pas() public view returns (bool) { return !geleABouge; }
    function echidna_en_pause_rien_ne_bouge() public view returns (bool) { return !pauseABouge; }
    function echidna_l_intrus_ne_reussit_rien() public view returns (bool) { return !intrusAReussi; }
}
