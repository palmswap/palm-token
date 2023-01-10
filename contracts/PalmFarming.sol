// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./libraries/Errors.sol";
import "./interfaces/IPalmToken.sol";

contract PalmFarming is Ownable {
  using SafeCast for uint256;
  using SafeERC20 for IERC20;
  using SafeERC20 for IPalmToken;

  event Deposited(
    address indexed user,
    address indexed token,
    uint256 amount,
    bool fromCooldown
  );
  event Withdrawn(address indexed user, address indexed token, uint256 amount);
  event Claimed(
    address indexed user,
    address indexed poolToken,
    uint256 rewardAmount
  );
  event Cooldown(
    address indexed user,
    address indexed poolToken,
    uint256 amount,
    uint64 expiary
  );
  event Compounded(
    address indexed user,
    address indexed poolToken,
    uint256 amount
  );
  event PoolUpdated(
    address indexed token,
    uint64 indexed id,
    uint256 rewardPerBlock,
    uint64 cooldownPeriod,
    uint64 lastRewardBlock
  );

  struct UserInfo {
    uint256 amount;
    uint256 rewardDebt;
    uint256 pending;
    uint256 withdrawPendingAmount;
    uint64 withdrawCooldownExpiary;
  }

  struct PoolInfo {
    uint64 id;
    uint64 lastRewardBlock;
    uint64 cooldownPeriod;
    uint256 totalDeposits;
    uint256 rewardPerBlock;
    uint256 accPalmPerShare;
  }

  uint256 constant MULTIPLIER = 1e12;

  IPalmToken public immutable palmToken;

  mapping(address => PoolInfo) public poolInfo;
  mapping(address => mapping(address => UserInfo)) public userInfo;

  address[] public poolTokens;

  constructor(
    address _palmToken,
    uint256 _stakingRewardPerBlock,
    uint64 _stakingCooldownPeriod,
    uint64 _mintStartBlock
  ) {
    if (_palmToken == address(0)) {
      revert Errors.ZeroAddress();
    }

    palmToken = IPalmToken(_palmToken);
    _addPool(
      _palmToken,
      _stakingRewardPerBlock,
      _stakingCooldownPeriod,
      _mintStartBlock
    );
  }

  function setPoolInfo(
    address _token,
    uint256 _rewardPerBlock,
    uint64 _cooldownPeriod,
    uint64 _mintStartBlock
  ) external onlyOwner {
    if (_token == address(0)) {
      revert Errors.ZeroAddress();
    }

    PoolInfo storage _poolInfo = poolInfo[_token];
    if (_poolInfo.id == 0) {
      _addPool(_token, _rewardPerBlock, _cooldownPeriod, _mintStartBlock);
    } else {
      updatePool(_token);

      _poolInfo.rewardPerBlock = _rewardPerBlock;
      _poolInfo.cooldownPeriod = _cooldownPeriod;
      if (_poolInfo.accPalmPerShare == 0) {
        // @dev update last reward block when reward not minted for pool yet
        _poolInfo.lastRewardBlock = _mintStartBlock == 0
          ? _getBlockNumber()
          : _mintStartBlock;
      }

      emit PoolUpdated(
        _token,
        _poolInfo.id,
        _rewardPerBlock,
        _cooldownPeriod,
        _poolInfo.lastRewardBlock
      );
    }
  }

  function updatePool(address token) public {
    PoolInfo storage _poolInfo = poolInfo[token];
    if (_poolInfo.id == 0) {
      revert Errors.PoolDoesNotExist();
    }
    if (_getBlockNumber() <= _poolInfo.lastRewardBlock) {
      return;
    }
    if (_poolInfo.totalDeposits == 0) {
      return;
    }

    uint256 rewards = (_getBlockNumber() - _poolInfo.lastRewardBlock) *
      _poolInfo.rewardPerBlock;
    palmToken.mint(address(this), rewards);
    _poolInfo.accPalmPerShare += ((rewards * MULTIPLIER) /
      _poolInfo.totalDeposits);
    _poolInfo.lastRewardBlock = _getBlockNumber();
  }

  function deposit(
    address token,
    uint256 amount,
    bool fromCooldown
  ) external {
    if (amount == 0) {
      revert Errors.ZeroAmount();
    }
    updatePool(token);

    PoolInfo storage _poolInfo = poolInfo[token];
    UserInfo storage _userInfo = userInfo[token][msg.sender];
    _updateUserPending(_poolInfo, _userInfo);

    if (fromCooldown) {
      _userInfo.withdrawPendingAmount -= amount;
      if (_userInfo.withdrawPendingAmount == 0) {
        _userInfo.withdrawCooldownExpiary = 0;
      }
    } else {
      IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }
    _increaseUserDeposits(_poolInfo, _userInfo, amount);

    emit Deposited(msg.sender, token, amount, fromCooldown);
  }

  function withdraw(address token, uint256 amount) external {
    updatePool(token);

    PoolInfo storage _poolInfo = poolInfo[token];
    UserInfo storage _userInfo = userInfo[token][msg.sender];

    if (
      _userInfo.withdrawPendingAmount != 0 &&
      _userInfo.withdrawCooldownExpiary <= block.timestamp
    ) {
      uint256 pendingAmount = _userInfo.withdrawPendingAmount;
      _userInfo.withdrawPendingAmount = 0;
      _userInfo.withdrawCooldownExpiary = 0;

      IERC20(token).safeTransfer(msg.sender, pendingAmount);

      emit Withdrawn(msg.sender, token, pendingAmount);
    }

    _updateUserPending(_poolInfo, _userInfo);

    _decreaseUserDeposits(_poolInfo, _userInfo, amount);

    if (amount == 0) {
      return;
    }

    if (_poolInfo.cooldownPeriod != 0) {
      _userInfo.withdrawPendingAmount += amount;

      uint64 expiary = block.timestamp.toUint64() + _poolInfo.cooldownPeriod;
      _userInfo.withdrawCooldownExpiary = expiary;

      emit Cooldown(msg.sender, token, amount, expiary);
    } else {
      IERC20(token).safeTransfer(msg.sender, amount);

      emit Withdrawn(msg.sender, token, amount);
    }
  }

  function claim(address poolToken, uint256 amount) external {
    updatePool(poolToken);

    PoolInfo storage _poolInfo = poolInfo[poolToken];
    UserInfo storage _userInfo = userInfo[poolToken][msg.sender];

    _updateUserPending(_poolInfo, _userInfo);
    _increaseUserDeposits(_poolInfo, _userInfo, 0);

    if (_userInfo.pending < amount) {
      amount = _userInfo.pending;
    }
    if (amount == 0) {
      revert Errors.ZeroAmount();
    }

    _userInfo.pending -= amount;
    palmToken.safeTransfer(msg.sender, amount);

    emit Claimed(msg.sender, poolToken, amount);
  }

  function compound(address token, uint256 amount) external {
    _compound(token, msg.sender, amount);
  }

  function getPendingAmount(address token, address user)
    external
    view
    returns (uint256)
  {
    PoolInfo memory _poolInfo = poolInfo[token];
    if (_poolInfo.id == 0) {
      revert Errors.PoolDoesNotExist();
    }

    uint256 accPalmPerShare = _poolInfo.accPalmPerShare;
    if (
      _getBlockNumber() > _poolInfo.lastRewardBlock &&
      _poolInfo.totalDeposits != 0
    ) {
      uint256 rewards = (_getBlockNumber() - _poolInfo.lastRewardBlock) *
        _poolInfo.rewardPerBlock;
      accPalmPerShare += ((rewards * MULTIPLIER) / _poolInfo.totalDeposits);
    }

    UserInfo memory _userInfo = userInfo[token][user];

    uint256 pending = (_userInfo.amount * accPalmPerShare) /
      MULTIPLIER -
      _userInfo.rewardDebt;

    return _userInfo.pending + pending;
  }

  function _compound(
    address token,
    address user,
    uint256 amount
  ) internal {
    if (amount == 0) {
      revert Errors.ZeroAmount();
    }

    PoolInfo storage _poolInfo = poolInfo[token];
    UserInfo storage _userInfo = userInfo[token][user];

    updatePool(token);

    if (_userInfo.amount != 0) {
      _updateUserPending(_poolInfo, _userInfo);
      _increaseUserDeposits(_poolInfo, _userInfo, 0);
    }

    if (_userInfo.pending == 0) {
      revert Errors.NoReward();
    }

    PoolInfo storage stakingPool = poolInfo[address(palmToken)];
    UserInfo storage stakingUser = userInfo[address(palmToken)][user];

    if (token != address(palmToken)) {
      updatePool(address(palmToken));
      _updateUserPending(stakingPool, stakingUser);
    }

    if (_userInfo.pending < amount) {
      amount = _userInfo.pending;
    }
    _userInfo.pending -= amount;

    _increaseUserDeposits(stakingPool, stakingUser, amount);

    emit Compounded(user, token, amount);
  }

  function _addPool(
    address _token,
    uint256 _rewardPerBlock,
    uint64 _cooldownPeriod,
    uint64 _mintStartBlock
  ) internal {
    if (_mintStartBlock == 0) {
      _mintStartBlock = _getBlockNumber();
    }
    if (_rewardPerBlock == 0) {
      revert Errors.ZeroAmount();
    }

    poolTokens.push(_token);
    poolInfo[_token] = PoolInfo({
      id: poolTokens.length.toUint64(),
      rewardPerBlock: _rewardPerBlock,
      lastRewardBlock: _mintStartBlock,
      cooldownPeriod: _cooldownPeriod,
      totalDeposits: 0,
      accPalmPerShare: 0
    });

    emit PoolUpdated(
      _token,
      poolTokens.length.toUint64(),
      _rewardPerBlock,
      _cooldownPeriod,
      _mintStartBlock
    );
  }

  function _updateUserPending(PoolInfo storage _poolInfo, UserInfo storage user)
    internal
  {
    if (user.amount != 0) {
      uint256 pending = (user.amount * _poolInfo.accPalmPerShare) /
        MULTIPLIER -
        user.rewardDebt;
      user.pending += pending;
    }
  }

  function _increaseUserDeposits(
    PoolInfo storage _poolInfo,
    UserInfo storage user,
    uint256 amount
  ) internal {
    if (amount != 0) {
      _poolInfo.totalDeposits += amount;
      user.amount += amount;
    }
    user.rewardDebt = (user.amount * _poolInfo.accPalmPerShare) / MULTIPLIER;
  }

  function _decreaseUserDeposits(
    PoolInfo storage _poolInfo,
    UserInfo storage user,
    uint256 amount
  ) internal {
    _poolInfo.totalDeposits -= amount;
    user.amount -= amount;
    user.rewardDebt = (user.amount * _poolInfo.accPalmPerShare) / MULTIPLIER;
  }

  function _getBlockNumber() internal view returns (uint64) {
    return uint64(block.number);
  }
}
