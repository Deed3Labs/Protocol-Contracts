// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title What the bond vault and the reserve backing it ask of each other.
/// @dev The vault pays a maturing bond from its own holdings, then the treasury's allowance. It no
/// longer asks the AssurancePool to lend (no redemption path touches the pool), so it only ever
/// calls `repayFromBondVault`, for a loan made before that change. The pool's RTD still reads the
/// near-term gap.
interface IBondVaultGap {
    /// @notice face value maturing inside the vault's window that the vault and the treasury's
    /// allowance cannot pay, in reserve tokens.
    function uncoveredNearTerm() external view returns (uint256);
}

interface IBondReserve {
    /// @notice lends for a bond the vault cannot pay: excess, then buffer, never the primary reserve.
    /// @return lent what the reserve could put up, which may be nothing.
    function lendToBondVault(uint256 amount) external returns (uint256 lent);

    /// @notice takes back what the vault borrowed, the buffer first.
    function repayFromBondVault(uint256 amount) external;
}
