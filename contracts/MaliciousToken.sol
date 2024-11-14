// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MaliciousToken
 * @dev An ERC20 token that attempts reentrancy attacks during transfers
 */
contract MaliciousToken is ERC20 {
    // Track if we're currently in a transfer to prevent infinite recursion
    bool private _inTransfer;
    address private _otcSwap;
    uint256 private _attackMode; // 0: no attack, 1: attack on transfer, 2: attack on transferFrom

    constructor() ERC20("Malicious Token", "MAL") {
        _mint(msg.sender, 1000000 * 10**decimals());
    }

    // Set the OTCSwap contract address and attack mode
    function setAttackParams(address otcSwap, uint256 attackMode) external {
        _otcSwap = otcSwap;
        _attackMode = attackMode;
    }

    function _update(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        // Only attempt reentrancy if:
        // 1. We're not already in a transfer (prevent infinite recursion)
        // 2. The OTCSwap address is set
        // 3. The transfer involves the OTCSwap contract
        // 4. Attack mode is set
        if (!_inTransfer &&
        _otcSwap != address(0) &&
        (from == _otcSwap || to == _otcSwap) &&
        _attackMode > 0) {

            _inTransfer = true;

            // Different attack vectors based on mode
            if (_attackMode == 1) {
                // Attack vector 1: Try to create a new order during transfer
                bytes memory payload = abi.encodeWithSignature(
                    "createOrder(address,address,uint256,address,uint256)",
                    address(0),
                    address(this),
                    amount,
                    address(this),
                    amount
                );
                (bool success,) = _otcSwap.call(payload);
                require(success, "Reentrancy attack failed");
            }
            else if (_attackMode == 2) {
                // Attack vector 2: Try to fill an existing order during transfer
                bytes memory payload = abi.encodeWithSignature(
                    "fillOrder(uint256)",
                    0
                );
                (bool success,) = _otcSwap.call(payload);
                require(success, "Reentrancy attack failed");
            }
            else if (_attackMode == 3) {
                // Attack vector 3: Try to cancel an order during transfer
                bytes memory payload = abi.encodeWithSignature(
                    "cancelOrder(uint256)",
                    0
                );
                (bool success,) = _otcSwap.call(payload);
                require(success, "Reentrancy attack failed");
            }

            _inTransfer = false;
        }

        super._update(from, to, amount);
    }

    // Additional helper functions for testing
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function isAttacking() external view returns (bool) {
        return _inTransfer;
    }

    function getAttackMode() external view returns (uint256) {
        return _attackMode;
    }
}
