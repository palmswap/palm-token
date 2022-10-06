import { expect } from 'chai';
import { ethers } from 'hardhat';
import { utils, constants } from 'ethers';
import type { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { PalmToken } from '../typechain';

describe('PalmToken', () => {
  let owner: SignerWithAddress;
  let palmToken: PalmToken;

  const NAME = 'PALM';
  const SYMBOL = 'PALM';
  const INITIAL_SUPPLY = utils.parseEther('17700000');

  const DEFAULT_ADMIN_ROLE = constants.HashZero;
  const MINTER_ROLE = utils.keccak256(utils.toUtf8Bytes('MINTER_ROLE'));
  const PAUSER_ROLE = utils.keccak256(utils.toUtf8Bytes('PAUSER_ROLE'));

  beforeEach(async () => {
    [owner] = await ethers.getSigners();

    const PalmTokenFactory = await ethers.getContractFactory('PalmToken');
    palmToken = <PalmToken>await PalmTokenFactory.deploy();
  });

  describe('Check constructor and initial values', () => {
    it('check inital values', async () => {
      expect(await palmToken.name()).to.be.equal(NAME);
      expect(await palmToken.symbol()).to.be.equal(SYMBOL);
      expect(await palmToken.totalSupply()).to.be.equal(INITIAL_SUPPLY);
      expect(await palmToken.balanceOf(owner.address)).to.be.equal(
        INITIAL_SUPPLY,
      );
      expect(await palmToken.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be
        .true;
      expect(await palmToken.hasRole(MINTER_ROLE, owner.address)).to.be.true;
      expect(await palmToken.hasRole(PAUSER_ROLE, owner.address)).to.be.true;
    });
  });
});
