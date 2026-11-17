// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @dev Brings OpenZeppelin's TimelockController into the build unchanged, so deploy scripts and
/// tests can deploy it by name. DECISIONS #10: the same code, in two instances with at least a
/// 7-day minimum delay -- one for the Deed contracts (Foundation multisig as proposer), one for
/// credit and savings (Ops Safe as proposer). Holding the admin and upgrade roles, it is what
/// makes every rate change and upgrade public a week before it binds (compliance spec 10e).
import "@openzeppelin/contracts/governance/TimelockController.sol";
