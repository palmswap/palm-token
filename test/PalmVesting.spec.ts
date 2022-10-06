import { expect } from 'chai';
import { ethers } from 'hardhat';
import { utils, constants, BigNumber } from 'ethers';
import type { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { PalmToken, PalmVesting, MockPad } from '../typechain';
import { getCurrentTime, increaseTime } from './utils';

describe('PalmVesting', () => {
  let owner: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let palmToken: PalmToken;
  let palmPad: MockPad;
  let palmVesting: PalmVesting;

  let tgeTime: BigNumber;

  const DENOMINATOR = 100000;

  const PUBLIC_SALE = 0;
  const PUBLIC_SALE_SPONSOR_COMMISSION = 1;
  const SEED_SALE = 2;
  const PRIVATE_SLAE = 3;
  const TEAM = 4;
  const RETROACTIVE_REWARDS = 5;
  const MARKETING = 6;
  const TRADING_COMPETTIION_AIRDROP = 7;
  const AIRDROP = 8;
  const NFT_WINNER_AIRDROP = 9;

  const LAST_CATEGORY = 9;

  const MINTER_ROLE = utils.keccak256(utils.toUtf8Bytes('MINTER_ROLE'));

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    const PalmTokenFactory = await ethers.getContractFactory('PalmToken');
    palmToken = <PalmToken>await PalmTokenFactory.deploy();

    const palmPadFactory = await ethers.getContractFactory('MockPad');
    palmPad = <MockPad>await palmPadFactory.deploy();

    const PalmVestingFactory = await ethers.getContractFactory('PalmVesting');
    palmVesting = <PalmVesting>(
      await PalmVestingFactory.deploy(palmToken.address, palmPad.address)
    );

    tgeTime = (await getCurrentTime()).add(1000);

    await palmToken.grantRole(MINTER_ROLE, palmVesting.address);
  });

  describe('Check constructor and initial values', () => {
    it('check inital values', async () => {
      expect(await palmVesting.owner()).to.be.equal(owner.address);
      expect(await palmVesting.palmToken()).to.be.equal(palmToken.address);
      expect(await palmVesting.palmPad()).to.be.equal(palmPad.address);
    });

    it('it reverts if palm token is zero', async () => {
      const PalmVestingFactory = await ethers.getContractFactory('PalmVesting');

      await expect(
        PalmVestingFactory.deploy(constants.AddressZero, palmPad.address),
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('it reverts if palm token is zero', async () => {
      const PalmVestingFactory = await ethers.getContractFactory('PalmVesting');

      await expect(
        PalmVestingFactory.deploy(palmToken.address, constants.AddressZero),
      ).to.be.revertedWith('ZeroAddress()');
    });
  });

  describe('#setTgeTime', () => {
    it('it reverts if msg.sender is not owner', async () => {
      await expect(
        palmVesting.connect(alice).setTgeTime(tgeTime),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('it reverts if TGE time is zero', async () => {
      await expect(palmVesting.setTgeTime(0)).to.be.revertedWith(
        'ZeroAmount()',
      );
    });

    it('set TGE time', async () => {
      const tx = await palmVesting.setTgeTime(tgeTime);

      expect(await palmVesting.tgeTime()).to.be.equal(tgeTime);

      await expect(tx).to.emit(palmVesting, 'TgeSet').withArgs(tgeTime);
    });
  });

  describe('#setLastCategory', () => {
    it('it reverts if msg.sender is not owner', async () => {
      await expect(
        palmVesting.connect(alice).setLastCategory(10),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('set last category', async () => {
      const tx = await palmVesting.setLastCategory(10);

      expect(await palmVesting.lastCategory()).to.be.equal(10);

      await expect(tx).to.emit(palmVesting, 'LastCategorySet').withArgs(10);
    });
  });

  describe('#setVestingInfo', () => {
    it('it reverts if msg.sender is not owner', async () => {
      await expect(
        palmVesting.connect(alice).setVestingInfo(SEED_SALE, {
          timeFromTge: 0,
          tgePct: DENOMINATOR,
          periodInDays: 0,
        }),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('it reverts if category is not valid', async () => {
      await expect(
        palmVesting.setVestingInfo(LAST_CATEGORY + 1, {
          timeFromTge: 0,
          tgePct: DENOMINATOR,
          periodInDays: 0,
        }),
      ).to.be.revertedWith('InvalidCategory()');
    });

    it('it reverts if tge percentage is greater than 100%', async () => {
      await expect(
        palmVesting.setVestingInfo(SEED_SALE, {
          timeFromTge: 0,
          tgePct: DENOMINATOR + 1,
          periodInDays: 0,
        }),
      ).to.be.revertedWith('InvalidPercentage()');
    });

    it('it reverts if tge percentage is not 100% and periodInDays is zero', async () => {
      await expect(
        palmVesting.setVestingInfo(SEED_SALE, {
          timeFromTge: 0,
          tgePct: DENOMINATOR - 1,
          periodInDays: 0,
        }),
      ).to.be.revertedWith('InvalidVestingInfo()');
    });

    it('set vesting info', async () => {
      const tx = await palmVesting.setVestingInfo(SEED_SALE, {
        timeFromTge: 100,
        tgePct: DENOMINATOR / 2,
        periodInDays: 10,
      });

      const vestingInfo = await palmVesting.vestingInfos(SEED_SALE);
      expect(vestingInfo[0]).to.be.equal(100);
      expect(vestingInfo[1]).to.be.equal(DENOMINATOR / 2);
      expect(vestingInfo[2]).to.be.equal(10);

      await expect(tx)
        .to.emit(palmVesting, 'VestingInfoSet')
        .withArgs(SEED_SALE, [100, DENOMINATOR / 2, 10]);
    });
  });

  describe('#setVestingInfoInBatch', () => {
    it('it reverts if lenth is zero', async () => {
      await expect(
        palmVesting.setVestingInfoInBatch([], []),
      ).to.be.revertedWith('InvalidArray()');
    });

    it('it reverts if category and vesting infos have different length', async () => {
      await expect(
        palmVesting.setVestingInfoInBatch(
          [SEED_SALE, MARKETING],
          [
            {
              timeFromTge: 0,
              tgePct: DENOMINATOR,
              periodInDays: 0,
            },
          ],
        ),
      ).to.be.revertedWith('InvalidArray()');
    });

    it('set vesting infos in batch', async () => {
      const tx = await palmVesting.setVestingInfoInBatch(
        [SEED_SALE, MARKETING],
        [
          {
            timeFromTge: 100,
            tgePct: DENOMINATOR / 2,
            periodInDays: 10,
          },
          {
            timeFromTge: 1000,
            tgePct: DENOMINATOR / 4,
            periodInDays: 20,
          },
        ],
      );

      let vestingInfo = await palmVesting.vestingInfos(SEED_SALE);
      expect(vestingInfo[0]).to.be.equal(100);
      expect(vestingInfo[1]).to.be.equal(DENOMINATOR / 2);
      expect(vestingInfo[2]).to.be.equal(10);

      vestingInfo = await palmVesting.vestingInfos(MARKETING);
      expect(vestingInfo[0]).to.be.equal(1000);
      expect(vestingInfo[1]).to.be.equal(DENOMINATOR / 4);
      expect(vestingInfo[2]).to.be.equal(20);

      await expect(tx)
        .to.emit(palmVesting, 'VestingInfoSet')
        .withArgs(SEED_SALE, [100, DENOMINATOR / 2, 10]);

      await expect(tx)
        .to.emit(palmVesting, 'VestingInfoSet')
        .withArgs(MARKETING, [1000, DENOMINATOR / 4, 20]);
    });
  });

  describe('#setAmount', () => {
    it('it reverts if msg.sender is not owner', async () => {
      await expect(
        palmVesting.connect(alice).setAmount(SEED_SALE, alice.address, 100),
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('it reverts if category is not valid', async () => {
      await expect(
        palmVesting.setAmount(LAST_CATEGORY + 1, alice.address, 100),
      ).to.be.revertedWith('InvalidCategory()');
    });

    it('it reverts if amount is zero', async () => {
      await expect(
        palmVesting.setAmount(SEED_SALE, alice.address, 0),
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('it reverts if address is zero', async () => {
      await expect(
        palmVesting.setAmount(SEED_SALE, constants.AddressZero, 10),
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('it reverts if category is PUBLIC_SALE or PUBLIC_SALE_SPONSOR_COMMISSION', async () => {
      await expect(
        palmVesting.setAmount(PUBLIC_SALE, alice.address, 10),
      ).to.be.revertedWith('PalmVesting: Cannot set amount for public sale');

      await expect(
        palmVesting.setAmount(
          PUBLIC_SALE_SPONSOR_COMMISSION,
          alice.address,
          10,
        ),
      ).to.be.revertedWith('PalmVesting: Cannot set amount for public sale');
    });

    it('set amount', async () => {
      const tx = await palmVesting.setAmount(SEED_SALE, alice.address, 10);

      expect(await palmVesting.getAmount(SEED_SALE, alice.address)).to.be.equal(
        10,
      );

      await expect(tx)
        .to.emit(palmVesting, 'AmountSet')
        .withArgs(SEED_SALE, alice.address, 10);
    });
  });

  describe('#setAmountInBatch', () => {
    it('it reverts if lenth is zero', async () => {
      await expect(palmVesting.setAmountInBatch([], [], [])).to.be.revertedWith(
        'InvalidArray()',
      );
    });

    it('it reverts if lengths are different', async () => {
      await expect(
        palmVesting.setAmountInBatch(
          [SEED_SALE, MARKETING],
          [alice.address],
          [10, 20],
        ),
      ).to.be.revertedWith('InvalidArray()');

      await expect(
        palmVesting.setAmountInBatch(
          [SEED_SALE, MARKETING],
          [alice.address, bob.address],
          [10],
        ),
      ).to.be.revertedWith('InvalidArray()');
    });

    it('set amounts in batch', async () => {
      const tx = await palmVesting.setAmountInBatch(
        [SEED_SALE, MARKETING],
        [alice.address, bob.address],
        [10, 20],
      );

      expect(await palmVesting.getAmount(SEED_SALE, alice.address)).to.be.equal(
        10,
      );
      expect(await palmVesting.getAmount(MARKETING, bob.address)).to.be.equal(
        20,
      );

      await expect(tx)
        .to.emit(palmVesting, 'AmountSet')
        .withArgs(SEED_SALE, alice.address, 10);
      await expect(tx)
        .to.emit(palmVesting, 'AmountSet')
        .withArgs(MARKETING, bob.address, 20);
    });
  });

  describe('#getAmount', () => {
    beforeEach(async () => {
      await palmVesting.setAmountInBatch(
        [SEED_SALE, MARKETING],
        [alice.address, bob.address],
        [10, 20],
      );
      await palmPad.setPalmAmount(30);
      await palmPad.setPalmCommissionAmount(40);
    });

    it('it returns from palm pad for public sale info', async () => {
      expect(
        await palmVesting.getAmount(PUBLIC_SALE, alice.address),
      ).to.be.equal(30);

      expect(
        await palmVesting.getAmount(
          PUBLIC_SALE_SPONSOR_COMMISSION,
          alice.address,
        ),
      ).to.be.equal(40);
    });

    it('it returns data from storage', async () => {
      expect(await palmVesting.getAmount(SEED_SALE, alice.address)).to.be.equal(
        10,
      );
    });
  });

  describe('#getVestedAmount', () => {
    beforeEach(async () => {
      await palmVesting.setTgeTime(tgeTime);
      await palmVesting.setVestingInfo(SEED_SALE, {
        timeFromTge: 1000,
        tgePct: 10000,
        periodInDays: 18,
      });
      await palmVesting.setAmountInBatch(
        [SEED_SALE, MARKETING],
        [alice.address, bob.address],
        [utils.parseEther('100'), utils.parseEther('200')],
      );
    });

    it('it returns zero if current time is less than TGE time', async () => {
      expect(
        await palmVesting.getVestedAmount(SEED_SALE, alice.address),
      ).to.be.equal(0);
    });

    it('it returns zero if total allocation is zero', async () => {
      await increaseTime(2500);
      expect(
        await palmVesting.getVestedAmount(MARKETING, alice.address),
      ).to.be.equal(0);
    });

    it('it returns tge amount if first vesting not released', async () => {
      await increaseTime(1500);
      expect(
        await palmVesting.getVestedAmount(SEED_SALE, alice.address),
      ).to.be.equal(utils.parseEther('10'));
    });

    it('it returns total amount if tgePct is 100%', async () => {
      await palmVesting.setVestingInfo(SEED_SALE, {
        timeFromTge: 1000,
        tgePct: DENOMINATOR,
        periodInDays: 18,
      });

      await increaseTime(2500);

      expect(
        await palmVesting.getVestedAmount(SEED_SALE, alice.address),
      ).to.be.equal(utils.parseEther('100'));
    });

    it('it returns correct vested amount', async () => {
      const vestingInfo = await palmVesting.vestingInfos(SEED_SALE);

      await increaseTime(2500);
      const currentTime = await getCurrentTime();
      const elapsedDays = currentTime
        .sub(vestingInfo[0].add(tgeTime))
        .div(86400);

      const vestedAmount = utils
        .parseEther('90')
        .mul(elapsedDays)
        .div(18)
        .add(utils.parseEther('10'));
      expect(
        await palmVesting.getVestedAmount(SEED_SALE, alice.address),
      ).to.be.equal(vestedAmount);
    });

    it('it returns total amount if period has been elapsed', async () => {
      await increaseTime(2500 + 20 * 86400);

      expect(
        await palmVesting.getVestedAmount(SEED_SALE, alice.address),
      ).to.be.equal(utils.parseEther('100'));
    });

    it('unlocks daily', async () => {
      const vestingInfo = await palmVesting.vestingInfos(SEED_SALE);

      await increaseTime(86400 * 9 + 2500);
      const currentTime = await getCurrentTime();
      const elapsedDays = currentTime
        .sub(vestingInfo[0].add(tgeTime))
        .div(86400);

      const vestedAmount = utils
        .parseEther('90')
        .mul(elapsedDays)
        .div(18)
        .add(utils.parseEther('10'));

      await increaseTime(10500);

      expect(
        await palmVesting.getVestedAmount(SEED_SALE, alice.address),
      ).to.be.equal(vestedAmount);
    });

    it('it returns zero if vesting info is not set', async () => {
      expect(
        await palmVesting.getVestedAmount(RETROACTIVE_REWARDS, alice.address),
      ).to.be.equal(0);
    });
  });

  describe('#claim', () => {
    beforeEach(async () => {
      await palmVesting.setTgeTime(tgeTime);
      await palmVesting.setVestingInfo(SEED_SALE, {
        timeFromTge: 1000,
        tgePct: 10000,
        periodInDays: 18,
      });
      await palmVesting.setAmountInBatch(
        [SEED_SALE, MARKETING],
        [alice.address, bob.address],
        [utils.parseEther('100'), utils.parseEther('200')],
      );
    });

    it('it reverts if revertForZero is true', async () => {
      await expect(palmVesting.claim(SEED_SALE, true)).to.be.revertedWith(
        'NothingToClaim()',
      );
    });

    it('claim available amount', async () => {
      await increaseTime(86400 * 10);

      const tx = await palmVesting.connect(alice).claim(SEED_SALE, true);

      expect(await palmToken.balanceOf(alice.address)).to.be.eq(
        utils.parseEther('55'),
      );

      await expect(tx)
        .to.be.emit(palmVesting, 'Claimed')
        .withArgs(SEED_SALE, alice.address, utils.parseEther('55'));
    });

    it('claim available amount when had claimed before already', async () => {
      await increaseTime(86400 * 10);

      await palmVesting.connect(alice).claim(SEED_SALE, true);

      await increaseTime(86400 * 5);

      const tx = await palmVesting.connect(alice).claim(SEED_SALE, true);

      expect(await palmToken.balanceOf(alice.address)).to.be.eq(
        utils.parseEther('80'),
      );

      await expect(tx)
        .to.be.emit(palmVesting, 'Claimed')
        .withArgs(SEED_SALE, alice.address, utils.parseEther('25'));
    });
  });

  describe('#claimAll', () => {
    beforeEach(async () => {
      await palmVesting.setTgeTime(tgeTime);
      await palmVesting.setVestingInfoInBatch(
        [SEED_SALE, MARKETING, PUBLIC_SALE],
        [
          {
            timeFromTge: 0,
            tgePct: DENOMINATOR,
            periodInDays: 18,
          },
          {
            timeFromTge: 0,
            tgePct: DENOMINATOR,
            periodInDays: 18,
          },
          {
            timeFromTge: 0,
            tgePct: DENOMINATOR,
            periodInDays: 18,
          },
        ],
      );
      await palmPad.setPalmAmount(utils.parseEther('50'));
      await palmVesting.setAmountInBatch(
        [SEED_SALE, MARKETING],
        [alice.address, alice.address],
        [utils.parseEther('100'), utils.parseEther('200')],
      );
    });

    it('claim all available amount', async () => {
      await increaseTime(2500);

      const tx = await palmVesting.connect(alice).claimAll();

      expect(await palmToken.balanceOf(alice.address)).to.be.eq(
        utils.parseEther('350'),
      );

      await expect(tx)
        .to.be.emit(palmVesting, 'Claimed')
        .withArgs(PUBLIC_SALE, alice.address, utils.parseEther('50'));
      await expect(tx)
        .to.be.emit(palmVesting, 'Claimed')
        .withArgs(SEED_SALE, alice.address, utils.parseEther('100'));
      await expect(tx)
        .to.be.emit(palmVesting, 'Claimed')
        .withArgs(MARKETING, alice.address, utils.parseEther('200'));
    });
  });
});
