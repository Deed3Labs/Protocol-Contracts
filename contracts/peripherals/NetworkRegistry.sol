// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "../core/interfaces/stable-credit/INetworkRegistry.sol";

/// @title NetworkRegistry
/// @notice The parent registry every issuer is registered against.
/// @dev Deliberately thin. It resolves issuer to network and member to issuers, and does nothing
/// else -- LimitCalculator, the app and the snapshot service all look up through here, so adding
/// a second network later is a registration rather than a refactor.
///
/// What it does not do is as important. There is no per-issuer reserve, no loss attribution and
/// no risk segregation, because the shape of those is not knowable until an issuer the co-op does
/// not run actually exists. What is built now is only the part that would be expensive to retrofit:
/// a member maps to a *set* of issuers, so no caller can grow a dependency on there being one.
contract NetworkRegistry is
    INetworkRegistry,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @dev issuer => the network it is wired to
    mapping(address => Network) private networks;
    /// @dev issuer => registered
    mapping(address => bool) private registered;
    /// @dev member => issuers the member holds a position with
    mapping(address => address[]) private memberIssuers;
    /// @dev member => issuer => enrolled
    mapping(address => mapping(address => bool)) private enrolled;
    /// @dev issuer => how many members are enrolled with it
    mapping(address => uint256) public enrolledCount;

    /// @dev Reserved so state can be added without disturbing the layout of anything that
    /// inherits from this contract later.
    /// @notice Each member's home state (two-letter code as bytes32, e.g. "CA"), as attested.
    /// @dev Compliance spec item 9. What a member may be offered, and at what price, depends on
    /// where they live; the RateSchedule is read by this code. Set only by the trusted attestation
    /// signer, never by the member or an operator key. Appended from the gap.
    mapping(address => bytes32) public stateCodeOf;

    /// @notice System contracts that sit on a money path, by kind (CLRUSD, the ESA vault, the
    /// pledge module, the ledger, the payout and yield pools, the bond vault, the liquidator).
    /// @dev Compliance section 13c. The AssurancePool reads this, with `isIssuer`, to refuse a
    /// deposit from any of them. Set once per address by the admin (the credit timelock), and never
    /// cleared: an entry only ever narrows who may pay the pool. Appended from the gap.
    mapping(address => bytes32) public moneyPathKindOf;

    uint256[43] private __gap;

    /// @notice May attest a member's state of residence. The trusted signer, and nothing else.
    bytes32 public constant STATE_ATTESTER_ROLE = keccak256("STATE_ATTESTER_ROLE");

    error NetworkRegistryInvalidAddress();
    error NetworkRegistryInvalidStateCode();
    error NetworkRegistryMoneyPathSet(address account);

    /// @notice a system contract was listed as sitting on a money path.
    event MoneyPathListed(address indexed account, bytes32 indexed kind);

    /// @notice a member's state of residence was attested.
    event StateCodeAttested(address indexed member, bytes32 stateCode, address indexed attester);
    error NetworkRegistryIssuerAlreadyRegistered(address issuer);
    error NetworkRegistryUnknownIssuer(address issuer);
    error NetworkRegistryUnauthorized(address caller);
    error NetworkRegistryMemberStillEnrolled(address issuer);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param admin address to grant admin and operator access.
    function initialize(address admin) external initializer {
        if (admin == address(0)) revert NetworkRegistryInvalidAddress();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}

    /* ========== VIEWS ========== */

    /// @inheritdoc INetworkRegistry
    function networkOf(address issuer) external view override returns (Network memory) {
        if (!registered[issuer]) revert NetworkRegistryUnknownIssuer(issuer);
        return networks[issuer];
    }

    /// @inheritdoc INetworkRegistry
    function isIssuer(address issuer) public view override returns (bool) {
        return registered[issuer];
    }

    /// @inheritdoc INetworkRegistry
    function isIssuerOf(address issuer, address stableCredit)
        external
        view
        override
        returns (bool)
    {
        return registered[issuer] && networks[issuer].stableCredit == stableCredit;
    }

    /// @inheritdoc INetworkRegistry
    function issuersOf(address member) external view override returns (address[] memory) {
        return memberIssuers[member];
    }

    /// @inheritdoc INetworkRegistry
    function isEnrolled(address member, address issuer) public view override returns (bool) {
        return enrolled[member][issuer];
    }

    /// @notice whether `account` is a credit issuer or a listed money-path contract (section 13c).
    function isMoneyPath(address account) external view returns (bool) {
        return registered[account] || moneyPathKindOf[account] != bytes32(0);
    }

    /// @notice how many issuers a member holds a position with.
    function issuerCountOf(address member) external view returns (uint256) {
        return memberIssuers[member].length;
    }

    /// @notice how many members are enrolled with an issuer.
    function enrolledCountOf(address issuer) public view returns (uint256) {
        return enrolledCount[issuer];
    }

    /// @dev Who may record a member against an issuer: the issuer itself, the ledger it writes to,
    /// or an operator. The ledger is included because opening a credit line is exactly where the
    /// relationship begins, and requiring a second transaction to say so invites the two to
    /// disagree.
    function _mayRecordFor(address issuer) private view returns (bool) {
        return msg.sender == issuer || msg.sender == networks[issuer].stableCredit
            || hasRole(OPERATOR_ROLE, msg.sender);
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    /// @notice registers an issuer against a network.
    /// @dev Phase 2c: an issuer is wired to its ledger and nothing else. It draws on no reserve, and
    /// the network's two retired fields (the old AssurancePool and AssuranceOracle) stay zero.
    /// @param issuer address of the issuer contract.
    /// @param stableCredit the ledger it writes to.
    function registerIssuer(address issuer, address stableCredit) external onlyRole(OPERATOR_ROLE) {
        if (issuer == address(0) || stableCredit == address(0)) revert NetworkRegistryInvalidAddress();
        if (registered[issuer]) revert NetworkRegistryIssuerAlreadyRegistered(issuer);

        networks[issuer] = Network(stableCredit, address(0), address(0));
        registered[issuer] = true;
        emit IssuerRegistered(issuer, stableCredit);
    }

    /// @notice lists a system contract as sitting on a money path, so it can never pay the
    /// AssurancePool (section 13c).
    /// @dev Admin only, once per address, and never undone: the list only narrows.
    /// @param account the contract.
    /// @param kind what it is, e.g. "CLRUSD", "ESA_VAULT", "PLEDGE", "PAYOUT_POOL".
    function listMoneyPath(address account, bytes32 kind) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0) || kind == bytes32(0)) revert NetworkRegistryInvalidAddress();
        if (moneyPathKindOf[account] != bytes32(0)) revert NetworkRegistryMoneyPathSet(account);
        moneyPathKindOf[account] = kind;
        emit MoneyPathListed(account, kind);
    }

    /// @notice removes an issuer.
    /// @dev Refuses while the issuer still has members enrolled. Deregistering underneath a live
    /// position would strand it: the ledger would stop recognising the issuer that owns it, and
    /// nothing could adjust or close it.
    /// @param issuer address of the issuer to remove.
    function deregisterIssuer(address issuer) external onlyRole(OPERATOR_ROLE) {
        if (!registered[issuer]) revert NetworkRegistryUnknownIssuer(issuer);
        if (enrolledCountOf(issuer) > 0) revert NetworkRegistryMemberStillEnrolled(issuer);

        delete networks[issuer];
        registered[issuer] = false;
        emit IssuerDeregistered(issuer);
    }

    /// @notice enrols a member with an issuer.
    /// @dev Callable by the issuer itself, so opening a position registers the relationship
    /// without a second operator transaction, or by an operator.
    /// @param member address of the member.
    /// @param issuer address of the issuer.
    function enrolMember(address member, address issuer) external override {
        if (member == address(0)) revert NetworkRegistryInvalidAddress();
        if (!registered[issuer]) revert NetworkRegistryUnknownIssuer(issuer);
        if (!_mayRecordFor(issuer)) revert NetworkRegistryUnauthorized(msg.sender);
        if (enrolled[member][issuer]) return;

        enrolled[member][issuer] = true;
        memberIssuers[member].push(issuer);
        enrolledCount[issuer] += 1;
        emit MemberEnrolled(member, issuer);
    }

    /// @notice removes a member from an issuer.
    /// @param member address of the member.
    /// @param issuer address of the issuer.
    function withdrawMember(address member, address issuer) external override {
        if (!_mayRecordFor(issuer)) revert NetworkRegistryUnauthorized(msg.sender);
        if (!enrolled[member][issuer]) return;

        enrolled[member][issuer] = false;
        enrolledCount[issuer] -= 1;

        address[] storage list = memberIssuers[member];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == issuer) {
                list[i] = list[list.length - 1];
                list.pop();
                break;
            }
        }
        emit MemberWithdrawn(member, issuer);
    }


    /// @notice records a member's state of residence, as attested by the trusted signer.
    /// @dev The attestation is what an issuer's state gate and the vault's pilot cap read. It
    /// cannot move a member's funds or change what they owe (spec 10a, test 14): it only decides
    /// which products may be offered to them from here on.
    /// @param member address of the member.
    /// @param stateCode two-letter state code as bytes32; zero is not a state.
    function attestStateCode(address member, bytes32 stateCode)
        external
        onlyRole(STATE_ATTESTER_ROLE)
    {
        if (member == address(0)) revert NetworkRegistryInvalidAddress();
        if (stateCode == bytes32(0)) revert NetworkRegistryInvalidStateCode();
        stateCodeOf[member] = stateCode;
        emit StateCodeAttested(member, stateCode, msg.sender);
    }
}
