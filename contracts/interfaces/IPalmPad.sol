// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.16;

interface IPalmPad {
    /// @dev get PALM allocation from launchpad
    function getPalmAmount(address user) external view returns (uint256);

    /// @dev get PALM commission from launchpad invite program
    function getPalmCommissionAmount(address user)
        external
        view
        returns (uint256);
}
