// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

/// @dev Safe's AllowanceModule v0.1.1 (the canonical deployment), only the call used here.
interface IAllowanceModule {
    function executeAllowanceTransfer(
        address safe,
        address token,
        address payable to,
        uint96 amount,
        address paymentToken,
        uint96 payment,
        address delegate,
        bytes memory signature
    ) external;
}

/// @title SettlementForwarder
/// @notice CL Operating's AllowanceModule delegate for Settlement Funding (decision 54; L-01 §8.4A,
/// I-02 §4.9(a)): the funding desk's wallet calls `forward(amount)`, and the module moves that much
/// USDC from CL Operating to the off-ramp, within the allowance CL Operating gave this contract.
/// @dev The point is the destination: the desk wallet is a CDP server wallet the job holds, and a
/// stolen desk key can only push USDC from CL Operating to the off-ramp (the Bridge liquidation
/// address bound to the Credit Settlement Account), within the allowance per period. The off-ramp
/// and the desk wallet are set only by CL Operating itself, that is by a Safe transaction its owner
/// (the Clear Lending Safe, two people) signs; nothing else, this contract's deployer included, can
/// change either. Removing this delegate, or its allowance, on the AllowanceModule stops it; so
/// does setting the desk to zero.
///
/// It is a contract delegate: the module accepts an empty signature as "the caller is the
/// delegate" (`recoverSignature` returns `msg.sender`), so this contract calls the module itself,
/// naming itself as the delegate. It holds no funds and no state but the two addresses.
contract SettlementForwarder {
    /// @notice CL Operating, the Safe the USDC comes from and the only account that sets anything.
    address public immutable safe;
    /// @notice Safe's AllowanceModule, enabled on `safe`.
    address public immutable allowanceModule;
    /// @notice The token forwarded (USDC).
    address public immutable token;
    /// @notice Where every forward goes: the off-ramp's deposit address.
    address public offRamp;
    /// @notice The only account that may call `forward`: the funding desk's wallet.
    address public desk;

    event OffRampSet(address indexed offRamp);
    event DeskSet(address indexed desk);
    event Forwarded(address indexed offRamp, address indexed desk, uint256 amount);

    error SettlementForwarderNotSafe(address caller);
    error SettlementForwarderNotDesk(address caller);
    error SettlementForwarderNoOffRamp();
    error SettlementForwarderInvalidAddress();
    error SettlementForwarderInvalidAmount();

    constructor(address safe_, address allowanceModule_, address token_) {
        if (safe_.code.length == 0 || allowanceModule_.code.length == 0 || token_.code.length == 0) {
            revert SettlementForwarderInvalidAddress();
        }
        safe = safe_;
        allowanceModule = allowanceModule_;
        token = token_;
    }

    modifier onlySafe() {
        if (msg.sender != safe) revert SettlementForwarderNotSafe(msg.sender);
        _;
    }

    /// @notice sets the off-ramp's deposit address. CL Operating only.
    function setOffRamp(address offRamp_) external onlySafe {
        if (offRamp_ == address(0) || offRamp_ == safe || offRamp_ == address(this)) revert SettlementForwarderInvalidAddress();
        offRamp = offRamp_;
        emit OffRampSet(offRamp_);
    }

    /// @notice sets the funding desk's wallet; zero stops forwarding. CL Operating only.
    function setDesk(address desk_) external onlySafe {
        desk = desk_;
        emit DeskSet(desk_);
    }

    /// @notice moves `amount` of `token` from CL Operating to the off-ramp, through the
    /// AllowanceModule, within this delegate's allowance. The desk wallet only.
    function forward(uint256 amount) external {
        address caller = desk;
        if (caller == address(0) || msg.sender != caller) revert SettlementForwarderNotDesk(msg.sender);
        address to = offRamp;
        if (to == address(0)) revert SettlementForwarderNoOffRamp();
        if (amount == 0 || amount > type(uint96).max) revert SettlementForwarderInvalidAmount();
        IAllowanceModule(allowanceModule).executeAllowanceTransfer(
            safe, token, payable(to), uint96(amount), address(0), 0, address(this), ""
        );
        emit Forwarded(to, msg.sender, amount);
    }
}
