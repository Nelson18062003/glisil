// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Un USDT d'essai, pour la chaîne locale seulement : 18 décimales comme le
/// BSC-USD de la BNB Smart Chain. Quiconque en frappe : ce n'est pas de l'argent.
contract UsdtEssai is ERC20 {
    constructor() ERC20("USDT d'essai", "USDT") {}

    function frapper(address vers, uint256 montant) external {
        _mint(vers, montant);
    }
}
