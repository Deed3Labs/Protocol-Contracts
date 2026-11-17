// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

// The Deed timelock is OpenZeppelin's TimelockController, used as-is (DECISIONS #8, #10): the same code as the
// credit side's, in its own instance, with the Foundation multisig as proposer and a 7-day minimum delay. This
// import only makes Hardhat build its artifact for deploy/deploy_all.ts and the tests. No timelock code is written
// here.
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
