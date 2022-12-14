// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.16;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IPalmToken is IERC20 {
    function mint(address to, uint256 amount) external;
}
