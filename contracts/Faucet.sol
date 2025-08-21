// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./TestTokenPausable.sol";

contract Faucet is Ownable {
    // Token contracts
    TestTokenPausable public feeToken;
    TestTokenPausable public tradingToken1;
    TestTokenPausable public tradingToken2;

    // Amounts to distribute
    uint256 public feeTokenAmount;
    uint256 public tradingTokenAmount;

    // Cooldown period to prevent abuse (in seconds)
    uint256 public cooldownPeriod;

    // Mapping to track last request time per user
    mapping(address => uint256) public lastRequestTime;

    // Events
    event TokensRequested(
        address indexed user,
        uint256 feeAmount,
        uint256 trading1Amount,
        uint256 trading2Amount
    );
    event TokensUpdated(address indexed token, uint256 amount);
    event CooldownUpdated(uint256 newCooldown);

    constructor(
        address _feeToken,
        address _tradingToken1,
        address _tradingToken2,
        uint256 _feeTokenAmount,
        uint256 _tradingTokenAmount,
        uint256 _cooldownPeriod
    ) Ownable(msg.sender) {
        feeToken = TestTokenPausable(_feeToken);
        tradingToken1 = TestTokenPausable(_tradingToken1);
        tradingToken2 = TestTokenPausable(_tradingToken2);
        feeTokenAmount = _feeTokenAmount;
        tradingTokenAmount = _tradingTokenAmount;
        cooldownPeriod = _cooldownPeriod;
    }

    /**
     * @dev Request tokens from the faucet
     * @param user Address to receive the tokens
     */
    function requestTokens(address user) external {
        require(user != address(0), "Invalid user address");
        require(msg.sender == user, "Can only request tokens for yourself");

        // Check cooldown
        require(
            block.timestamp >= lastRequestTime[user] + cooldownPeriod,
            "Cooldown period not elapsed"
        );

        // Update last request time
        lastRequestTime[user] = block.timestamp;

        // Transfer tokens from faucet to user (faucet must have tokens)
        feeToken.transfer(user, feeTokenAmount);
        tradingToken1.transfer(user, tradingTokenAmount);
        tradingToken2.transfer(user, tradingTokenAmount);

        emit TokensRequested(
            user,
            feeTokenAmount,
            tradingTokenAmount,
            tradingTokenAmount
        );
    }

    /**
     * @dev Update token amounts (owner only)
     */
    function updateTokenAmounts(
        uint256 _feeTokenAmount,
        uint256 _tradingTokenAmount
    ) external onlyOwner {
        feeTokenAmount = _feeTokenAmount;
        tradingTokenAmount = _tradingTokenAmount;
        emit TokensUpdated(address(feeToken), _feeTokenAmount);
        emit TokensUpdated(address(tradingToken1), _tradingTokenAmount);
        emit TokensUpdated(address(tradingToken2), _tradingTokenAmount);
    }

    /**
     * @dev Update cooldown period (owner only)
     */
    function updateCooldownPeriod(uint256 _cooldownPeriod) external onlyOwner {
        cooldownPeriod = _cooldownPeriod;
        emit CooldownUpdated(_cooldownPeriod);
    }

    /**
     * @dev Get remaining cooldown time for a user
     */
    function getRemainingCooldown(
        address user
    ) external view returns (uint256) {
        uint256 timeSinceLastRequest = block.timestamp - lastRequestTime[user];
        if (timeSinceLastRequest >= cooldownPeriod) {
            return 0;
        }
        return cooldownPeriod - timeSinceLastRequest;
    }

    /**
     * @dev Check if user can request tokens
     */
    function canRequestTokens(address user) external view returns (bool) {
        return block.timestamp >= lastRequestTime[user] + cooldownPeriod;
    }
}
