// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Un USDT d'essai, pour les chaînes d'essai seulement. Ses décimales sont
/// celles du vrai : 18 pour le BSC-USD de la BNB Smart Chain, 6 pour l'USDT
/// de Tron. Quiconque en frappe : ce n'est pas de l'argent.
contract UsdtEssai is ERC20 {
    uint8 private immutable _decimales;

    constructor(uint8 decimales_) ERC20("USDT d'essai", "USDT") {
        _decimales = decimales_;
    }

    function decimals() public view override returns (uint8) {
        return _decimales;
    }

    function frapper(address vers, uint256 montant) external {
        _mint(vers, montant);
    }
}
