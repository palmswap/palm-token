// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./libraries/Errors.sol";
import "./interfaces/IPalmPad.sol";
import "./interfaces/IPalmToken.sol";

contract PalmVesting is Ownable {
    struct VestingInfo {
        uint64 timeFromTge; // First release time from TGE (seconds)
        uint64 tgePct; // First release percentage
        uint64 periodInDays; // Vesting period of days after first release (days)
    }

    /// @dev emitted when TGE time updated
    event TgeSet(uint64 tgeTime);

    /// @dev emitted when last category updated
    event LastCategorySet(uint8 lastCategory);

    /// @dev emitted when vesting info updated
    event VestingInfoSet(uint8 indexed category, VestingInfo info);

    /// @dev emitted when user claimed PALM
    event Claimed(uint8 indexed category, address indexed user, uint256 amount);

    /// @dev emitted when amount of user set
    event AmountSet(uint8 indexed category, address user, uint256 amount);

    uint64 constant DENOMINATOR = 100000;
    uint64 constant ONE_DAY = 86400;

    /// @dev new category can be added later, so we don't use enum type
    uint8 constant PUBLIC_SALE = 0;
    uint8 constant PUBLIC_SALE_SPONSOR_COMMISSION = 1;
    uint8 constant SEED_SALE = 2;
    uint8 constant TEAM = 3;
    uint8 constant MARKETING = 4;
    uint8 constant TRADING_COMPETTIION_AIRDROP = 5;
    uint8 constant AIRDROP_1 = 6;
    uint8 constant AIRDROP_4 = 7;
    uint8 constant NFT_WINNER_AIRDROP = 8;
    uint8 constant RETROACTIVE_REWARDS = 9;

    uint8 public lastCategory = 9;

    /// @dev palm token address
    IPalmToken public immutable palmToken;
    /// @dev palm pad address
    IPalmPad public immutable palmPad;
    /// @dev TGE time. all vesting starts after TGE.
    uint64 public tgeTime;

    /// @dev Vesting info per category
    mapping(uint8 => VestingInfo) public vestingInfos;
    /// @dev Vesting amount per category and user address
    mapping(uint8 => mapping(address => uint256)) private amounts;
    /// @dev Claimed amount per category and user address
    mapping(uint8 => mapping(address => uint256)) public claimedAmounts;

    modifier onlyValidCategory(uint8 category) {
        if (category > lastCategory) {
            revert Errors.InvalidCategory();
        }
        _;
    }

    constructor(address _palmToken, address _palmPad) {
        if (_palmToken == address(0) || _palmPad == address(0)) {
            revert Errors.ZeroAddress();
        }

        palmToken = IPalmToken(_palmToken);
        palmPad = IPalmPad(_palmPad);
    }

    /// @dev set TGE time
    function setTgeTime(uint64 _tgeTime) external onlyOwner {
        if (_tgeTime == 0) {
            revert Errors.ZeroAmount();
        }
        tgeTime = _tgeTime;

        emit TgeSet(_tgeTime);
    }

    /// @dev set last category
    function setLastCategory(uint8 _lastCategory) external onlyOwner {
        lastCategory = _lastCategory;

        emit LastCategorySet(_lastCategory);
    }

    /// @dev set vesting info
    function setVestingInfo(uint8 category, VestingInfo calldata vestingInfo)
        public
        onlyOwner
        onlyValidCategory(category)
    {
        if (vestingInfo.tgePct > DENOMINATOR) {
            revert Errors.InvalidPercentage();
        }
        if (
            vestingInfo.tgePct != DENOMINATOR && vestingInfo.periodInDays == 0
        ) {
            revert Errors.InvalidVestingInfo();
        }
        vestingInfos[category] = vestingInfo;

        emit VestingInfoSet(category, vestingInfo);
    }

    /// @dev set multiple vesting infos
    function setVestingInfoInBatch(
        uint8[] calldata _categories,
        VestingInfo[] calldata _vestingInfos
    ) external {
        uint256 len = _categories.length;
        if (len == 0 || len != _vestingInfos.length) {
            revert Errors.InvalidArray();
        }
        for (uint256 i = 0; i < len; i += 1) {
            setVestingInfo(_categories[i], _vestingInfos[i]);
        }
    }

    /// @dev set vesting amount per category and user
    function setAmount(
        uint8 category,
        address user,
        uint256 amount
    ) public onlyOwner onlyValidCategory(category) {
        if (amount == 0) {
            revert Errors.ZeroAmount();
        }
        if (user == address(0)) {
            revert Errors.ZeroAddress();
        }
        require(
            category != PUBLIC_SALE &&
                category != PUBLIC_SALE_SPONSOR_COMMISSION,
            "PalmVesting: Cannot set amount for public sale"
        );

        amounts[category][user] = amount;

        emit AmountSet(category, user, amount);
    }

    /// @dev set multiple amounts
    function setAmountInBatch(
        uint8[] calldata _categories,
        address[] calldata _users,
        uint256[] calldata _amounts
    ) external {
        uint256 len = _categories.length;
        if (len == 0 || len != _users.length || len != _amounts.length) {
            revert Errors.InvalidArray();
        }
        for (uint256 i = 0; i < len; i += 1) {
            setAmount(_categories[i], _users[i], _amounts[i]);
        }
    }

    /// @dev get allocated amount per category and user
    function getAmount(uint8 category, address user)
        public
        view
        returns (uint256)
    {
        if (category == PUBLIC_SALE) {
            return palmPad.getPalmAmount(user);
        } else if (category == PUBLIC_SALE_SPONSOR_COMMISSION) {
            return palmPad.getPalmCommissionAmount(user);
        } else {
            return amounts[category][user];
        }
    }

    /// @dev get vested amount until now
    function getVestedAmount(uint8 category, address user)
        public
        view
        returns (uint256)
    {
        VestingInfo memory vestingInfo = vestingInfos[category];
        uint256 totalAmount = getAmount(category, user);

        if (totalAmount == 0 || block.timestamp < tgeTime) {
            return 0;
        }

        uint64 firstReleaseTime = tgeTime + vestingInfo.timeFromTge;
        uint256 tgeAmount = (totalAmount * vestingInfo.tgePct) / DENOMINATOR;

        if (block.timestamp < firstReleaseTime) {
            return tgeAmount;
        }

        if (vestingInfo.tgePct == DENOMINATOR) {
            return totalAmount;
        }
        if (vestingInfo.periodInDays == 0) {
            return 0;
        }

        uint256 totalVestedAmount = totalAmount - tgeAmount;
        uint64 elapsedDays = (uint64(block.timestamp) - firstReleaseTime) /
            ONE_DAY;

        uint256 vestedAmount = ((totalVestedAmount * elapsedDays) /
            vestingInfo.periodInDays) + tgeAmount;

        if (vestedAmount > totalAmount) {
            return totalAmount;
        }
        return vestedAmount;
    }

    /// @dev claim available PALM
    function claim(uint8 category, bool revertForZero) public {
        uint256 vestedAmount = getVestedAmount(category, msg.sender);
        uint256 availableAmount = vestedAmount -
            claimedAmounts[category][msg.sender];

        if (availableAmount != 0) {
            claimedAmounts[category][msg.sender] = vestedAmount;
            palmToken.mint(msg.sender, availableAmount);

            emit Claimed(category, msg.sender, availableAmount);
        } else if (revertForZero) {
            revert Errors.NothingToClaim();
        }
    }

    /// @dev claim available PALM of all categories
    function claimAll() external {
        uint256 lastIdx = lastCategory;
        for (uint8 i = 0; i <= lastIdx; i += 1) {
            claim(uint8(i), false);
        }
    }
}
