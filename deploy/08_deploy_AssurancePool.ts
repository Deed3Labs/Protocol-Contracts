import { runAssuranceDeploy } from "./assurance_timelock_handover";

/**
 * The co-op's AssurancePool (compliance section 13).
 *
 * The Phase 1 pool this script used to deploy (primary, buffer and excess reserves, an oracle
 * rebalancing them toward a target RTD, wired into the ledger) is retired, and so is
 * AssuranceOracle (the old 09). The new pool is a separate contract with a new layout, governed by
 * its own 7-day timelock from its first block, and no credit, savings, payout or bond contract holds
 * its address. `assurance_timelock_handover.ts` does the work; this runs it.
 *
 *   BOARD_SAFE=0x... ASSURANCE_SIGNERS=0xA,0xB ASSURANCE_DEPLOY=1 \
 *     npx hardhat run deploy/08_deploy_AssurancePool.ts --network base-sepolia
 */
runAssuranceDeploy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
