// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TestTokenPausable is ERC20Pausable, Ownable {
    constructor(
        string memory name,
        string memory symbol,
        address[] memory initialRecipients,
        uint256[] memory initialAmounts
    ) ERC20(name, symbol) Ownable(msg.sender) {
        // Mint initial supply to deployer
        _mint(msg.sender, 1000000 * 10 ** decimals());

        // Distribute tokens to initial recipients
        require(
            initialRecipients.length == initialAmounts.length,
            "Recipients and amounts arrays must have same length"
        );

        for (uint256 i = 0; i < initialRecipients.length; i++) {
            if (initialRecipients[i] != address(0) && initialAmounts[i] > 0) {
                _transfer(msg.sender, initialRecipients[i], initialAmounts[i]);
            }
        }
    }

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function _update(
        address from,
        address to,
        uint256 amount
    ) internal virtual override(ERC20Pausable) {
        super._update(from, to, amount);
    }
}
