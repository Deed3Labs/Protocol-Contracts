// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title The two places the payout pool draws on when a claim has come due.
/// @dev Both are repaid in reserve tokens rather than handed the position they paid for. The yield
/// pool's share price is cash plus what is out on loan; the reserve's cover is denominated in
/// reserve tokens. A credit claim sitting in either would read as a hole in their books until
/// somebody redeemed it, so what they put up comes back as what they put up. The co-op funding the
/// pool directly is the other case and still holds what it pays for -- it has no such books.
interface ILendingPool {
    /// @notice cash on hand and not already claimed by the withdrawal queue.
    function availableCash() external view returns (uint256);

    /// @notice draws cash to fund unsecured credit.
    function borrow(uint256 amount, address to) external;

    /// @notice returns borrowed cash; anything above the principal is yield for the depositors.
    function repay(uint256 amount) external;
}

interface IAssuranceLender {
    /// @notice lends for a claim that has come due: excess, then buffer, never the primary reserve.
    /// @return lent what the reserve could actually put up, which may be nothing.
    function lendToPayoutPool(uint256 amount) external returns (uint256 lent);

    /// @notice takes back what was lent, cushion first.
    function repayFromPayoutPool(uint256 amount) external;
}
