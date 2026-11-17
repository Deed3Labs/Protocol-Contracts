// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "../libraries/Accretion.sol";

/// @dev The bond register: the BondVault's record of every bond since Phase 2f.
interface IHolderRegister {
    function registerLength() external view returns (uint256);
    function registerAt(uint256 i) external view returns (uint256);
    function registerEntry(uint256 bondId)
        external
        view
        returns (uint256 faceValue, uint64 maturity, uint32 yieldBps, uint64 issuedAt, uint64 endedAt, address holder);
}

/// @dev The Collateral Agent's side of a Direction.
interface IDirectionsAgent {
    struct Replacement {
        uint8 kind;
        uint8 status;
        uint64 approvedAt;
        address newAddress;
        address proposer;
        bytes32 instructionHash;
        bytes32 blockedBy;
    }

    function enforcementInForce() external view returns (bool);
    function periodCount() external view returns (uint32);
    function replacement(uint256 id) external view returns (Replacement memory);
    function recordCostApproval(bytes32 directionHash, uint256 amount) external;
    function recordHolderBlock(uint256 id, bytes32 directionHash) external;
}

/// @dev EarnControls' roles.
interface IDirectionsRoles {
    function hasRole(bytes32 role, address account) external view returns (bool);
}

/// @title HolderDirections
/// @notice Required-Holder Directions signed by the Holders themselves and counted on chain against
/// the bond register by Accreted Value (Phase 2f, decision 30): a cost approval above the Collateral
/// Agent's cap (IV-10 Exhibit A Part 3, §8.2(a)) and a block on a replacement of the Agent Key or the
/// Collateral Deposit Account (Exhibit A Part 4). Neither the Agent Key nor the treasury records them.
/// @dev **Required Holders** (IV-01 §1): Holders of more than 50% of the aggregate Accreted Value of
/// the Bonds outstanding, at the record time, excluding Bonds held by Clear Lending, Holdings, Clear
/// Capital Management LLC, their Affiliates, the Lending Board and executive officers. The record time
/// is when the Direction is opened (IV-10 §6.3). Excluded holders are the accounts holding
/// `EXCLUDED_HOLDER_ROLE` in EarnControls, granted with a Lending Board resolution through the Earn
/// timelock (Clear Lending's certified list, IV-10 §6.3); their bonds count neither for nor in the total.
///
/// How a Direction is counted:
/// - anyone opens it (`open`), fixing its kind, subject and Direction hash and the record time;
/// - each Holder signs, once per account, an EIP-712 `Direction(directionId, bondIds)` from the Smart
///   Account holding those bonds (EIP-1271); `sign` adds each bond's Accreted Value at the record time
///   (a bond counts once, must have been outstanding at the record time, and must still be held by the
///   signer);
/// - anyone runs the permissionless, batched `tally` over the register, which sums the Accreted Value
///   at the record time of every bond outstanding then, held by an account not excluded;
/// - `execute` records it on the Agent once the signed value exceeds half the total.
///
/// No admin, no upgrade and no setter: the counting rule cannot be changed without a new contract,
/// which the Agent co-signs in (`setHolderDirections`).
contract HolderDirections is EIP712 {
    bytes32 public constant DIRECTION_TYPEHASH = keccak256("Direction(bytes32 directionId,uint256[] bondIds)");
    bytes32 public constant EXCLUDED_HOLDER_ROLE = keccak256("EXCLUDED_HOLDER_ROLE");
    uint8 public constant COST_APPROVAL = 1;
    uint8 public constant BLOCK_REPLACEMENT = 2;
    /// @notice More than this share (bps) of the Accreted Value outstanding is needed.
    uint256 public constant REQUIRED_BPS = 5_000;
    uint256 internal constant BPS = 10_000;
    uint8 internal constant REPLACEMENT_OPEN = 1;
    uint8 internal constant REPLACEMENT_APPROVED = 4;

    struct Direction {
        uint8 kind;
        bool tallied;
        bool executed;
        uint32 period;
        uint64 recordTime;
        uint256 subject;
        bytes32 directionHash;
        uint256 signedValue;
        uint256 totalValue;
        uint256 cursor;
    }

    IHolderRegister public immutable register;
    IDirectionsAgent public immutable agent;
    IDirectionsRoles public immutable controls;

    mapping(bytes32 => Direction) internal _directions;
    mapping(bytes32 => mapping(uint256 => bool)) public counted;
    mapping(bytes32 => mapping(address => bool)) public signed;
    uint256 internal _nonce;

    event DirectionOpened(bytes32 indexed id, uint8 kind, uint256 subject, bytes32 directionHash, uint64 recordTime);
    event DirectionSigned(bytes32 indexed id, address indexed holder, uint256[] bondIds, uint256 value, uint256 signedValue);
    event DirectionTallied(bytes32 indexed id, uint256 cursor, uint256 totalValue, bool complete);
    event DirectionExecuted(bytes32 indexed id, uint256 signedValue, uint256 totalValue);

    error HolderDirectionsInvalid();
    error HolderDirectionsBadSignature();
    error HolderDirectionsBond(uint256 bondId);
    error HolderDirectionsNotReached(uint256 signedValue, uint256 totalValue);

    constructor(address register_, address agent_, address controls_) EIP712("HolderDirections", "1") {
        if (register_ == address(0) || agent_ == address(0) || controls_ == address(0)) revert HolderDirectionsInvalid();
        register = IHolderRegister(register_);
        agent = IDirectionsAgent(agent_);
        controls = IDirectionsRoles(controls_);
    }

    function direction(bytes32 id) external view returns (Direction memory) {
        return _directions[id];
    }

    /// @notice the EIP-712 digest a Holder signs for `bondIds` on Direction `id`.
    function directionDigest(bytes32 id, uint256[] calldata bondIds) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(DIRECTION_TYPEHASH, id, keccak256(abi.encodePacked(bondIds)))));
    }

    /// @notice opens a Direction; the record time is now. A cost approval (`subject` = the amount)
    /// only during an Enforcement Period, for that period; a block (`subject` = the replacement id)
    /// only while that replacement is pending.
    function open(uint8 kind, uint256 subject, bytes32 directionHash) external returns (bytes32 id) {
        if (directionHash == bytes32(0) || subject == 0) revert HolderDirectionsInvalid();
        uint32 period;
        if (kind == COST_APPROVAL) {
            if (!agent.enforcementInForce()) revert HolderDirectionsInvalid();
            period = agent.periodCount();
        } else if (kind == BLOCK_REPLACEMENT) {
            uint8 status = agent.replacement(subject).status;
            if (status != REPLACEMENT_OPEN && status != REPLACEMENT_APPROVED) revert HolderDirectionsInvalid();
        } else {
            revert HolderDirectionsInvalid();
        }
        id = keccak256(abi.encode(kind, subject, directionHash, ++_nonce));
        _directions[id] = Direction(kind, false, false, period, uint64(block.timestamp), subject, directionHash, 0, 0, 0);
        emit DirectionOpened(id, kind, subject, directionHash, uint64(block.timestamp));
    }

    /// @notice counts a Holder's signature for its bonds. Anyone may submit it.
    function sign(bytes32 id, address holder, uint256[] calldata bondIds, bytes calldata sig) external {
        Direction storage d = _directions[id];
        if (d.recordTime == 0 || d.executed || signed[id][holder] || _excluded(holder) || bondIds.length == 0) {
            revert HolderDirectionsInvalid();
        }
        if (!SignatureChecker.isValidSignatureNow(holder, directionDigest(id, bondIds), sig)) {
            revert HolderDirectionsBadSignature();
        }
        signed[id][holder] = true;
        uint256 value;
        for (uint256 i; i < bondIds.length; ++i) {
            uint256 bondId = bondIds[i];
            (uint256 face, uint64 maturity, uint32 y, uint64 issuedAt, uint64 endedAt, address h) =
                register.registerEntry(bondId);
            if (h != holder || endedAt != 0 || issuedAt == 0 || issuedAt > d.recordTime || counted[id][bondId]) {
                revert HolderDirectionsBond(bondId);
            }
            counted[id][bondId] = true;
            value += Accretion.accretedValue(face, y, maturity, d.recordTime);
        }
        d.signedValue += value;
        emit DirectionSigned(id, holder, bondIds, value, d.signedValue);
    }

    /// @notice sums the Accreted Value at the record time of every bond outstanding then and not held
    /// by an excluded account, over up to `maxCount` register entries. Permissionless and batched.
    function tally(bytes32 id, uint256 maxCount) external {
        Direction storage d = _directions[id];
        if (d.recordTime == 0 || d.tallied) revert HolderDirectionsInvalid();
        uint256 n = register.registerLength();
        uint256 i = d.cursor;
        uint256 end = i + maxCount < n ? i + maxCount : n;
        uint256 total = d.totalValue;
        uint64 t = d.recordTime;
        for (; i < end; ++i) {
            (uint256 face, uint64 maturity, uint32 y, uint64 issuedAt, uint64 endedAt, address h) =
                register.registerEntry(register.registerAt(i));
            if (issuedAt > t || (endedAt != 0 && endedAt <= t) || (h != address(0) && _excluded(h))) continue;
            total += Accretion.accretedValue(face, y, maturity, t);
        }
        d.cursor = end;
        d.totalValue = total;
        if (end == n) d.tallied = true;
        emit DirectionTallied(id, end, total, end == n);
    }

    /// @notice records a Direction on the Collateral Agent once the Required Holders have signed it.
    function execute(bytes32 id) external {
        Direction storage d = _directions[id];
        if (!d.tallied || d.executed) revert HolderDirectionsInvalid();
        if (d.totalValue == 0 || d.signedValue * BPS <= d.totalValue * REQUIRED_BPS) {
            revert HolderDirectionsNotReached(d.signedValue, d.totalValue);
        }
        d.executed = true;
        emit DirectionExecuted(id, d.signedValue, d.totalValue);
        if (d.kind == COST_APPROVAL) {
            if (agent.periodCount() != d.period) revert HolderDirectionsInvalid();
            agent.recordCostApproval(d.directionHash, d.subject);
        } else {
            agent.recordHolderBlock(d.subject, d.directionHash);
        }
    }

    function _excluded(address holder) internal view returns (bool) {
        return controls.hasRole(EXCLUDED_HOLDER_ROLE, holder);
    }
}
