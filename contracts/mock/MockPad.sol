// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.16;

import {IPalmPad} from "../interfaces/IPalmPad.sol";

contract MockPad is IPalmPad {
    uint256 palmAmount;
    uint256 palmCommissionAmount;

    function setPalmAmount(uint256 _palmAmount) external {
        palmAmount = _palmAmount;
    }

    function setPalmCommissionAmount(uint256 _palmCommissionAmount) external {
        palmCommissionAmount = _palmCommissionAmount;
    }

    function getPalmAmount(address) external view returns (uint256) {
        return palmAmount;
    }

    function getPalmCommissionAmount(address) external view returns (uint256) {
        return palmCommissionAmount;
    }
}
