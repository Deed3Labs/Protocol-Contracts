// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

interface IESADepositVault {
    event AcceptedTokenUpdated(address indexed token, bool accepted);
    event Deposited(
        address indexed caller,
        address indexed receiver,
        address indexed token,
        uint256 tokenAmount,
        uint256 clrusdMinted
    );
    event Redeemed(
        address indexed caller,
        address indexed receiver,
        address indexed token,
        uint256 clrusdBurned,
        uint256 tokenAmount
    );

    function deposit(address token, uint256 amount, address receiver) external returns (uint256 minted);
    function redeem(address token, uint256 clrusdAmount, address receiver)
        external
        returns (uint256 returnedAmount);

    function previewDeposit(address token, uint256 amount) external view returns (uint256 minted);
    function previewRedeem(address token, uint256 clrusdAmount)
        external
        view
        returns (uint256 returnedAmount);

    function setAcceptedToken(address token, bool accepted) external;
    function isAcceptedToken(address token) external view returns (bool);
    function clrusd() external view returns (address);
}
