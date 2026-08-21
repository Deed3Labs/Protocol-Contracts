// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title MerchantRegistry
/// @notice What each merchant was promised, so the payout path can read it rather than assume it.
/// @dev Terms are per merchant and set in the agreement: net-30 as standard, net-14 where the
/// ticket supports a thirty-day member term. Making them configuration rather than code is what
/// lets a founding partner be given something real without anyone else paying for it.
///
/// **There is no priority field, and that is deliberate.** Founding partners deserve something,
/// and the thing they deserve is better terms -- a lower rate, fee-free first transactions --
/// which the co-op pays for. A better place in the payout queue is a promise kept at another
/// merchant's expense, and the moment order is configurable every merchant conversation includes
/// what tier am I on, and every slow payout has a visible reason that is not "we ran short" but
/// "someone else went first". So the field does not exist to be set.
///
/// If regional expansion ever needs segmentation, the clean version is a pool per region: each
/// funds and drains its own, and nobody is behind anybody.
contract MerchantRegistry is AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    uint256 internal constant BPS = 10_000;

    /// @notice What a merchant was promised.
    struct Terms {
        /// @dev How long the co-op has to pay a claim. Net-30 is the floor, not the promise: a
        /// well funded pool simply beats it.
        uint32 payoutWindow;
        /// @dev Ceiling on what may be approved against this merchant.
        uint256 approvalCap;
        /// @dev The discount the co-op takes on a purchase, in basis points.
        uint256 discountBps;
        bool registered;
        bool active;
    }

    /// @dev merchant => terms
    mapping(address => Terms) private terms;
    address[] private merchants;

    /// @notice The window a merchant gets if none was agreed.
    uint32 public defaultPayoutWindow;

    uint256[44] private __gap;

    error MerchantRegistryInvalidAddress();
    error MerchantRegistryAlreadyRegistered(address merchant);
    error MerchantRegistryUnknown(address merchant);
    error MerchantRegistryDiscountTooHigh(uint256 discountBps);

    event MerchantRegistered(address indexed merchant, uint32 payoutWindow, uint256 discountBps);
    event TermsUpdated(address indexed merchant, uint32 payoutWindow, uint256 approvalCap, uint256 discountBps);
    event MerchantActiveSet(address indexed merchant, bool active);
    event DefaultPayoutWindowUpdated(uint32 payoutWindow);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, uint32 _defaultPayoutWindow) external initializer {
        if (admin == address(0)) revert MerchantRegistryInvalidAddress();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        defaultPayoutWindow = _defaultPayoutWindow;
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /* ========== VIEWS ========== */

    function termsOf(address merchant) external view returns (Terms memory) {
        return terms[merchant];
    }

    function isRegistered(address merchant) public view returns (bool) {
        return terms[merchant].registered;
    }

    function isActive(address merchant) external view returns (bool) {
        return terms[merchant].active;
    }

    /// @notice how long the co-op has to pay this merchant.
    /// @dev Falls back to the default for anyone without agreed terms, so an unregistered
    /// merchant is owed on the standard schedule rather than owed nothing.
    function payoutWindowOf(address merchant) external view returns (uint32) {
        Terms storage merchantTerms = terms[merchant];
        return merchantTerms.registered ? merchantTerms.payoutWindow : defaultPayoutWindow;
    }

    function approvalCapOf(address merchant) external view returns (uint256) {
        return terms[merchant].approvalCap;
    }

    function discountBpsOf(address merchant) external view returns (uint256) {
        return terms[merchant].discountBps;
    }

    function merchantCount() external view returns (uint256) {
        return merchants.length;
    }

    function merchantAt(uint256 index) external view returns (address) {
        return merchants[index];
    }

    /* ========== RESTRICTED ========== */

    function registerMerchant(
        address merchant,
        uint32 payoutWindow,
        uint256 approvalCap,
        uint256 discountBps
    ) external onlyRole(OPERATOR_ROLE) {
        if (merchant == address(0)) revert MerchantRegistryInvalidAddress();
        if (terms[merchant].registered) revert MerchantRegistryAlreadyRegistered(merchant);
        if (discountBps > BPS) revert MerchantRegistryDiscountTooHigh(discountBps);

        terms[merchant] = Terms({
            payoutWindow: payoutWindow,
            approvalCap: approvalCap,
            discountBps: discountBps,
            registered: true,
            active: true
        });
        merchants.push(merchant);
        emit MerchantRegistered(merchant, payoutWindow, discountBps);
    }

    function updateTerms(
        address merchant,
        uint32 payoutWindow,
        uint256 approvalCap,
        uint256 discountBps
    ) external onlyRole(OPERATOR_ROLE) {
        if (!terms[merchant].registered) revert MerchantRegistryUnknown(merchant);
        if (discountBps > BPS) revert MerchantRegistryDiscountTooHigh(discountBps);
        terms[merchant].payoutWindow = payoutWindow;
        terms[merchant].approvalCap = approvalCap;
        terms[merchant].discountBps = discountBps;
        emit TermsUpdated(merchant, payoutWindow, approvalCap, discountBps);
    }

    function setActive(address merchant, bool active) external onlyRole(OPERATOR_ROLE) {
        if (!terms[merchant].registered) revert MerchantRegistryUnknown(merchant);
        terms[merchant].active = active;
        emit MerchantActiveSet(merchant, active);
    }

    function setDefaultPayoutWindow(uint32 payoutWindow) external onlyRole(OPERATOR_ROLE) {
        defaultPayoutWindow = payoutWindow;
        emit DefaultPayoutWindowUpdated(payoutWindow);
    }
}
