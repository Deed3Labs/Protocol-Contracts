// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";

/**
 * @title MockMarketplace
 * @dev A mock marketplace contract for testing purposes that handles royalties like OpenSea
 */
contract MockMarketplace is IERC721Receiver {
    using SafeERC20 for IERC20;

    // Mapping to track listed NFTs
    struct Listing {
        address seller;
        address paymentToken;
        uint256 price;
        bool isActive;
    }
    mapping(address => mapping(uint256 => Listing)) public listings;

    // Events
    event NFTListed(address indexed nftContract, uint256 indexed tokenId, address indexed seller, address paymentToken, uint256 price);
    event NFTSold(address indexed nftContract, uint256 indexed tokenId, address indexed seller, address buyer, address paymentToken, uint256 price, uint256 royaltyAmount);
    event NFTUnlisted(address indexed nftContract, uint256 indexed tokenId, address indexed seller);

    /**
     * @dev Handles the receipt of an NFT
     * @return The selector of this function (0x150b7a02)
     */
    function onERC721Received(
        address,
        address,
        uint256,
        bytes memory
    ) external pure override returns (bytes4) {
        return this.onERC721Received.selector;
    }

    /**
     * @dev List an NFT for sale
     * @param nftContract The NFT contract address
     * @param tokenId The token ID
     * @param paymentToken The token to accept as payment (address(0) for ETH)
     * @param price The sale price
     */
    function listNFT(
        address nftContract,
        uint256 tokenId,
        address paymentToken,
        uint256 price
    ) external {
        require(price > 0, "Price must be greater than 0");
        require(IERC721(nftContract).ownerOf(tokenId) == msg.sender, "Not token owner");
        require(IERC721(nftContract).getApproved(tokenId) == address(this), "Marketplace not approved");

        // Transfer NFT to marketplace
        IERC721(nftContract).transferFrom(msg.sender, address(this), tokenId);

        // Create listing
        listings[nftContract][tokenId] = Listing({
            seller: msg.sender,
            paymentToken: paymentToken,
            price: price,
            isActive: true
        });

        emit NFTListed(nftContract, tokenId, msg.sender, paymentToken, price);
    }

    /**
     * @dev Unlist an NFT
     * @param nftContract The NFT contract address
     * @param tokenId The token ID
     */
    function unlistNFT(address nftContract, uint256 tokenId) external {
        Listing storage listing = listings[nftContract][tokenId];
        require(listing.isActive, "Not listed");
        require(listing.seller == msg.sender, "Not seller");

        // Return NFT to seller
        IERC721(nftContract).transferFrom(address(this), msg.sender, tokenId);

        // Remove listing
        delete listings[nftContract][tokenId];

        emit NFTUnlisted(nftContract, tokenId, msg.sender);
    }

    /**
     * @dev Buy an NFT
     * @param nftContract The NFT contract address
     * @param tokenId The token ID
     */
    function buyNFT(address nftContract, uint256 tokenId) external payable {
        Listing storage listing = listings[nftContract][tokenId];
        require(listing.isActive, "Not listed");
        require(listing.seller != msg.sender, "Cannot buy own NFT");

        // Handle payment
        if (listing.paymentToken == address(0)) {
            // ETH payment
            require(msg.value == listing.price, "Incorrect ETH amount");
        } else {
            // ERC20 payment
            require(msg.value == 0, "ETH not accepted");
            IERC20(listing.paymentToken).safeTransferFrom(msg.sender, address(this), listing.price);
        }

        // Calculate and handle royalties
        uint256 royaltyAmount = 0;
        if (IERC165(nftContract).supportsInterface(type(IERC2981).interfaceId)) {
            (address receiver, uint256 amount) = IERC2981(nftContract).royaltyInfo(tokenId, listing.price);
            if (amount > 0 && receiver != address(0)) {
                royaltyAmount = amount;
                if (listing.paymentToken == address(0)) {
                    // Send ETH royalties
                    (bool success, ) = receiver.call{value: amount}("");
                    require(success, "Royalty transfer failed");
                } else {
                    // Send ERC20 royalties
                    IERC20(listing.paymentToken).safeTransfer(receiver, amount);
                }
            }
        }

        // Transfer remaining amount to seller
        uint256 sellerAmount = listing.price - royaltyAmount;
        if (listing.paymentToken == address(0)) {
            // Send remaining ETH to seller
            (bool success, ) = listing.seller.call{value: sellerAmount}("");
            require(success, "Seller transfer failed");
        } else {
            // Send remaining ERC20 to seller
            IERC20(listing.paymentToken).safeTransfer(listing.seller, sellerAmount);
        }

        // Transfer NFT to buyer
        IERC721(nftContract).transferFrom(address(this), msg.sender, tokenId);

        // Remove listing
        delete listings[nftContract][tokenId];

        emit NFTSold(nftContract, tokenId, listing.seller, msg.sender, listing.paymentToken, listing.price, royaltyAmount);
    }

    /**
     * @dev Get listing details
     * @param nftContract The NFT contract address
     * @param tokenId The token ID
     * @return seller The seller's address
     * @return paymentToken The payment token address
     * @return price The listing price
     * @return isActive Whether the listing is active
     */
    function getListing(address nftContract, uint256 tokenId) external view returns (
        address seller,
        address paymentToken,
        uint256 price,
        bool isActive
    ) {
        Listing storage listing = listings[nftContract][tokenId];
        return (listing.seller, listing.paymentToken, listing.price, listing.isActive);
    }
} 