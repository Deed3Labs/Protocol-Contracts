// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @title BondTraits
/// @notice The metadata a bond carries, kept somewhere a bond has room for it.
/// @dev Lifted out of BurnerBond, which had reached the size a contract may be. Everything here
/// is display: what a bond is worth, when it matures, who holds it, rendered for anything that
/// wants to show a bond to somebody. None of it decides whether a bond can be issued or redeemed,
/// which is the argument for it living somewhere else -- a contract at its ceiling should shed
/// what it does not need to be correct before it sheds anything it does.
///
/// Keyed by the collection that wrote it, so every bond collection shares this one deployment
/// rather than each carrying a copy. Writes come from the collection itself and reads from
/// anywhere.
contract BondTraits {
    /// @dev collection => bondId => trait key => value
    mapping(address => mapping(uint256 => mapping(bytes32 => bytes))) private values;
    /// @dev collection => every key it has ever written
    mapping(address => bytes32[]) private keys;
    /// @dev collection => key => already recorded
    mapping(address => mapping(bytes32 => bool)) private known;
    /// @dev collection => key => name, for keys that are not one of the standard set
    mapping(address => mapping(bytes32 => string)) private customNames;

    event TraitSet(address indexed collection, uint256 indexed bondId, bytes32 indexed key);
    event TraitRemoved(address indexed collection, uint256 indexed bondId, bytes32 indexed key);

    /* ========== WRITES ========== */

    /// @notice records a trait against a bond.
    /// @dev The caller is the collection, which is why there is no collection argument. A bond
    /// contract can only write its own bonds' traits.
    function setTrait(uint256 bondId, bytes32 key, bytes calldata value) external {
        _register(msg.sender, key);
        values[msg.sender][bondId][key] = value;
        emit TraitSet(msg.sender, bondId, key);
    }

    /// @notice records several traits against a bond in one call.
    /// @dev Minting sets a dozen at once, and a dozen calls to set them would be a dozen calls.
    function setTraits(uint256 bondId, bytes32[] calldata traitKeys, bytes[] calldata traitValues)
        external
    {
        for (uint256 i = 0; i < traitKeys.length; i++) {
            _register(msg.sender, traitKeys[i]);
            values[msg.sender][bondId][traitKeys[i]] = traitValues[i];
            emit TraitSet(msg.sender, bondId, traitKeys[i]);
        }
    }

    /// @notice names a key that is not one of the standard set.
    function setCustomName(bytes32 key, string calldata name) external {
        customNames[msg.sender][key] = name;
    }

    function removeTrait(uint256 bondId, bytes32 key) external {
        delete values[msg.sender][bondId][key];
        emit TraitRemoved(msg.sender, bondId, key);
    }

    function _register(address collection, bytes32 key) private {
        if (known[collection][key]) return;
        known[collection][key] = true;
        keys[collection].push(key);
    }

    /* ========== READS ========== */

    function traitOf(address collection, uint256 bondId, bytes32 key)
        external
        view
        returns (bytes memory)
    {
        return values[collection][bondId][key];
    }

    function traitsOf(address collection, uint256 bondId, bytes32[] calldata traitKeys)
        external
        view
        returns (bytes[] memory found)
    {
        found = new bytes[](traitKeys.length);
        for (uint256 i = 0; i < traitKeys.length; i++) {
            found[i] = values[collection][bondId][traitKeys[i]];
        }
    }

    /// @notice every key a bond actually has a value for.
    function keysOf(address collection, uint256 bondId)
        external
        view
        returns (bytes32[] memory present)
    {
        bytes32[] storage all = keys[collection];
        uint256 count;
        for (uint256 i = 0; i < all.length; i++) {
            if (values[collection][bondId][all[i]].length > 0) count++;
        }
        present = new bytes32[](count);
        uint256 index;
        for (uint256 i = 0; i < all.length; i++) {
            if (values[collection][bondId][all[i]].length > 0) present[index++] = all[i];
        }
    }

    /// @notice the display name for a key.
    /// @dev The standard names are the same for every collection that will ever exist, so they
    /// are answered from code. Anything else was named by whoever registered it.
    function nameOf(address collection, bytes32 key) external view returns (string memory) {
        if (key == keccak256("faceValue")) return "Face Value";
        if (key == keccak256("maturityDate")) return "Maturity Date";
        if (key == keccak256("discountPercentage")) return "Discount Percentage";
        if (key == keccak256("purchasePrice")) return "Purchase Price";
        if (key == keccak256("creator")) return "Creator";
        if (key == keccak256("currentHolder")) return "Current Holder";
        if (key == keccak256("isRedeemed")) return "Is Redeemed";
        if (key == keccak256("terms")) return "Terms";
        if (key == keccak256("bondType")) return "Bond Type";
        if (key == keccak256("issuer")) return "Issuer";
        if (key == keccak256("createdAt")) return "Created At";
        if (key == keccak256("redeemedAt")) return "Redeemed At";
        return customNames[collection][key];
    }
}
