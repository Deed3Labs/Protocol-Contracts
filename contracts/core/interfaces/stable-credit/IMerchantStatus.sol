// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title IMerchantStatus
/// @notice The two facts the ledger and the issuers need about a merchant.
/// @dev Narrower than MerchantRegistry on purpose: deciding who may be paid needs to know whether
/// an address is a merchant and whether it is switched on, and nothing else.
interface IMerchantStatus {
    function isRegistered(address merchant) external view returns (bool);

    function isActive(address merchant) external view returns (bool);
}

/// @notice A merchant's terms by plan length (compliance spec item 8).
interface IMerchantSplitTerms {
    function splitTermsOf(address merchant, uint32 installments)
        external
        view
        returns (uint256 discountBps, uint256 subsidyBps, uint32 freeSplitMax);
}
