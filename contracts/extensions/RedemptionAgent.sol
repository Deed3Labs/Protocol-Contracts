// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../core/interfaces/IDeedCustody.sol";
import "../core/interfaces/IDeedTrust.sol";

interface IHousingRedemption {
    function occupantOf(uint256 homeId) external view returns (address);
    function markRedeemed(uint256 homeId) external returns (address member);
}

/**
 * @title RedemptionAgent
 * @notice Holds a home's Clear Deed while its member pays toward it, and hands it to them the moment their
 *         Housing Allowance reaches the price.
 * @dev A Coop-policy trust deed leaves its holder only through a registered Coop agent, so this contract is
 *      registered in the FunctionalContractRegistry as custody plus Coop agent, like the CoopTransferAgent.
 *      The program sponsor deposits a home's deed naming the member whose live record the
 *      HousingAllowanceRecord holds for it. `redeemHome` asks the record to mark the home redeemed -- the
 *      record refuses unless the member's Housing Allowance has reached the price -- and sends the deed to
 *      that member. Redemption is the sponsor's own transfer, so there is no first refusal to wait on; later
 *      sales by the member go through the CoopTransferAgent and its window as usual.
 *
 *      If the record stops being live (the member moved or left), the depositor takes the deed back for the
 *      next member. Holds no funds, moves none, has no admin and is not upgradeable.
 */
contract RedemptionAgent is IERC721Receiver, IDeedCustody, ReentrancyGuard {
    struct Hold {
        address depositor;
        address member;
    }

    /// @notice The DeedNFT this agent serves.
    address public immutable deedNFT;
    /// @notice The HousingAllowanceRecord whose `isRedeemable` decides when a deed may go.
    IHousingRedemption public immutable housingRecord;

    mapping(uint256 => Hold) private _holds;

    event Deposited(uint256 indexed homeId, address indexed depositor, address indexed member);
    event Redeemed(uint256 indexed homeId, address indexed member);
    event Released(uint256 indexed homeId, address indexed depositor);

    error NotDeedNFT();
    error NotCoopDeed();
    error NotOccupant(uint256 homeId, address member);
    error NotHeld(uint256 homeId);
    error NotDepositor();
    error NotSponsor(address from);
    error StillLive(uint256 homeId);
    error WrongMember(uint256 homeId, address member);

    constructor(address deedNFT_, address housingRecord_) {
        deedNFT = deedNFT_;
        housingRecord = IHousingRedemption(housingRecord_);
    }

    /**
     * @notice The sponsor deposits a home's deed: DeedNFT.safeTransferFrom(sponsor, agent, homeId,
     *         abi.encode(member)). The member must hold the live record for that home.
     */
    function onERC721Received(address, address from, uint256 tokenId, bytes calldata data) external returns (bytes4) {
        if (msg.sender != deedNFT) revert NotDeedNFT();
        IDeedTrust.TrustRecord memory r = IDeedTrust(deedNFT).trustRecordOf(tokenId);
        if (r.agreementHash == bytes32(0) || r.transferPolicy != 2) revert NotCoopDeed();
        if (from != r.programSponsor) revert NotSponsor(from);
        address member = abi.decode(data, (address));
        if (member == address(0) || housingRecord.occupantOf(tokenId) != member) revert NotOccupant(tokenId, member);
        _holds[tokenId] = Hold(from, member);
        emit Deposited(tokenId, from, member);
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice Hands the deed to its member once their Housing Allowance has reached the price. Anyone may call.
    function redeemHome(uint256 homeId) external nonReentrant {
        Hold memory h = _holds[homeId];
        if (h.depositor == address(0)) revert NotHeld(homeId);
        address member = housingRecord.markRedeemed(homeId);
        if (member != h.member) revert WrongMember(homeId, member);
        delete _holds[homeId];
        IERC721(deedNFT).transferFrom(address(this), member, homeId);
        emit Redeemed(homeId, member);
    }

    /// @notice The depositor takes the deed back once the member's record is no longer live on the home.
    function release(uint256 homeId) external nonReentrant {
        Hold memory h = _holds[homeId];
        if (h.depositor == address(0)) revert NotHeld(homeId);
        if (msg.sender != h.depositor) revert NotDepositor();
        if (housingRecord.occupantOf(homeId) == h.member) revert StillLive(homeId);
        delete _holds[homeId];
        IERC721(deedNFT).transferFrom(address(this), h.depositor, homeId);
        emit Released(homeId, h.depositor);
    }

    /// @inheritdoc IDeedCustody
    function beneficialOwnerOf(uint256 tokenId) external view returns (address) {
        return _holds[tokenId].depositor;
    }

    function holdOf(uint256 homeId) external view returns (Hold memory) {
        return _holds[homeId];
    }
}
