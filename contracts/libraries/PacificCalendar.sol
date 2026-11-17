// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title PacificCalendar
/// @notice Calendar dates and US Pacific time for revolving cycle ends (section 12.1, Addendum 2).
/// @dev A revolving cycle ends at 23:59:59 Pacific on the member's Cycle End Day (1-28) of every
/// month, so every due point falls on the same day each month (California Fin. Code 22452). The
/// dates are Howard Hinnant's civil-from-days algorithms on the proleptic Gregorian calendar, counted
/// in days since 1970-01-01. Pacific time is UTC-7 from 02:00 local on the second Sunday in March to
/// 02:00 local on the first Sunday in November, and UTC-8 otherwise (the US rule since 2007).
/// Everything here is pure: a cycle end is computed from the day, never stored by a role.
library PacificCalendar {
    uint256 internal constant DAY = 86_400;
    uint256 internal constant PST = 8 hours;
    uint256 internal constant PDT = 7 hours;

    /// @notice days since 1970-01-01 of a calendar date (y >= 1970).
    function daysFromCivil(uint256 y, uint256 m, uint256 d) internal pure returns (uint256) {
        if (m <= 2) y -= 1;
        uint256 era = y / 400;
        uint256 yoe = y - era * 400;
        uint256 doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1;
        uint256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146_097 + doe - 719_468;
    }

    /// @notice the calendar date of a day number.
    function civilFromDays(uint256 z) internal pure returns (uint256 y, uint256 m, uint256 d) {
        z += 719_468;
        uint256 era = z / 146_097;
        uint256 doe = z - era * 146_097;
        uint256 yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        d = doy - (153 * mp + 2) / 5 + 1;
        m = mp < 10 ? mp + 3 : mp - 9;
        y = yoe + era * 400 + (m <= 2 ? 1 : 0);
    }

    /// @dev Day number of the n-th Sunday of a month (1970-01-01 was a Thursday).
    function _nthSunday(uint256 y, uint256 m, uint256 n) private pure returns (uint256) {
        uint256 first = daysFromCivil(y, m, 1);
        return first + (7 - (first + 4) % 7) % 7 + 7 * (n - 1);
    }

    /// @notice whether daylight time is in force at 23:59:59 local on day number `dn` of year `y`:
    /// from the second Sunday in March up to, not including, the first Sunday in November.
    function isDaylightDay(uint256 dn, uint256 y) internal pure returns (bool) {
        return dn >= _nthSunday(y, 3, 2) && dn < _nthSunday(y, 11, 1);
    }

    /// @notice the Pacific local date of a UTC timestamp.
    function localDate(uint256 ts) internal pure returns (uint256 y, uint256 m, uint256 d) {
        (y,,) = civilFromDays((ts - PST) / DAY);
        // Daylight time starts at 02:00 PST (10:00 UTC) and ends at 02:00 PDT (09:00 UTC).
        bool dst = ts >= _nthSunday(y, 3, 2) * DAY + 10 hours && ts < _nthSunday(y, 11, 1) * DAY + 9 hours;
        return civilFromDays((ts - (dst ? PDT : PST)) / DAY);
    }

    /// @notice 23:59:59 Pacific on a calendar date, as a UTC timestamp.
    function endOfDay(uint256 y, uint256 m, uint256 d) internal pure returns (uint256) {
        uint256 dn = daysFromCivil(y, m, d);
        return dn * DAY + DAY - 1 + (isDaylightDay(dn, y) ? PDT : PST);
    }

    /// @notice the first cycle end on Cycle End Day `day` (1-28) at or after `ts`.
    /// @dev Every day 1-28 exists in every month, so the end is always on `day` itself.
    function endOnOrAfter(uint256 ts, uint256 day) internal pure returns (uint256) {
        (uint256 y, uint256 m, uint256 d) = localDate(ts);
        if (d > day) {
            if (m == 12) {
                m = 1;
                y += 1;
            } else {
                m += 1;
            }
        }
        return endOfDay(y, m, day);
    }

    /// @notice the default Cycle End Day for a line opened at `ts`: the day before the opening day,
    /// or 28 if that would be the 29th to the 31st (or the opening day is the 1st).
    function defaultDay(uint256 ts) internal pure returns (uint8) {
        (,, uint256 d) = localDate(ts);
        return d == 1 || d > 29 ? 28 : uint8(d - 1);
    }
}
