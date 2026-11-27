// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "../libraries/PacificCalendar.sol";

/// @notice Test-only window onto PacificCalendar.
contract PacificCalendarHarness {
    function endOnOrAfter(uint256 ts, uint256 day) external pure returns (uint256) {
        return PacificCalendar.endOnOrAfter(ts, day);
    }

    function endOfDay(uint256 y, uint256 m, uint256 d) external pure returns (uint256) {
        return PacificCalendar.endOfDay(y, m, d);
    }

    function localDate(uint256 ts) external pure returns (uint256 y, uint256 m, uint256 d) {
        return PacificCalendar.localDate(ts);
    }

    function defaultDay(uint256 ts) external pure returns (uint8) {
        return PacificCalendar.defaultDay(ts);
    }
}
