// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import {SignatureCheckerUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/SignatureCheckerUpgradeable.sol";

import "./DeedNFTBase.sol";
import "./interfaces/IValidatorRegistry.sol";
import "./interfaces/IDeedCustody.sol";
import "./interfaces/IFunctionalContractRegistry.sol";
import "./interfaces/stable-credit/IMembershipRegistry.sol";

/// @dev Narrow Validator view for audit D-1 (kept out of IValidator so its interface ID is unchanged).
interface IValidatorTraitPolicy {
    function isRequiredTrait(uint256 assetTypeId, bytes32 traitKey) external view returns (bool);
}

/// @dev Agreement versions a Validator has adopted, per asset type (DECISIONS, Addendum 1 item 4).
interface IAgreementAdoption {
    function agreementVersionURI(uint256 assetTypeId, bytes32 versionHash) external view returns (string memory);
}

/// @dev ValidatorRegistry's trustee eligibility (Addendum 1 and 2).
interface ITrusteeRegistry {
    function isEligibleTrustee(address account) external view returns (bool);
}

/// @dev MembershipRegistry's record lookup (DECISIONS #9). Not on IMembershipRegistry, which is credit-side.
interface IMemberLookup {
    function getMemberByWallet(address wallet) external view returns (IMembershipRegistry.MemberRecord memory);
}

/// @dev Lets DeedNFT's constructor check it was given the right extension for each slot.
interface IDeedNFTExtensionKind {
    function deedExtensionKind() external pure returns (bytes32);
}

/**
 * @title DeedTrustCommon
 * @notice Constants and internals shared by DeedNFT's two extensions (DeedNFTMintExtension and
 *         DeedTrustExtension). Internal only: each extension compiles just what it uses.
 */
abstract contract DeedTrustCommon is DeedNFTBase {
    bytes32 internal constant MINT_EXTENSION_KIND = keccak256("DeedNFTMintExtension.v5");
    bytes32 internal constant TRUST_EXTENSION_KIND = keccak256("DeedTrustExtension.v5");

    uint8 internal constant POLICY_OPEN = 0;
    uint8 internal constant POLICY_VERIFIED = 1;
    uint8 internal constant POLICY_COOP = 2;

    uint8 internal constant STATUS_ACTIVE = 0;
    uint8 internal constant STATUS_RETIRED = 1;
    uint8 internal constant STATUS_VOID = 2;

    /// @dev Void reason codes below this leave the token transferable; codes from it freeze the token.
    uint8 internal constant VOID_FREEZES_FROM = 128;

    uint8 internal constant KIND_COOP_AGENT = 2;

    uint16 internal constant DEFAULT_ROFR_DAYS = 30;
    uint16 internal constant DEFAULT_COMPLETION_DAYS = 90;

    bytes32 internal constant KEY_AGREEMENT_HASH = keccak256("agreementHash");
    bytes32 internal constant KEY_RIDER_HASHES = keccak256("riderHashes");
    bytes32 internal constant KEY_TRUSTEE = keccak256("trustee");
    bytes32 internal constant KEY_PROTECTOR = keccak256("protector");
    bytes32 internal constant KEY_STANDBY = keccak256("standbyTrustee");
    bytes32 internal constant KEY_SUSPENDED = keccak256("trusteeSuspended");
    bytes32 internal constant KEY_TRANSFER_POLICY = keccak256("transferPolicy");
    bytes32 internal constant KEY_STATUS = keccak256("status");
    bytes32 internal constant KEY_PROGRAM_ID = keccak256("programId");
    bytes32 internal constant KEY_PROGRAM_SPONSOR = keccak256("programSponsor");
    bytes32 internal constant KEY_TITLE_ADMIN = keccak256("titleAdministrator");
    bytes32 internal constant KEY_PROGRAM_PARAMS = keccak256("programParams");
    bytes32 internal constant KEY_MINT_PARAMS = keccak256("mintParamsHash");

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant TRUSTEE_ACCEPTANCE_TYPEHASH =
        keccak256("TrusteeAcceptance(uint256 tokenId,address trustee,uint256 nonce)");
    bytes32 internal constant STANDBY_ACCEPTANCE_TYPEHASH =
        keccak256("StandbyAcceptance(uint256 tokenId,address standby,uint256 nonce)");
    bytes32 internal constant AGREEMENT_CONSENT_TYPEHASH =
        keccak256("AgreementConsent(uint256 tokenId,bytes32 agreementHash,bytes32 ridersHash,uint256 nonce)");
    bytes32 internal constant CORRECTION_CONSENT_TYPEHASH =
        keccak256("CorrectionConsent(uint256 tokenId,bytes32 definitionHash,bytes32 reasonHash,uint256 nonce)");
    /// @dev Re-review M-F: the protector's consent to lifting a Void.
    bytes32 internal constant RESTORE_CONSENT_TYPEHASH =
        keccak256("RestoreConsent(uint256 tokenId,bytes32 reasonHash,uint256 nonce)");
    /// @dev Re-review M-G: the protector's consent to the standby's promotion on its own determination.
    bytes32 internal constant LICENSING_CONSENT_TYPEHASH =
        keccak256("LicensingConsent(uint256 tokenId,address standby,bytes32 docHash,uint256 nonce)");

    /// @dev The trust agreement applies only to Land and Estate (Addendum 1).
    function _inScope(uint8 assetType) internal pure returns (bool) {
        return assetType == uint8(AssetType.Land) || assetType == uint8(AssetType.Estate);
    }

    /// @dev The URI the deed's validator adopted `versionHash` under for this asset type; reverts if none.
    function _adoptedURI(address v, uint8 assetType, bytes32 versionHash) internal view returns (string memory uri) {
        if (versionHash == bytes32(0)) revert IDeedTrust.AgreementNotAdopted(versionHash);
        uri = IAgreementAdoption(v).agreementVersionURI(assetType, versionHash);
        if (bytes(uri).length == 0) revert IDeedTrust.AgreementNotAdopted(versionHash);
    }

    /// @dev Every rider must be adopted too. Returns keccak256 over the packed rider hashes.
    function _checkRiders(address v, uint8 assetType, bytes32[] calldata riderHashes) internal view returns (bytes32) {
        for (uint256 i = 0; i < riderHashes.length; i++) {
            _adoptedURI(v, assetType, riderHashes[i]);
        }
        return keccak256(abi.encodePacked(riderHashes));
    }

    function _isEligible(address account) internal view returns (bool) {
        return account != address(0) && ITrusteeRegistry(validatorRegistry).isEligibleTrustee(account);
    }

    function _requireEligible(address account) internal view {
        if (!_isEligible(account)) revert IDeedTrust.TrusteeNotEligible(account);
    }

    /// @dev EIP-712 domain "DeedNFT Trust", version "5", bound to the DeedNFT proxy (this code runs in its context).
    function _digest(bytes32 structHash) internal view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(
            DOMAIN_TYPEHASH, keccak256("DeedNFT Trust"), keccak256("5"), block.chainid, address(this)
        ));
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    /// @dev Consent by signature (EOA, or EIP-1271 contract wallet) when one is given, else by a prior
    ///      approveTrustAction of the same digest, which is used up.
    function _consume(address signer, bytes32 structHash, bytes calldata signature) internal {
        bytes32 digest = _digest(structHash);
        if (signature.length == 0) {
            if (!_trustApprovals[signer][digest]) revert IDeedTrust.ConsentMissing(signer);
            delete _trustApprovals[signer][digest];
        } else if (!SignatureCheckerUpgradeable.isValidSignatureNow(signer, digest, signature)) {
            revert IDeedTrust.ConsentMissing(signer);
        }
    }

    function _trusteeAcceptanceHash(uint256 tokenId, address trustee, uint256 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encode(TRUSTEE_ACCEPTANCE_TYPEHASH, tokenId, trustee, nonce));
    }
}
