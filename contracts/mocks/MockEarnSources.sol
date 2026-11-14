// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title MockEarnSources
/// @notice Test-only stand-in for what `EarnControls` reads from stage 2's contracts: a BondVault's
/// outstanding Maturity Amounts and Reserve Shortfall, the Collateral Agent's Enforcement Notice,
/// and the reserve hook it tells about ineligible Holders and withdrawn terms.
contract MockEarnSources {
    uint256 public totalFaceOutstanding;
    bool public inReserveShortfall;
    bool public enforcementInForce;

    address public lastHolder;
    bool public lastIneligible;
    uint32 public lastTerm;
    bool public lastOffered;
    uint256 public hookCalls;

    function setFace(uint256 face) external {
        totalFaceOutstanding = face;
    }

    function setShortfall(bool s) external {
        inReserveShortfall = s;
    }

    function setEnforcement(bool e) external {
        enforcementInForce = e;
    }

    function holderEligibilityChanged(address holder, bool ineligible) external {
        lastHolder = holder;
        lastIneligible = ineligible;
        hookCalls++;
    }

    function termOfferChanged(uint32 termDays, bool offered) external {
        lastTerm = termDays;
        lastOffered = offered;
        hookCalls++;
    }
}
