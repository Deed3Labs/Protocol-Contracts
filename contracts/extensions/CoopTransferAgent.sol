// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "../core/interfaces/IDeedTrust.sol";
import "../core/interfaces/IDeedCustody.sol";

/**
 * @title CoopTransferAgent
 * @notice The only route by which a Coop-policy trust deed changes hands (trust agreement v5, item 9). The
 *         seller deposits the deed naming a buyer and a terms hash; the program sponsor then has a
 *         right-of-first-refusal window (the deed's rofrPeriodDays, default 30) to take the sale for itself
 *         or a designee at the same terms. When the window closes, or once the sponsor exercises or waives,
 *         the seller completes the sale within the completion window (completionWindowDays, default 90),
 *         or withdraws the deed at any time before completion.
 * @dev Holds no funds and moves none: the price settles off chain or through other contracts, and nothing
 *      here can pay a trustee (Addendum 2). The seller confirms closing by calling `complete`. Registered in
 *      the FunctionalContractRegistry as custody plus Coop agent, so DeedNFT lets deeds in (item 9(c)) and lets
 *      this contract send them on (Coop policy). Not upgradeable and has no admin.
 */
contract CoopTransferAgent is IERC721Receiver, IDeedCustody, ReentrancyGuard {
    struct Listing {
        address seller;
        address buyer;          // the named buyer, or the sponsor's designee after exercise
        bytes32 termsHash;
        uint64 rofrEndsAt;
        uint64 completeBy;
        bool exercised;
    }

    /// @notice The DeedNFT this agent serves.
    address public immutable deedNFT;

    mapping(uint256 => Listing) private _listings;

    event Listed(uint256 indexed tokenId, address indexed seller, address indexed buyer, bytes32 termsHash, uint64 rofrEndsAt, uint64 completeBy);
    event RofrExercised(uint256 indexed tokenId, address indexed sponsor, address indexed designee, uint64 completeBy);
    event RofrWaived(uint256 indexed tokenId, address indexed sponsor, uint64 completeBy);
    event Completed(uint256 indexed tokenId, address indexed seller, address indexed buyer, bytes32 termsHash);
    event Withdrawn(uint256 indexed tokenId, address indexed seller);
    event Recovered(uint256 indexed tokenId, address indexed to);

    error NotDeedNFT();
    error NotCoopDeed();
    error InvalidBuyer();
    error NotListed();
    error NotSeller();
    error NotSponsor();
    error WindowClosed();
    error WindowOpen();
    error CompletionLapsed();
    error StillListed();

    constructor(address deedNFT_) {
        deedNFT = deedNFT_;
    }

    /**
     * @notice Lists a deed: the holder calls DeedNFT.safeTransferFrom(holder, agent, tokenId,
     *         abi.encode(buyer, termsHash)). The deed must be a Coop-policy trust deed.
     */
    function onERC721Received(address, address from, uint256 tokenId, bytes calldata data) external returns (bytes4) {
        if (msg.sender != deedNFT) revert NotDeedNFT();
        IDeedTrust.TrustRecord memory r = IDeedTrust(deedNFT).trustRecordOf(tokenId);
        if (r.agreementHash == bytes32(0) || r.transferPolicy != 2) revert NotCoopDeed();
        (address buyer, bytes32 termsHash) = abi.decode(data, (address, bytes32));
        if (buyer == address(0) || buyer == from || buyer == address(this)) revert InvalidBuyer();

        uint64 rofrEndsAt = uint64(block.timestamp + uint256(r.rofrPeriodDays) * 1 days);
        uint64 completeBy = rofrEndsAt + uint64(uint256(r.completionWindowDays) * 1 days);
        _listings[tokenId] = Listing(from, buyer, termsHash, rofrEndsAt, completeBy, false);
        emit Listed(tokenId, from, buyer, termsHash, rofrEndsAt, completeBy);
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice The program sponsor takes the sale for itself or a designee at the listed terms, within the window.
    function exercise(uint256 tokenId, address designee) external {
        Listing storage l = _listed(tokenId);
        _requireSponsor(tokenId);
        if (l.exercised || block.timestamp >= l.rofrEndsAt) revert WindowClosed();
        if (designee == address(0) || designee == l.seller) revert InvalidBuyer();
        l.buyer = designee;
        l.exercised = true;
        l.completeBy = uint64(block.timestamp + uint256(IDeedTrust(deedNFT).trustRecordOf(tokenId).completionWindowDays) * 1 days);
        emit RofrExercised(tokenId, msg.sender, designee, l.completeBy);
    }

    /// @notice The program sponsor declines early; the seller may complete with the named buyer at once.
    function waive(uint256 tokenId) external {
        Listing storage l = _listed(tokenId);
        _requireSponsor(tokenId);
        if (l.exercised || block.timestamp >= l.rofrEndsAt) revert WindowClosed();
        l.rofrEndsAt = uint64(block.timestamp);
        l.completeBy = uint64(block.timestamp + uint256(IDeedTrust(deedNFT).trustRecordOf(tokenId).completionWindowDays) * 1 days);
        emit RofrWaived(tokenId, msg.sender, l.completeBy);
    }

    /// @notice The seller confirms closing: the deed goes to the buyer (or the sponsor's designee).
    function complete(uint256 tokenId) external nonReentrant {
        Listing memory l = _listed(tokenId);
        if (msg.sender != l.seller) revert NotSeller();
        if (!l.exercised && block.timestamp < l.rofrEndsAt) revert WindowOpen();
        if (block.timestamp > l.completeBy) revert CompletionLapsed();
        delete _listings[tokenId];
        IERC721(deedNFT).transferFrom(address(this), l.buyer, tokenId);
        emit Completed(tokenId, l.seller, l.buyer, l.termsHash);
    }

    /// @notice The seller takes the deed back at any time before completion (it returns to where it came from).
    function withdraw(uint256 tokenId) external nonReentrant {
        Listing memory l = _listed(tokenId);
        if (msg.sender != l.seller) revert NotSeller();
        delete _listings[tokenId];
        IERC721(deedNFT).transferFrom(address(this), l.seller, tokenId);
        emit Withdrawn(tokenId, l.seller);
    }

    /// @notice A deed sent here without a listing (plain transferFrom) goes back to where it came from.
    function recover(uint256 tokenId) external nonReentrant {
        if (_listings[tokenId].seller != address(0)) revert StillListed();
        address to = IDeedTrust(deedNFT).lastFromOf(tokenId);
        IERC721(deedNFT).transferFrom(address(this), to, tokenId);
        emit Recovered(tokenId, to);
    }

    /// @inheritdoc IDeedCustody
    function beneficialOwnerOf(uint256 tokenId) external view returns (address) {
        return _listings[tokenId].seller;
    }

    function listingOf(uint256 tokenId) external view returns (Listing memory) {
        return _listings[tokenId];
    }

    function _listed(uint256 tokenId) private view returns (Listing storage l) {
        l = _listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
    }

    function _requireSponsor(uint256 tokenId) private view {
        if (msg.sender != IDeedTrust(deedNFT).trustRecordOf(tokenId).programSponsor) revert NotSponsor();
    }
}
