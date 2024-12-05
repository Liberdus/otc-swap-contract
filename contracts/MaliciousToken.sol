// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
// Mock MaliciousToken contract for testing cleanup retry mechanism
contract MaliciousToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function transfer(address to, uint256 amount) external returns (bool) {
        revert("Transfer failed");
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        return true; // Allow initial transfer to contract but fail on cleanup
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}
