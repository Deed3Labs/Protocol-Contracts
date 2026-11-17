// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title The lenders the payout pool draws on when a claim has come due.
/// @dev The yield pool and the bond vault are repaid in reserve tokens rather than handed the
/// position they paid for. The yield pool's share price is cash plus what is out on loan, so a
/// credit claim sitting there would read as a hole in its books until somebody redeemed it; what
/// they put up comes back as what they put up. The co-op's AssurancePool is not a lender (section
/// 13): no payout path reaches it. The co-op funding the
/// pool directly is the other case and still holds what it pays for -- it has no such books.
interface ILendingPool {
    /// @notice cash on hand and not already claimed by the withdrawal queue.
    function availableCash() external view returns (uint256);

    function borrowableToday(address borrower) external view returns (uint256);

    /// @notice draws cash to fund unsecured credit.
    function borrow(uint256 amount, address to) external;

    /// @notice returns borrowed cash; anything above the principal is yield for the depositors.
    function repay(uint256 amount) external;
}

/// @dev The payout pool borrows through this from the bond vault, and only the bond vault.
interface IPayoutLender {
    /// @notice lends for a claim that has come due, out of what the lender may spare.
    /// @return lent what the lender could actually put up, which may be nothing.
    function lendToPayoutPool(uint256 amount) external returns (uint256 lent);

    /// @notice takes back what was lent, cushion first.
    function repayFromPayoutPool(uint256 amount) external;
}
