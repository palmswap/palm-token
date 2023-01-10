import { expect } from 'chai';
import { ethers } from 'hardhat';
import { utils, constants, BigNumber } from 'ethers';
import type { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { PalmToken, PalmFarming, MockERC20 } from '../typechain';
import {
  getCurrentBlock,
  advanceBlocks,
  getCurrentTime,
  increaseTime,
} from './utils';

describe('PalmFarming', () => {
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let palmToken: PalmToken;
  let palmFarming: PalmFarming;
  let lpToken: MockERC20;
  let mintStartBlock: BigNumber;

  const STAKING_REWARD_PER_BLOCK = utils.parseEther('1');
  const FARMING_REWARD_PER_BLOCK = utils.parseEther('0.75');
  const STAKING_COOLDOWN_PERIOD = 86400 * 7;
  const MULTIPLIER = utils.parseUnits('1', 12);

  const MINTER_ROLE = utils.keccak256(utils.toUtf8Bytes('MINTER_ROLE'));

  beforeEach(async () => {
    [owner, alice] = await ethers.getSigners();

    mintStartBlock = (await getCurrentBlock()).add(20);

    const PalmTokenFactory = await ethers.getContractFactory('PalmToken');
    palmToken = <PalmToken>await PalmTokenFactory.deploy();

    const PalmFarmingFactory = await ethers.getContractFactory('PalmFarming');
    palmFarming = <PalmFarming>(
      await PalmFarmingFactory.deploy(
        palmToken.address,
        STAKING_REWARD_PER_BLOCK,
        STAKING_COOLDOWN_PERIOD,
        mintStartBlock,
      )
    );

    const MockERC20Factory = await ethers.getContractFactory('MockERC20');
    lpToken = <MockERC20>(
      await MockERC20Factory.deploy('LP', 'LP', utils.parseEther('10000000'))
    );

    await palmToken.grantRole(MINTER_ROLE, palmFarming.address);

    await palmToken.transfer(alice.address, utils.parseEther('100000'));
    await palmToken
      .connect(alice)
      .approve(palmFarming.address, constants.MaxUint256);
    await lpToken.transfer(alice.address, utils.parseEther('100000'));
    await lpToken
      .connect(alice)
      .approve(palmFarming.address, constants.MaxUint256);
  });

  describe('Check constructor and initial values', () => {
    it('check inital values', async () => {
      expect(await palmFarming.owner()).to.be.equal(owner.address);
      expect(await palmFarming.palmToken()).to.be.equal(palmToken.address);
      expect(await palmFarming.poolTokens(0)).to.be.equal(palmToken.address);

      const poolInfo = await palmFarming.poolInfo(palmToken.address);

      expect(poolInfo.id).to.be.equal(1);
      expect(poolInfo.lastRewardBlock).to.be.equal(mintStartBlock);
      expect(poolInfo.totalDeposits).to.be.equal(0);
      expect(poolInfo.rewardPerBlock).to.be.equal(STAKING_REWARD_PER_BLOCK);
      expect(poolInfo.cooldownPeriod).to.be.equal(STAKING_COOLDOWN_PERIOD);
      expect(poolInfo.accPalmPerShare).to.be.equal(0);
    });

    it('it reverts if palm token is zero', async () => {
      const PalmFarmingFactory = await ethers.getContractFactory('PalmFarming');

      await expect(
        PalmFarmingFactory.deploy(
          constants.AddressZero,
          STAKING_REWARD_PER_BLOCK,
          STAKING_COOLDOWN_PERIOD,
          mintStartBlock,
        ),
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('it reverts if reward per block is zero', async () => {
      const PalmFarmingFactory = await ethers.getContractFactory('PalmFarming');

      await expect(
        PalmFarmingFactory.deploy(
          palmToken.address,
          0,
          STAKING_COOLDOWN_PERIOD,
          mintStartBlock,
        ),
      ).to.be.revertedWith('ZeroAmount()');
    });
  });

  describe('#setPoolInfo', () => {
    it('it reverts if msg.sender is not owner', async () => {
      await expect(
        palmFarming
          .connect(alice)
          .setPoolInfo(
            lpToken.address,
            FARMING_REWARD_PER_BLOCK,
            0,
            mintStartBlock,
          ),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('it reverts if token is zero', async () => {
      await expect(
        palmFarming.setPoolInfo(
          constants.AddressZero,
          FARMING_REWARD_PER_BLOCK,
          0,
          mintStartBlock,
        ),
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('it reverts if reward per block is zero', async () => {
      await expect(
        palmFarming.setPoolInfo(lpToken.address, 0, 0, mintStartBlock),
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('add new pool if token was not registered', async () => {
      const tx = await palmFarming.setPoolInfo(
        lpToken.address,
        FARMING_REWARD_PER_BLOCK,
        0,
        mintStartBlock,
      );

      expect(await palmFarming.poolTokens(1)).to.be.equal(lpToken.address);

      const poolInfo = await palmFarming.poolInfo(lpToken.address);

      expect(poolInfo.id).to.be.equal(2);
      expect(poolInfo.lastRewardBlock).to.be.equal(mintStartBlock);
      expect(poolInfo.totalDeposits).to.be.equal(0);
      expect(poolInfo.rewardPerBlock).to.be.equal(FARMING_REWARD_PER_BLOCK);
      expect(poolInfo.cooldownPeriod).to.be.equal(0);
      expect(poolInfo.accPalmPerShare).to.be.equal(0);

      await expect(tx)
        .to.emit(palmFarming, 'PoolUpdated')
        .withArgs(
          lpToken.address,
          2,
          FARMING_REWARD_PER_BLOCK,
          0,
          mintStartBlock,
        );
    });

    it('use current block number if mintStartBlock is zero', async () => {
      await advanceBlocks(30);
      await palmFarming.setPoolInfo(
        lpToken.address,
        FARMING_REWARD_PER_BLOCK,
        0,
        0,
      );

      const poolInfo = await palmFarming.poolInfo(lpToken.address);

      expect(poolInfo.lastRewardBlock).to.be.not.equal(mintStartBlock);
      expect(poolInfo.lastRewardBlock).to.be.equal(await getCurrentBlock());
    });

    it('update pool info if token was already registered', async () => {
      const tx = await palmFarming.setPoolInfo(
        palmToken.address,
        FARMING_REWARD_PER_BLOCK,
        0,
        mintStartBlock,
      );

      expect(await palmFarming.poolTokens(0)).to.be.equal(palmToken.address);

      const poolInfo = await palmFarming.poolInfo(palmToken.address);

      expect(poolInfo.id).to.be.equal(1);
      expect(poolInfo.rewardPerBlock).to.be.equal(FARMING_REWARD_PER_BLOCK);
      expect(poolInfo.cooldownPeriod).to.be.equal(0);

      await expect(tx)
        .to.emit(palmFarming, 'PoolUpdated')
        .withArgs(
          palmToken.address,
          1,
          FARMING_REWARD_PER_BLOCK,
          0,
          mintStartBlock,
        );
    });
  });

  describe('#updatePool', () => {
    beforeEach(async () => {
      await palmFarming.setPoolInfo(
        lpToken.address,
        FARMING_REWARD_PER_BLOCK,
        0,
        mintStartBlock,
      );
    });

    it('it reverts if token was not registered', async () => {
      await expect(palmFarming.updatePool(alice.address)).to.be.revertedWith(
        'PoolDoesNotExist()',
      );
    });

    it('nothing happen if current block time is less than last reward block', async () => {
      await palmFarming
        .connect(alice)
        .deposit(palmToken.address, utils.parseEther('1'), false);

      const poolInfoBefore = await palmFarming.poolInfo(palmToken.address);

      await palmFarming.updatePool(palmToken.address);

      const poolInfoAfter = await palmFarming.poolInfo(palmToken.address);

      expect(poolInfoBefore.lastRewardBlock).to.be.equal(
        poolInfoAfter.lastRewardBlock,
      );
      expect(poolInfoBefore.totalDeposits).to.be.equal(
        poolInfoAfter.totalDeposits,
      );
      expect(poolInfoBefore.rewardPerBlock).to.be.equal(
        poolInfoAfter.rewardPerBlock,
      );
      expect(poolInfoBefore.cooldownPeriod).to.be.equal(
        poolInfoAfter.cooldownPeriod,
      );
      expect(poolInfoBefore.accPalmPerShare).to.be.equal(
        poolInfoAfter.accPalmPerShare,
      );
    });

    it('nothing happen if total deposits is zero', async () => {
      await advanceBlocks(30);
      const poolInfoBefore = await palmFarming.poolInfo(palmToken.address);

      await palmFarming.updatePool(palmToken.address);

      const poolInfoAfter = await palmFarming.poolInfo(palmToken.address);

      expect(poolInfoBefore.lastRewardBlock).to.be.equal(
        poolInfoAfter.lastRewardBlock,
      );
      expect(poolInfoBefore.totalDeposits).to.be.equal(
        poolInfoAfter.totalDeposits,
      );
      expect(poolInfoBefore.rewardPerBlock).to.be.equal(
        poolInfoAfter.rewardPerBlock,
      );
      expect(poolInfoBefore.cooldownPeriod).to.be.equal(
        poolInfoAfter.cooldownPeriod,
      );
      expect(poolInfoBefore.accPalmPerShare).to.be.equal(
        poolInfoAfter.accPalmPerShare,
      );
    });

    it('update pool info', async () => {
      await advanceBlocks(40);

      const amount = utils.parseEther('100');
      await palmFarming.connect(alice).deposit(lpToken.address, amount, false);

      await palmFarming.updatePool(lpToken.address);

      const passedBlocks = (await getCurrentBlock()).sub(mintStartBlock);
      const rewards = passedBlocks.mul(FARMING_REWARD_PER_BLOCK);

      expect(await palmToken.balanceOf(palmFarming.address)).to.be.equal(
        rewards,
      );
      const poolInfo = await palmFarming.poolInfo(lpToken.address);

      expect(poolInfo.lastRewardBlock).to.be.equal(await getCurrentBlock());
      expect(poolInfo.totalDeposits).to.be.equal(amount);
      expect(poolInfo.accPalmPerShare).to.be.equal(
        rewards.mul(MULTIPLIER).div(amount),
      );
    });
  });

  describe('#deposit', () => {
    beforeEach(async () => {
      await palmFarming.setPoolInfo(
        lpToken.address,
        FARMING_REWARD_PER_BLOCK,
        0,
        mintStartBlock,
      );

      await advanceBlocks(30);
    });

    it('it reverts if amount is zero', async () => {
      await expect(
        palmFarming.connect(alice).deposit(palmToken.address, 0, false),
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('deposit first time', async () => {
      const aliceBalanceBefore = await palmToken.balanceOf(alice.address);
      const amount = utils.parseEther('1');

      const poolInfoBefore = await palmFarming.poolInfo(palmToken.address);

      const tx = await palmFarming
        .connect(alice)
        .deposit(palmToken.address, amount, false);

      const poolInfo = await palmFarming.poolInfo(palmToken.address);

      expect(poolInfo.lastRewardBlock).to.be.equal(
        poolInfoBefore.lastRewardBlock,
      );
      expect(poolInfo.totalDeposits).to.be.equal(amount);
      expect(poolInfo.accPalmPerShare).to.be.equal(0);

      const userInfo = await palmFarming.userInfo(
        palmToken.address,
        alice.address,
      );

      expect(userInfo.amount).to.be.equal(amount);
      expect(userInfo.rewardDebt).to.be.equal(0);
      expect(userInfo.pending).to.be.equal(0);
      expect(userInfo.withdrawPendingAmount).to.be.equal(0);
      expect(userInfo.withdrawCooldownExpiary).to.be.equal(0);

      expect(await palmToken.balanceOf(palmFarming.address)).to.be.equal(
        amount,
      );
      expect(await palmToken.balanceOf(alice.address)).to.be.equal(
        aliceBalanceBefore.sub(amount),
      );

      await expect(tx)
        .to.emit(palmFarming, 'Deposited')
        .withArgs(alice.address, palmToken.address, amount, false);
    });

    it('deposit after total deposit exist', async () => {
      const amount0 = utils.parseEther('1');
      await palmFarming
        .connect(alice)
        .deposit(palmToken.address, amount0, false);

      const amount = utils.parseEther('2');

      await advanceBlocks(10);

      const tx = await palmFarming
        .connect(alice)
        .deposit(palmToken.address, amount, false);

      const passedBlocks = (await getCurrentBlock()).sub(mintStartBlock);
      const rewards = passedBlocks.mul(STAKING_REWARD_PER_BLOCK);

      const poolInfo = await palmFarming.poolInfo(palmToken.address);

      const accPalmPerShare = rewards.mul(MULTIPLIER).div(amount0);
      expect(poolInfo.lastRewardBlock).to.be.equal(await getCurrentBlock());
      expect(poolInfo.totalDeposits).to.be.equal(amount.add(amount0));
      expect(poolInfo.accPalmPerShare).to.be.equal(accPalmPerShare);

      const userInfo = await palmFarming.userInfo(
        palmToken.address,
        alice.address,
      );

      const pending = accPalmPerShare.mul(amount0).div(MULTIPLIER);
      const rewardDebt = accPalmPerShare
        .mul(amount0.add(amount))
        .div(MULTIPLIER);

      expect(userInfo.amount).to.be.equal(amount.add(amount0));
      expect(userInfo.rewardDebt).to.be.equal(rewardDebt);
      expect(userInfo.pending).to.be.equal(pending);
      expect(userInfo.withdrawPendingAmount).to.be.equal(0);
      expect(userInfo.withdrawCooldownExpiary).to.be.equal(0);

      expect(await palmToken.balanceOf(palmFarming.address)).to.be.equal(
        amount.add(amount0).add(rewards),
      );

      await expect(tx)
        .to.emit(palmFarming, 'Deposited')
        .withArgs(alice.address, palmToken.address, amount, false);
    });

    it('deposit from cooldown', async () => {
      const amount = utils.parseEther('2');
      const cancelCooldownAmount = utils.parseEther('1');

      await palmFarming
        .connect(alice)
        .deposit(palmToken.address, amount, false);

      await palmFarming.connect(alice).withdraw(palmToken.address, amount);

      const aliceBalanceBefore = await palmToken.balanceOf(alice.address);
      const tx = await palmFarming
        .connect(alice)
        .deposit(palmToken.address, cancelCooldownAmount, true);

      const poolInfo = await palmFarming.poolInfo(palmToken.address);

      expect(poolInfo.totalDeposits).to.be.equal(cancelCooldownAmount);

      const userInfo = await palmFarming.userInfo(
        palmToken.address,
        alice.address,
      );

      expect(userInfo.amount).to.be.equal(cancelCooldownAmount);
      expect(userInfo.withdrawPendingAmount).to.be.equal(
        amount.sub(cancelCooldownAmount),
      );

      expect(await palmToken.balanceOf(alice.address)).to.be.equal(
        aliceBalanceBefore,
      );

      await expect(tx)
        .to.emit(palmFarming, 'Deposited')
        .withArgs(alice.address, palmToken.address, cancelCooldownAmount, true);
    });

    it('set withdraw expiary to zero if cancel all cooldown amount', async () => {
      const amount = utils.parseEther('2');

      await palmFarming
        .connect(alice)
        .deposit(palmToken.address, amount, false);

      await palmFarming.connect(alice).withdraw(palmToken.address, amount);

      const aliceBalanceBefore = await palmToken.balanceOf(alice.address);
      const tx = await palmFarming
        .connect(alice)
        .deposit(palmToken.address, amount, true);

      const poolInfo = await palmFarming.poolInfo(palmToken.address);

      expect(poolInfo.totalDeposits).to.be.equal(amount);

      const userInfo = await palmFarming.userInfo(
        palmToken.address,
        alice.address,
      );

      expect(userInfo.amount).to.be.equal(amount);
      expect(userInfo.withdrawPendingAmount).to.be.equal(amount.sub(amount));
      expect(userInfo.withdrawCooldownExpiary).to.be.equal(0);

      expect(await palmToken.balanceOf(alice.address)).to.be.equal(
        aliceBalanceBefore,
      );

      await expect(tx)
        .to.emit(palmFarming, 'Deposited')
        .withArgs(alice.address, palmToken.address, amount, true);
    });
  });

  describe('#withdraw', () => {
    const depositAmount = utils.parseEther('3');

    beforeEach(async () => {
      await palmFarming.setPoolInfo(
        lpToken.address,
        FARMING_REWARD_PER_BLOCK,
        0,
        mintStartBlock,
      );

      await palmFarming
        .connect(alice)
        .deposit(palmToken.address, depositAmount, false);

      await palmFarming
        .connect(alice)
        .deposit(lpToken.address, depositAmount, false);
      await advanceBlocks(30);
    });

    it('withdraw without cooldown', async () => {
      const aliceBalanceBefore = await lpToken.balanceOf(alice.address);
      const amount = utils.parseEther('1');

      await advanceBlocks(10);

      const tx = await palmFarming
        .connect(alice)
        .withdraw(lpToken.address, amount);

      const passedBlocks = (await getCurrentBlock()).sub(mintStartBlock);
      const rewards = passedBlocks.mul(FARMING_REWARD_PER_BLOCK);

      const poolInfo = await palmFarming.poolInfo(lpToken.address);

      const accPalmPerShare = rewards.mul(MULTIPLIER).div(depositAmount);
      expect(poolInfo.lastRewardBlock).to.be.equal(await getCurrentBlock());
      expect(poolInfo.totalDeposits).to.be.equal(depositAmount.sub(amount));
      expect(poolInfo.accPalmPerShare).to.be.equal(accPalmPerShare);

      const userInfo = await palmFarming.userInfo(
        lpToken.address,
        alice.address,
      );

      const pending = accPalmPerShare.mul(depositAmount).div(MULTIPLIER);
      const rewardDebt = accPalmPerShare
        .mul(depositAmount.sub(amount))
        .div(MULTIPLIER);

      expect(userInfo.amount).to.be.equal(depositAmount.sub(amount));
      expect(userInfo.rewardDebt).to.be.equal(rewardDebt);
      expect(userInfo.pending).to.be.equal(pending);
      expect(userInfo.withdrawPendingAmount).to.be.equal(0);
      expect(userInfo.withdrawCooldownExpiary).to.be.equal(0);

      expect(await lpToken.balanceOf(palmFarming.address)).to.be.equal(
        depositAmount.sub(amount),
      );
      expect(await lpToken.balanceOf(alice.address)).to.be.equal(
        aliceBalanceBefore.add(amount),
      );

      await expect(tx)
        .to.emit(palmFarming, 'Withdrawn')
        .withArgs(alice.address, lpToken.address, amount);
    });

    it('lock for a cooldown period', async () => {
      const aliceBalanceBefore = await palmToken.balanceOf(alice.address);
      const amount = utils.parseEther('1');

      await advanceBlocks(10);

      const tx = await palmFarming
        .connect(alice)
        .withdraw(palmToken.address, amount);

      const passedBlocks = (await getCurrentBlock()).sub(mintStartBlock);
      const rewards = passedBlocks.mul(STAKING_REWARD_PER_BLOCK);

      const poolInfo = await palmFarming.poolInfo(palmToken.address);

      const accPalmPerShare = rewards.mul(MULTIPLIER).div(depositAmount);
      expect(poolInfo.lastRewardBlock).to.be.equal(await getCurrentBlock());
      expect(poolInfo.totalDeposits).to.be.equal(depositAmount.sub(amount));
      expect(poolInfo.accPalmPerShare).to.be.equal(accPalmPerShare);

      const userInfo = await palmFarming.userInfo(
        palmToken.address,
        alice.address,
      );

      const pending = accPalmPerShare.mul(depositAmount).div(MULTIPLIER);
      const rewardDebt = accPalmPerShare
        .mul(depositAmount.sub(amount))
        .div(MULTIPLIER);

      const cooldownExpiary = (await getCurrentTime()).add(
        STAKING_COOLDOWN_PERIOD,
      );

      expect(userInfo.amount).to.be.equal(depositAmount.sub(amount));
      expect(userInfo.rewardDebt).to.be.equal(rewardDebt);
      expect(userInfo.pending).to.be.equal(pending);
      expect(userInfo.withdrawPendingAmount).to.be.equal(amount);
      expect(userInfo.withdrawCooldownExpiary).to.be.equal(cooldownExpiary);

      expect(await palmToken.balanceOf(palmFarming.address)).to.be.equal(
        depositAmount.add(rewards),
      );
      expect(await palmToken.balanceOf(alice.address)).to.be.equal(
        aliceBalanceBefore,
      );

      await expect(tx)
        .to.emit(palmFarming, 'Cooldown')
        .withArgs(alice.address, palmToken.address, amount, cooldownExpiary);
    });

    it('Withdraw cooldown amount first before process', async () => {
      const aliceBalanceBefore = await palmToken.balanceOf(alice.address);
      const amount = utils.parseEther('1');

      await advanceBlocks(10);

      await palmFarming.connect(alice).withdraw(palmToken.address, amount);

      await increaseTime(STAKING_COOLDOWN_PERIOD);

      const tx = await palmFarming
        .connect(alice)
        .withdraw(palmToken.address, 0);

      const userInfo = await palmFarming.userInfo(
        palmToken.address,
        alice.address,
      );

      expect(userInfo.withdrawPendingAmount).to.be.equal(0);

      expect(await palmToken.balanceOf(alice.address)).to.be.equal(
        aliceBalanceBefore.add(amount),
      );

      await expect(tx)
        .to.emit(palmFarming, 'Withdrawn')
        .withArgs(alice.address, palmToken.address, amount);
    });
  });

  describe('#claim', () => {
    const depositAmount = utils.parseEther('3');

    beforeEach(async () => {
      await palmFarming.setPoolInfo(
        lpToken.address,
        FARMING_REWARD_PER_BLOCK,
        0,
        mintStartBlock,
      );

      await palmFarming
        .connect(alice)
        .deposit(palmToken.address, depositAmount, false);

      await palmFarming
        .connect(alice)
        .deposit(lpToken.address, depositAmount, false);
      await advanceBlocks(30);
    });

    it('claim without cooldown', async () => {
      const aliceBalanceBefore = await palmToken.balanceOf(alice.address);

      await advanceBlocks(10);

      const claimAmount = utils.parseEther('20');
      const tx = await palmFarming
        .connect(alice)
        .claim(lpToken.address, claimAmount);

      const passedBlocks = (await getCurrentBlock()).sub(mintStartBlock);
      const rewards = passedBlocks.mul(FARMING_REWARD_PER_BLOCK);

      const poolInfo = await palmFarming.poolInfo(lpToken.address);

      const accPalmPerShare = rewards.mul(MULTIPLIER).div(depositAmount);
      expect(poolInfo.lastRewardBlock).to.be.equal(await getCurrentBlock());
      expect(poolInfo.totalDeposits).to.be.equal(depositAmount);
      expect(poolInfo.accPalmPerShare).to.be.equal(accPalmPerShare);

      const userInfo = await palmFarming.userInfo(
        lpToken.address,
        alice.address,
      );

      const pending = accPalmPerShare.mul(depositAmount).div(MULTIPLIER);
      const rewardDebt = accPalmPerShare.mul(depositAmount).div(MULTIPLIER);

      expect(userInfo.amount).to.be.equal(depositAmount);
      expect(userInfo.rewardDebt).to.be.equal(rewardDebt);
      expect(userInfo.pending).to.be.equal(pending.sub(claimAmount));
      expect(userInfo.withdrawPendingAmount).to.be.equal(0);
      expect(userInfo.withdrawCooldownExpiary).to.be.equal(0);

      expect(await lpToken.balanceOf(palmFarming.address)).to.be.equal(
        depositAmount,
      );
      expect(await palmToken.balanceOf(alice.address)).to.be.equal(
        aliceBalanceBefore.add(claimAmount),
      );

      await expect(tx)
        .to.emit(palmFarming, 'Claimed')
        .withArgs(alice.address, lpToken.address, claimAmount);
    });

    it('claim all if amount is bigger than pending amount', async () => {
      const aliceBalanceBefore = await palmToken.balanceOf(alice.address);

      await advanceBlocks(10);

      const claimAmount = utils.parseEther('1000');
      const tx = await palmFarming
        .connect(alice)
        .claim(lpToken.address, claimAmount);

      const passedBlocks = (await getCurrentBlock()).sub(mintStartBlock);
      const rewards = passedBlocks.mul(FARMING_REWARD_PER_BLOCK);

      const poolInfo = await palmFarming.poolInfo(lpToken.address);

      const accPalmPerShare = rewards.mul(MULTIPLIER).div(depositAmount);
      expect(poolInfo.lastRewardBlock).to.be.equal(await getCurrentBlock());
      expect(poolInfo.totalDeposits).to.be.equal(depositAmount);
      expect(poolInfo.accPalmPerShare).to.be.equal(accPalmPerShare);

      const userInfo = await palmFarming.userInfo(
        lpToken.address,
        alice.address,
      );

      const pending = accPalmPerShare.mul(depositAmount).div(MULTIPLIER);
      const rewardDebt = accPalmPerShare.mul(depositAmount).div(MULTIPLIER);

      expect(userInfo.amount).to.be.equal(depositAmount);
      expect(userInfo.rewardDebt).to.be.equal(rewardDebt);
      expect(userInfo.pending).to.be.equal(0);
      expect(userInfo.withdrawPendingAmount).to.be.equal(0);
      expect(userInfo.withdrawCooldownExpiary).to.be.equal(0);

      expect(await lpToken.balanceOf(palmFarming.address)).to.be.equal(
        depositAmount,
      );
      expect(await palmToken.balanceOf(alice.address)).to.be.equal(
        aliceBalanceBefore.add(pending),
      );

      await expect(tx)
        .to.emit(palmFarming, 'Claimed')
        .withArgs(alice.address, lpToken.address, pending);
    });

    it('Revert when pending amount is zero', async () => {
      await advanceBlocks(10);

      await palmFarming
        .connect(alice)
        .withdraw(palmToken.address, depositAmount);

      const claimAmount = utils.parseEther('20');

      await palmFarming.connect(alice).claim(palmToken.address, claimAmount);

      await increaseTime(STAKING_COOLDOWN_PERIOD);

      await expect(
        palmFarming.connect(alice).claim(palmToken.address, 0),
      ).to.revertedWith('ZeroAmount()');
    });
  });

  describe('#compound', () => {
    const depositAmount = utils.parseEther('3');

    beforeEach(async () => {
      await palmFarming.setPoolInfo(
        lpToken.address,
        FARMING_REWARD_PER_BLOCK,
        0,
        mintStartBlock,
      );

      await palmFarming
        .connect(alice)
        .deposit(palmToken.address, depositAmount, false);

      await palmFarming
        .connect(alice)
        .deposit(lpToken.address, depositAmount, false);
      await advanceBlocks(30);
    });

    it('it reverts if amount is zero', async () => {
      await expect(
        palmFarming.connect(alice).compound(palmToken.address, 0),
      ).to.revertedWith('ZeroAmount()');
    });

    it('it reverts if pending amount is zero', async () => {
      await expect(
        palmFarming
          .connect(owner)
          .compound(palmToken.address, utils.parseEther('20')),
      ).to.revertedWith('NoReward()');
    });

    it('compound farming', async () => {
      await advanceBlocks(10);

      const compoundAmount = utils.parseEther('20');

      const tx = await palmFarming
        .connect(alice)
        .compound(lpToken.address, compoundAmount);

      const passedBlocks = (await getCurrentBlock()).sub(mintStartBlock);
      const farmingRewards = passedBlocks.mul(FARMING_REWARD_PER_BLOCK);

      const farmingPoolInfo = await palmFarming.poolInfo(lpToken.address);

      const farmingAccPalmPerShare = farmingRewards
        .mul(MULTIPLIER)
        .div(depositAmount);

      expect(farmingPoolInfo.lastRewardBlock).to.be.equal(
        await getCurrentBlock(),
      );
      expect(farmingPoolInfo.totalDeposits).to.be.equal(depositAmount);
      expect(farmingPoolInfo.accPalmPerShare).to.be.equal(
        farmingAccPalmPerShare,
      );

      const farmingPending = farmingAccPalmPerShare
        .mul(depositAmount)
        .div(MULTIPLIER);
      const farmingRewardDebt = farmingAccPalmPerShare
        .mul(depositAmount)
        .div(MULTIPLIER);

      const stakingRewards = passedBlocks.mul(STAKING_REWARD_PER_BLOCK);

      const stakingPoolInfo = await palmFarming.poolInfo(palmToken.address);

      const stakingAccPalmPerShare = stakingRewards
        .mul(MULTIPLIER)
        .div(depositAmount);

      expect(stakingPoolInfo.lastRewardBlock).to.be.equal(
        await getCurrentBlock(),
      );
      expect(stakingPoolInfo.totalDeposits).to.be.equal(
        depositAmount.add(compoundAmount),
      );
      expect(stakingPoolInfo.accPalmPerShare).to.be.equal(
        stakingAccPalmPerShare,
      );

      const stakingPending = stakingAccPalmPerShare
        .mul(depositAmount)
        .div(MULTIPLIER);
      const stakingRewardDebt = stakingAccPalmPerShare
        .mul(depositAmount.add(compoundAmount))
        .div(MULTIPLIER);

      const farmingUserInfo = await palmFarming.userInfo(
        lpToken.address,
        alice.address,
      );

      expect(farmingUserInfo.amount).to.be.equal(depositAmount);
      expect(farmingUserInfo.rewardDebt).to.be.equal(farmingRewardDebt);
      expect(farmingUserInfo.pending).to.be.equal(
        farmingPending.sub(compoundAmount),
      );
      expect(farmingUserInfo.withdrawPendingAmount).to.be.equal(0);
      expect(farmingUserInfo.withdrawCooldownExpiary).to.be.equal(0);

      const stakingUserInfo = await palmFarming.userInfo(
        palmToken.address,
        alice.address,
      );

      expect(stakingUserInfo.amount).to.be.equal(
        depositAmount.add(compoundAmount),
      );
      expect(stakingUserInfo.rewardDebt).to.be.equal(stakingRewardDebt);
      expect(stakingUserInfo.pending).to.be.equal(stakingPending);
      expect(stakingUserInfo.withdrawPendingAmount).to.be.equal(0);
      expect(stakingUserInfo.withdrawCooldownExpiary).to.be.equal(0);

      await expect(tx)
        .to.emit(palmFarming, 'Compounded')
        .withArgs(alice.address, lpToken.address, compoundAmount);
    });

    it('compound all if amount is greater thanpending amount', async () => {
      await advanceBlocks(10);

      const compoundAmount = utils.parseEther('2000');

      const tx = await palmFarming
        .connect(alice)
        .compound(lpToken.address, compoundAmount);

      const passedBlocks = (await getCurrentBlock()).sub(mintStartBlock);
      const farmingRewards = passedBlocks.mul(FARMING_REWARD_PER_BLOCK);

      const farmingPoolInfo = await palmFarming.poolInfo(lpToken.address);

      const farmingAccPalmPerShare = farmingRewards
        .mul(MULTIPLIER)
        .div(depositAmount);

      expect(farmingPoolInfo.lastRewardBlock).to.be.equal(
        await getCurrentBlock(),
      );
      expect(farmingPoolInfo.totalDeposits).to.be.equal(depositAmount);
      expect(farmingPoolInfo.accPalmPerShare).to.be.equal(
        farmingAccPalmPerShare,
      );

      const farmingPending = farmingAccPalmPerShare
        .mul(depositAmount)
        .div(MULTIPLIER);
      const farmingRewardDebt = farmingAccPalmPerShare
        .mul(depositAmount)
        .div(MULTIPLIER);

      const stakingRewards = passedBlocks.mul(STAKING_REWARD_PER_BLOCK);

      const stakingPoolInfo = await palmFarming.poolInfo(palmToken.address);

      const stakingAccPalmPerShare = stakingRewards
        .mul(MULTIPLIER)
        .div(depositAmount);

      expect(stakingPoolInfo.lastRewardBlock).to.be.equal(
        await getCurrentBlock(),
      );
      expect(stakingPoolInfo.totalDeposits).to.be.equal(
        depositAmount.add(farmingPending),
      );
      expect(stakingPoolInfo.accPalmPerShare).to.be.equal(
        stakingAccPalmPerShare,
      );

      const stakingPending = stakingAccPalmPerShare
        .mul(depositAmount)
        .div(MULTIPLIER);
      const stakingRewardDebt = stakingAccPalmPerShare
        .mul(depositAmount.add(farmingPending))
        .div(MULTIPLIER);

      const farmingUserInfo = await palmFarming.userInfo(
        lpToken.address,
        alice.address,
      );

      expect(farmingUserInfo.amount).to.be.equal(depositAmount);
      expect(farmingUserInfo.rewardDebt).to.be.equal(farmingRewardDebt);
      expect(farmingUserInfo.pending).to.be.equal(0);
      expect(farmingUserInfo.withdrawPendingAmount).to.be.equal(0);
      expect(farmingUserInfo.withdrawCooldownExpiary).to.be.equal(0);

      const stakingUserInfo = await palmFarming.userInfo(
        palmToken.address,
        alice.address,
      );

      expect(stakingUserInfo.amount).to.be.equal(
        depositAmount.add(farmingPending),
      );
      expect(stakingUserInfo.rewardDebt).to.be.equal(stakingRewardDebt);
      expect(stakingUserInfo.pending).to.be.equal(stakingPending);
      expect(stakingUserInfo.withdrawPendingAmount).to.be.equal(0);
      expect(stakingUserInfo.withdrawCooldownExpiary).to.be.equal(0);

      await expect(tx)
        .to.emit(palmFarming, 'Compounded')
        .withArgs(alice.address, lpToken.address, farmingPending);
    });

    it('compound staking', async () => {
      await advanceBlocks(10);

      const compoundAmount = utils.parseEther('20');
      const tx = await palmFarming
        .connect(alice)
        .compound(palmToken.address, compoundAmount);

      const passedBlocks = (await getCurrentBlock()).sub(mintStartBlock);

      const stakingRewards = passedBlocks.mul(STAKING_REWARD_PER_BLOCK);

      const stakingPoolInfo = await palmFarming.poolInfo(palmToken.address);

      const stakingAccPalmPerShare = stakingRewards
        .mul(MULTIPLIER)
        .div(depositAmount);

      const stakingPending = stakingAccPalmPerShare
        .mul(depositAmount)
        .div(MULTIPLIER);
      const stakingRewardDebt = stakingAccPalmPerShare
        .mul(depositAmount.add(compoundAmount))
        .div(MULTIPLIER);

      expect(stakingPoolInfo.lastRewardBlock).to.be.equal(
        await getCurrentBlock(),
      );
      expect(stakingPoolInfo.totalDeposits).to.be.equal(
        depositAmount.add(compoundAmount),
      );
      expect(stakingPoolInfo.accPalmPerShare).to.be.equal(
        stakingAccPalmPerShare,
      );

      const stakingUserInfo = await palmFarming.userInfo(
        palmToken.address,
        alice.address,
      );

      expect(stakingUserInfo.amount).to.be.equal(
        depositAmount.add(compoundAmount),
      );
      expect(stakingUserInfo.rewardDebt).to.be.equal(stakingRewardDebt);
      expect(stakingUserInfo.pending).to.be.equal(
        stakingPending.sub(compoundAmount),
      );
      expect(stakingUserInfo.withdrawPendingAmount).to.be.equal(0);
      expect(stakingUserInfo.withdrawCooldownExpiary).to.be.equal(0);

      await expect(tx)
        .to.emit(palmFarming, 'Compounded')
        .withArgs(alice.address, palmToken.address, compoundAmount);
    });
  });

  describe('#getPendingAmount', () => {
    const depositAmount = utils.parseEther('3');

    beforeEach(async () => {
      await palmFarming.setPoolInfo(
        lpToken.address,
        FARMING_REWARD_PER_BLOCK,
        0,
        mintStartBlock,
      );

      await palmFarming
        .connect(alice)
        .deposit(palmToken.address, depositAmount, false);

      await palmFarming
        .connect(alice)
        .deposit(lpToken.address, depositAmount, false);
      await advanceBlocks(30);
    });

    it('it reverts if token was not registered', async () => {
      await expect(
        palmFarming.getPendingAmount(alice.address, alice.address),
      ).to.be.revertedWith('PoolDoesNotExist()');
    });

    it('it returns correct pending amount', async () => {
      await advanceBlocks(10);

      const passedBlocks = (await getCurrentBlock()).sub(mintStartBlock);
      const farmingRewards = passedBlocks.mul(FARMING_REWARD_PER_BLOCK);

      const farmingAccPalmPerShare = farmingRewards
        .mul(MULTIPLIER)
        .div(depositAmount);

      const farmingPending = farmingAccPalmPerShare
        .mul(depositAmount)
        .div(MULTIPLIER);

      expect(
        await palmFarming.getPendingAmount(lpToken.address, alice.address),
      ).to.be.equal(farmingPending);
      const stakingRewards = passedBlocks.mul(STAKING_REWARD_PER_BLOCK);

      const stakingAccPalmPerShare = stakingRewards
        .mul(MULTIPLIER)
        .div(depositAmount);

      const stakingPending = stakingAccPalmPerShare
        .mul(depositAmount)
        .div(MULTIPLIER);
      expect(
        await palmFarming.getPendingAmount(palmToken.address, alice.address),
      ).to.be.equal(stakingPending);
    });
  });
});
