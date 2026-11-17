// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../libraries/Accretion.sol";
import "../peripherals/interfaces/ICollateralAgent.sol";

/// @title MockAgentVault
/// @notice Test-only stand-in for stage 2's BondVault side of the Collateral Agent: it holds the
/// USDC, lets only the `CollateralAgent` contract move it, refuses excess during an Enforcement
/// Period, pays a matured bond only while no Enforcement Notice is in effect, and gates one
/// governed setting behind `consumeChange`.
contract MockAgentVault is IAgentVault {
    IERC20 public immutable token;
    address public agent;
    uint256 public requiredReserve;

    error NotAgent();
    error InForce();

    constructor(IERC20 token_) {
        token = token_;
    }

    function setAgent(address a) external {
        agent = a;
    }

    /// @notice a governed setting: needs a change the Agent co-signed (Part 2 item 6).
    function setRequiredReserve(uint256 r) external {
        ICollateralAgent(agent).consumeChange(keccak256(msg.data));
        requiredReserve = r;
    }

    function collateralAssets() public view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function deployableExcess() external view returns (uint256) {
        uint256 held = collateralAssets();
        uint256 owed = requiredReserve + ICollateralAgent(agent).unclaimedDistributions();
        return held > owed ? held - owed : 0;
    }

    function agentTransfer(address to, uint256 amount) external {
        if (msg.sender != agent) revert NotAgent();
        token.transfer(to, amount);
    }

    function agentWithdrawExcess(address to, uint256 amount) external {
        if (msg.sender != agent) revert NotAgent();
        if (ICollateralAgent(agent).enforcementInForce()) revert InForce();
        token.transfer(to, amount);
    }

    /// @notice a matured bond's settlement, permissionless, blocked only by an Enforcement Notice.
    function settle(address to, uint256 amount) external {
        if (ICollateralAgent(agent).enforcementInForce()) revert InForce();
        token.transfer(to, amount);
    }
}

/// @title MockAgentBondBook
/// @notice Test-only stand-in for stage 2's bond collection and the BondVault's outstanding list:
/// bonds valued by the Accretion library, burned only by the `CollateralAgent` contract, rolls
/// confirmed only by the Holder and executed only while no Enforcement Notice is in effect.
contract MockAgentBondBook is IAgentBondBook {
    struct Bond {
        address holder;
        uint256 maturityAmount;
        uint256 yieldBps;
        uint256 maturity;
        bool confirmed;
        bool burned;
    }

    address public agent;
    mapping(uint256 => Bond) public bonds;
    uint256[] internal _outstanding;
    mapping(uint256 => uint256) internal _index;

    error NotAgent();
    error NotHolder();
    error InForce();
    error NotConfirmed();

    event Rolled(uint256 bondId);

    function setAgent(address a) external {
        agent = a;
    }

    function add(uint256 id, address holder, uint256 maturityAmount, uint256 yieldBps, uint256 maturity) external {
        bonds[id] = Bond(holder, maturityAmount, yieldBps, maturity, false, false);
        _outstanding.push(id);
        _index[id] = _outstanding.length;
    }

    function outstandingCount() external view returns (uint256) {
        return _outstanding.length;
    }

    function outstandingAt(uint256 i) external view returns (uint256) {
        return _outstanding[i];
    }

    function amountDueAt(uint256 id, uint256 timestamp) external view returns (uint256) {
        Bond storage b = bonds[id];
        return Accretion.accretedValue(b.maturityAmount, b.yieldBps, b.maturity, timestamp);
    }

    function holderOf(uint256 id) external view returns (address) {
        return bonds[id].holder;
    }

    function burnPaid(uint256 id) external {
        if (msg.sender != agent) revert NotAgent();
        bonds[id].burned = true;
        uint256 i = _index[id] - 1;
        uint256 last = _outstanding[_outstanding.length - 1];
        _outstanding[i] = last;
        _index[last] = i + 1;
        _outstanding.pop();
        delete _index[id];
    }

    /// @notice the Holder's roll confirmation (§4A): the Holder's own signature, nobody else's.
    function confirmRoll(uint256 id) external {
        if (msg.sender != bonds[id].holder) revert NotHolder();
        bonds[id].confirmed = true;
    }

    /// @notice executes a confirmed roll; never during an Enforcement Period (decision 19).
    function roll(uint256 id) external {
        if (!bonds[id].confirmed) revert NotConfirmed();
        if (ICollateralAgent(agent).enforcementInForce()) revert InForce();
        emit Rolled(id);
    }
}

/// @title MockAgentPledgeModule
/// @notice Test-only stand-in for stage 2's pledge module (MB-05 §6.1 permission and the Defaulted
/// Amount) and for the payee source (a registered payment Successor).
contract MockAgentPledgeModule is IAgentPledgeModule, IAgentPayee {
    address public agent;
    mapping(address => mapping(uint256 => bool)) public permitted;
    mapping(address => uint256) public defaulted;
    mapping(address => address) public payee;
    mapping(address => uint256) public applied;

    error NotAgent();

    function setAgent(address a) external {
        agent = a;
    }

    function setPermitted(address holder, uint256 bondId, bool p) external {
        permitted[holder][bondId] = p;
    }

    function setDefaulted(address holder, uint256 amount) external {
        defaulted[holder] = amount;
    }

    function setPayee(address holder, address p) external {
        payee[holder] = p;
    }

    function enforcementPermitted(address holder, uint256 bondId) external view returns (bool) {
        return permitted[holder][bondId];
    }

    function defaultedAmountOf(address holder) external view returns (uint256) {
        return defaulted[holder];
    }

    function applyDistribution(address holder, uint256, uint256 amount) external {
        if (msg.sender != agent) revert NotAgent();
        applied[holder] += amount;
        defaulted[holder] -= amount;
    }

    function payeeOf(address holder) external view returns (address) {
        address p = payee[holder];
        return p == address(0) ? holder : p;
    }
}
