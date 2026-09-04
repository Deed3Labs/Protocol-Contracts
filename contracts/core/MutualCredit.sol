// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.29;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import "./interfaces/stable-credit/IMutualCredit.sol";

contract MutualCredit is IMutualCredit, ERC20BurnableUpgradeable {
    using ExtraMath for *;

    /* ========== STATE VARIABLES ========== */

    // member address => credit line
    mapping(address => CreditLine) private creditLines;

    /* ========== INITIALIZER ========== */

    /// @notice initializes ERC20 with the name and symbol provided.
    /// @dev should be called directly after deployment (see OpenZeppelin upgradeable standards).
    /// @param name_ name of the credit token.
    /// @param symbol_ symbol of the credit token.
    function __MutualCredit_init(string memory name_, string memory symbol_)
        public
        virtual
        onlyInitializing
    {
        __ERC20_init(name_, symbol_);
    }

    /* ========== VIEWS ========== */

    /// @notice returns the number of decimals used by the credit token.
    /// @return number of decimals.
    function decimals() public view virtual override returns (uint8) {
        return 6;
    }

    /// @notice returns the credit balance of a given member
    /// @param member address of member to query
    /// @return credit balance of member
    function creditBalanceOf(address member) public view override returns (uint256) {
        return creditLines[member].creditBalance;
    }

    /// @notice returns the credit limit of a given member
    /// @param member address of member to query
    /// @return credit limit of member
    function creditLimitOf(address member) public view override returns (uint256) {
        return creditLines[member].creditLimit;
    }

    /// @notice returns the credit limit left of a given member
    /// @param member address of member to query
    /// @return credit limit left of member
    function creditLimitLeftOf(address member) public view returns (uint256) {
        CreditLine memory _creditLine = creditLines[member];
        if (_creditLine.creditBalance >= _creditLine.creditLimit) {
            return 0;
        }
        return _creditLine.creditLimit - _creditLine.creditBalance;
    }

    /* ========== PRIVATE FUNCTIONS ========== */

    /// @notice transfers tokens from sender to recipient
    /// @dev overrides ERC20 _transfer to include credit line logic
    /// @param _from sender address
    /// @param _to recipient address
    /// @param _amount amount of tokens to transfer
    function _transfer(address _from, address _to, uint256 _amount) internal virtual override {
        _beforeTransfer(_from, _amount);
        super._transfer(_from, _to, _amount);
        _afterTransfer(_to, _amount);
    }

    /// @notice mints tokens to sender if sender has sufficient positive balance and
    /// increments credit balance.
    /// @dev will revert if sender does not have sufficient credit limit left.
    /// @param _from sender address
    /// @param _amount amount of tokens to mint
    function _beforeTransfer(address _from, uint256 _amount) private {
        uint256 _balanceFrom = balanceOf(_from);
        // return if sender has sufficient balance
        if (_balanceFrom >= _amount) {
            return;
        }
        CreditLine memory _creditLine = creditLines[_from];
        uint256 _missingBalance = _amount - _balanceFrom;
        uint256 _creditLeft = creditLimitLeftOf(_from);
        require(_creditLeft >= _missingBalance, "MutualCredit: Insufficient credit");
        // increment credit balance
        creditLines[_from].creditBalance = (_creditLine.creditBalance + _missingBalance).toUInt128();
        _mint(_from, _missingBalance);
    }

    /// @notice decrements credit balance of recipient if recipient has a credit balance to repay.
    /// @param _to recipient address
    /// @param _amount amount of tokens to transfer
    function _afterTransfer(address _to, uint256 _amount) private {
        CreditLine memory _creditLine = creditLines[_to];
        uint256 _repay = Math.min(_creditLine.creditBalance, _amount);
        // return if recipient has no credit balance to repay
        if (_repay == 0) {
            return;
        }
        // decrement credit balance
        creditLines[_to].creditBalance = (_creditLine.creditBalance - _repay).toUInt128();
        _burn(_to, _repay);
    }

    /// @notice deepens a member's credit balance and mints the matching claim to a recipient.
    /// @dev Carry accrual, not a transfer. The member did not spend anything -- their obligation
    /// grew with time held -- so nothing moves out of their balance, and the claim that now exists
    /// against the network lands with whoever is owed it.
    ///
    /// Deliberately not limit-checked. Carry is what makes a member's headroom shrink while they
    /// hold a position, and a ceiling that stopped carry accruing once it was reached would make
    /// standing still free. A member may end up owing more than their ceiling; `creditLimitLeftOf`
    /// already reports no headroom in that case, so they simply cannot draw again.
    /// @param member address whose obligation grows.
    /// @param recipient address the matching claim is minted to.
    /// @param amount amount accrued.
    function _accrueCredit(address member, address recipient, uint256 amount) internal virtual {
        if (amount == 0) return;
        CreditLine memory _creditLine = creditLines[member];
        creditLines[member].creditBalance = (_creditLine.creditBalance + amount).toUInt128();
        _mint(recipient, amount);
    }

    /// @notice unwinds an accrual: burns the claim and shrinks the obligation that matched it.
    /// @dev The exact inverse of `_accrueCredit`, and the only way an obligation leaves this
    /// ledger without reserve tokens arriving to settle it. That is the point -- origination put
    /// the obligation here without capital, so undoing it must not require any either.
    ///
    /// The claim is burned from whoever holds it, which is why the holder is a parameter rather
    /// than assumed: a purchase mints to the merchant, and reversing it has to take it back from
    /// the merchant, not from the member who never held it.
    /// @param member address whose obligation shrinks.
    /// @param holder address the matching claim is burned from.
    /// @param amount amount to unwind.
    function _reverseCredit(address member, address holder, uint256 amount) internal virtual {
        if (amount == 0) return;
        CreditLine memory _creditLine = creditLines[member];
        // Callers check this and revert with something that names the pair. Belt and braces: an
        // underflow here would wrap a member's obligation to an enormous number.
        require(_creditLine.creditBalance >= amount, "MutualCredit: reversal exceeds obligation");
        creditLines[member].creditBalance = (_creditLine.creditBalance - amount).toUInt128();
        _burn(holder, amount);
    }

    /// @notice moves an obligation from one party to another. No claim is minted or burned.
    /// @dev What is left of a reversal once there is no claim to take back. The merchant drew
    /// their payout down, so nothing can be burned from them -- but the member must still be
    /// released, and the debt does not simply evaporate. It changes hands.
    ///
    /// Claims are untouched on purpose: the total owed to the network is the same before and
    /// after, it is owed by somebody else. Burning and re-minting to express that would take a
    /// claim off a holder who never agreed to give one up.
    /// @param from address released of the obligation.
    /// @param to address taking it on.
    /// @param amount amount moved.
    function _transferObligation(address from, address to, uint256 amount) internal virtual {
        if (amount == 0) return;
        CreditLine memory _from = creditLines[from];
        require(_from.creditBalance >= amount, "MutualCredit: transfer exceeds obligation");
        creditLines[from].creditBalance = (_from.creditBalance - amount).toUInt128();
        creditLines[to].creditBalance = (creditLines[to].creditBalance + amount).toUInt128();
    }

    /// @notice sets the credit limit of a given member
    /// @param member address of member to update
    /// @param limit new credit limit
    function setCreditLimit(address member, uint256 limit) internal virtual {
        creditLines[member].creditLimit = limit.toUInt128();
        emit CreditLimitUpdate(member, limit);
    }
}

library ExtraMath {
    function toUInt128(uint256 _a) internal pure returns (uint128) {
        require(_a < 2 ** 128 - 1, "uin128 overflow");
        return uint128(_a);
    }
}