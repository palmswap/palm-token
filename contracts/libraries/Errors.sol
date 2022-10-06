// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.16;

library Errors {
    error ZeroAddress();
    error ZeroAmount();
    error PoolDoesNotExist();
    error NoReward();
    error InvalidPercentage();
    error InvalidArray();
    error InvalidVestingInfo();
    error NothingToClaim();
    error InvalidCategory();
}
