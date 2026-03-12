// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../core/interfaces/IESADepositVault.sol";

/// @title SavingsIntentEscrow
/// @notice Deterministic single-use escrow that converts a single user token transfer
///         into a sponsored vault deposit or redeem flow.
contract SavingsIntentEscrow is Initializable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    enum Action {
        Deposit,
        Redeem
    }

    enum Status {
        Uninitialized,
        Pending,
        Finalized,
        Refunded
    }

    address public factory;
    address public depositor;
    address public receiver;
    address public transferToken;
    address public vaultToken;
    address public vault;
    uint256 public amount;
    uint64 public expiry;
    Action public action;
    Status public status;

    error SavingsIntentEscrowUnauthorized();
    error SavingsIntentEscrowInvalidAddress();
    error SavingsIntentEscrowInvalidAmount();
    error SavingsIntentEscrowInvalidAction();
    error SavingsIntentEscrowInvalidState();
    error SavingsIntentEscrowInvalidExpiry();
    error SavingsIntentEscrowFundingIncomplete();

    event Finalized(
        Action indexed action,
        address indexed depositor,
        address indexed receiver,
        uint256 amount,
        uint256 resultAmount
    );

    event Refunded(address indexed depositor, uint256 refundedAmount);

    modifier onlyFactory() {
        if (msg.sender != factory) revert SavingsIntentEscrowUnauthorized();
        _;
    }

    function initialize(
        address factory_,
        address depositor_,
        address receiver_,
        address transferToken_,
        address vaultToken_,
        address vault_,
        uint256 amount_,
        uint64 expiry_,
        uint8 action_
    ) external initializer {
        __ReentrancyGuard_init();

        if (
            factory_ == address(0) ||
            depositor_ == address(0) ||
            receiver_ == address(0) ||
            transferToken_ == address(0) ||
            vaultToken_ == address(0) ||
            vault_ == address(0)
        ) {
            revert SavingsIntentEscrowInvalidAddress();
        }
        if (amount_ == 0) revert SavingsIntentEscrowInvalidAmount();
        if (expiry_ <= block.timestamp) revert SavingsIntentEscrowInvalidExpiry();
        if (action_ > uint8(Action.Redeem)) revert SavingsIntentEscrowInvalidAction();

        factory = factory_;
        depositor = depositor_;
        receiver = receiver_;
        transferToken = transferToken_;
        vaultToken = vaultToken_;
        vault = vault_;
        amount = amount_;
        expiry = expiry_;
        action = Action(action_);
        status = Status.Pending;
    }

    function currentBalance() public view returns (uint256) {
        return IERC20(transferToken).balanceOf(address(this));
    }

    function finalize() external onlyFactory nonReentrant returns (uint256 resultAmount) {
        if (status != Status.Pending) revert SavingsIntentEscrowInvalidState();
        if (currentBalance() != amount) revert SavingsIntentEscrowFundingIncomplete();

        IERC20 transferAsset = IERC20(transferToken);
        transferAsset.safeApprove(vault, 0);
        transferAsset.safeApprove(vault, amount);

        status = Status.Finalized;

        if (action == Action.Deposit) {
            resultAmount = IESADepositVault(vault).deposit(vaultToken, amount, receiver);
        } else {
            resultAmount = IESADepositVault(vault).redeem(vaultToken, amount, receiver);
        }

        emit Finalized(action, depositor, receiver, amount, resultAmount);
    }

    function refund() external onlyFactory nonReentrant returns (uint256 refundedAmount) {
        if (status != Status.Pending) revert SavingsIntentEscrowInvalidState();
        if (block.timestamp <= expiry) revert SavingsIntentEscrowInvalidExpiry();

        refundedAmount = currentBalance();
        if (refundedAmount == 0) revert SavingsIntentEscrowFundingIncomplete();

        status = Status.Refunded;
        IERC20(transferToken).safeTransfer(depositor, refundedAmount);

        emit Refunded(depositor, refundedAmount);
    }
}
