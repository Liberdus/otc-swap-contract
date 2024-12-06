// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TestTokenDecimals
 * @dev A test token implementation that allows setting custom decimals.
 * Useful for mocking tokens like USDC (6 decimals) or WBTC (8 decimals).
 */
contract TestTokenDecimals is ERC20, Ownable {
    uint8 private _decimals;

    /**
     * @dev Constructor that sets the name, symbol, and number of decimals for the token
     * @param name The name of the token
     * @param symbol The symbol of the token
     * @param decimalsValue The number of decimals for the token
     */
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimalsValue
    ) ERC20(name, symbol) Ownable(msg.sender) {
        require(decimalsValue <= 18, "TestTokenDecimals: decimals cannot exceed 18");
        _decimals = decimalsValue;
    }

    /**
     * @dev Returns the number of decimals used for token amounts
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @dev Mints tokens to the specified address.
     * Can only be called by the contract owner.
     * @param to The address to mint tokens to
     * @param amount The amount of tokens to mint
     */
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

    /**
     * @dev Burns tokens from the specified address.
     * Can only be called by the contract owner.
     * @param from The address to burn tokens from
     * @param amount The amount of tokens to burn
     */
    function burn(address from, uint256 amount) public onlyOwner {
        _burn(from, amount);
    }

    /**
     * @dev Returns the amount of tokens owned by the specified account,
     * taking into account the token's decimals.
     * @param account The address to query the balance of
     * @return The balance in the token's smallest unit
     */
    function balanceOf(address account) public view virtual override returns (uint256) {
        return super.balanceOf(account);
    }

    /**
     * @dev Returns the total supply of tokens, taking into account the token's decimals.
     * @return The total supply in the token's smallest unit
     */
    function totalSupply() public view virtual override returns (uint256) {
        return super.totalSupply();
    }
}
