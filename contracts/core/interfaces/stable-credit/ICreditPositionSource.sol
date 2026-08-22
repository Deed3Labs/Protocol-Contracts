// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title ICreditPositionSource
/// @notice Reports what a member owes an issuer, grouped by the kind of credit it is.
/// @dev Pool exposure is not a property of a debt or of a pledge on their own -- it is what the
/// AssurancePool would pay if the debt defaulted and the pledge behind it were realized. So the
/// figure needs both, and they live in different contracts: the issuers know what is owed and
/// under which tier, the collateral registry knows what stands behind it.
///
/// Grouped by kind rather than returned per position, because the haircut is per collateral type
/// and everything drawn under one kind is haircut the same way.
interface ICreditPositionSource {
    /// @notice a member's outstanding principal, grouped by tier kind.
    /// @dev Principal rather than what is owed. Carry that has been materialised is principal by
    /// then, and carry that has not is not yet a claim on anything.
    /// @param member address of the member.
    /// @return kinds tier kinds the member holds a position in.
    /// @return amounts principal outstanding under each, in the same order.
    function debtByKind(address member)
        external
        view
        returns (bytes32[] memory kinds, uint256[] memory amounts);
}
