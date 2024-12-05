# OTC Swap Contract - Frontend Developer Guide

## Overview
This guide explains key aspects of interacting with the OTC Swap contract from a frontend perspective. The contract manages peer-to-peer token swaps with an automatic cleanup mechanism and configurable fee system.

## Key Features
- Direct peer-to-peer token swaps
- Order creation fee using a specified ERC20 token to prevent spam
- Configurable fee token and fee amount by contract owner
- 7-day order expiry with 7-day grace period
- Incentivized, permissionless order cleanup with rewards for cleaner
- Retry mechanism for failed cleanup operations
- Contract disable feature allowing owner to prevent new orders while maintaining existing order functionality

## How it Works
- Any user can create an order specifying the sell token the buy token and the amounts; the user creating the order is called the maker
- The maker can optionally specify the address of the taker; if not provided then anyone can be a taker
- To prevent spam and only allow serious orders there is a non-refundable order creation fee paid in a specified ERC20 token
- The maker can cancel the order at anytime if the trade is no longer fair and loses only the order creation fee
- If the order is filled the tokens from the taker are sent to the maker and the tokens locked in the contract are sent to the taker
- If an order is not filled within 7 days it is considered expired and can no longer be filled
- If an order has expired the maker should cancel the order to get the locked token back
- If the maker does not cancel the order within 7 days of the order expiring, the maker has to wait for the contract to cancel the order
- Anyone can call the cleanup function on the contract to delete orders that are older than 14 days
- When an order is cleaned up, the storage used by the order is freed up
- If the order being cleaned up is an Active order, any tokens that are still locked by the order are sent back to the maker
- To incentivize people to call the cleanup function the order creation fee is given to the caller when the order is deleted
- If an order could not be cleaned due to token transfer to maker failing, the order is reset as a new order and can be filled again
- If the order could not be cleaned after 10 attempts at 14 day intervals, the order is force deleted and the fees are distributed
- If the order is force deleted and was an Active order, the tokens sent by the maker to the contract are locked forever.

## Building the Order Book State

### Event-Based State Building
The contract emits comprehensive events that allow rebuilding the complete state of active orders. You should query events from the last 14 days (7 days expiry + 7 days grace period) to ensure you catch all relevant orders.

Key Events to Monitor:
```solidity
OrderCreated(uint256 indexed orderId, address indexed maker, address indexed taker, address sellToken, uint256 sellAmount, address buyToken, uint256 buyAmount, uint256 timestamp, address feeToken, uint256 orderCreationFee)
OrderFilled(uint256 indexed orderId, address indexed maker, address indexed taker, address sellToken, uint256 sellAmount, address buyToken, uint256 buyAmount, uint256 timestamp)
OrderCanceled(uint256 indexed orderId, address indexed maker, uint256 timestamp)
OrderCleanedUp(uint256 indexed orderId, address indexed maker, uint256 timestamp)
RetryOrder(uint256 indexed oldOrderId, uint256 indexed newOrderId, address indexed maker, uint256 tries, uint256 timestamp)
CleanupFeesDistributed(address indexed recipient, address indexed feeToken, uint256 amount, uint256 timestamp)
CleanupError(uint256 indexed orderId, string reason, uint256 timestamp)
ContractDisabled(address indexed owner, uint256 timestamp)
TransferError(uint256 indexed orderId, string tokenType, string reason, uint256 timestamp)
TokenTransferAttempt(uint256 indexed orderId, bool success, bytes returnData, uint256 fromBalance, uint256 toBalance, uint256 timestamp)
FeeConfigUpdated(address indexed feeToken, uint256 feeAmount, uint256 timestamp)
```

Building State Algorithm:
1. Query OrderCreated events for last 14 days
2. For each order:
   - Check OrderFilled events (order inactive if filled)
   - Check OrderCanceled events (order inactive if canceled)
   - Check OrderCleanedUp events (order deleted if cleaned)
   - Check RetryOrder events (order moved to new ID if retry)
   - Check current timestamp against order timestamp + 7 days (expired if exceeded)
   - If none of above, order is active

Example Query Pattern (pseudocode):
```javascript
const EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds
const GRACE_PERIOD = 7 * 24 * 60 * 60; // 7 days in seconds

// Get last 14 days of events
const fromBlock = await getBlockNumberFromTimestamp(Date.now() - (EXPIRY + GRACE_PERIOD) * 1000);

const createdEvents = await contract.queryFilter(contract.filters.OrderCreated(), fromBlock);
const filledEvents = await contract.queryFilter(contract.filters.OrderFilled(), fromBlock);
const canceledEvents = await contract.queryFilter(contract.filters.OrderCanceled(), fromBlock);
const cleanedEvents = await contract.queryFilter(contract.filters.OrderCleanedUp(), fromBlock);
const retryEvents = await contract.queryFilter(contract.filters.RetryOrder(), fromBlock);

// Create lookup maps for filled/canceled/cleaned/retried orders
const filledOrders = new Set(filledEvents.map(e => e.args.orderId.toString()));
const canceledOrders = new Set(canceledEvents.map(e => e.args.orderId.toString()));
const cleanedOrders = new Set(cleanedEvents.map(e => e.args.orderId.toString()));
const retriedOrders = new Set(retryEvents.map(e => e.args.oldOrderId.toString()));

// Build active orders map
const activeOrders = createdEvents
    .filter(event => {
        const orderId = event.args.orderId.toString();
        const isExpired = event.args.timestamp + EXPIRY < Date.now()/1000;
        return !filledOrders.has(orderId) && 
               !canceledOrders.has(orderId) && 
               !cleanedOrders.has(orderId) &&
               !retriedOrders.has(orderId) &&
               !isExpired;
    })
    .reduce((acc, event) => {
        acc[event.args.orderId.toString()] = {
            orderId: event.args.orderId,
            maker: event.args.maker,
            taker: event.args.taker,
            sellToken: event.args.sellToken,
            sellAmount: event.args.sellAmount,
            buyToken: event.args.buyToken,
            buyAmount: event.args.buyAmount,
            timestamp: event.args.timestamp,
            feeToken: event.args.feeToken,
            orderCreationFee: event.args.orderCreationFee
        };
        return acc;
    }, {});
```

## Order Creation Fee

The contract uses a configurable fee system where both the fee token and fee amount can be set by the contract owner. The current fee configuration can be read directly from the contract:

```javascript
const feeToken = await contract.feeToken();
const orderCreationFeeAmount = await contract.orderCreationFeeAmount();
```

Important notes about the fee:
- Fee is paid in the specified ERC20 token
- Fee amount is fixed (not dynamically adjusted)
- Fee can be updated by contract owner
- Fee token must be approved before creating an order
- Fee is non-refundable and is used to incentivize order cleanup

## Cleanup Mechanism

The contract incentivizes cleanup of expired orders through rewards:

1. Orders become eligible for cleanup after:
   - 7 days (ORDER_EXPIRY) + 7 days (GRACE_PERIOD) = 14 days total
   - Applies to all orders regardless of status (Active, Filled, or Canceled)

2. Anyone can call cleanupExpiredOrders():
   - No parameters needed
   - Processes orders sequentially from firstOrderId
   - Stops at first non-cleanable order
   - Caller receives accumulated creation fees as reward
   - For Active orders try to return tokens to maker
   - For Filled or Canceled orders or Active orders where the tokens were returned simply deletes the order
   - If attempt to return tokens to maker fails the order is reset as a new order and can be filled again
   - If attempt to return tokens to maker fails MAX_RETRY_ATTEMPTS (10) times the order is deleted and the caller receives the creation fee

3. Calculate potential cleanup reward:
```javascript
// Function to calculate potential cleanup reward for the next batch
async function calculateCleanupReward(contract) {
    const currentTime = Math.floor(Date.now() / 1000);
    const firstOrderId = await contract.firstOrderId();
    const nextOrderId = await contract.nextOrderId();
    let reward = 0;
    
    // Look at the next order
    const order = await contract.orders(firstOrderId);
    
    // Skip empty orders
    if (order.maker === '0x0000000000000000000000000000000000000000') {
        return 0;
    }
    
    // Check if grace period has passed
    if (currentTime > order.timestamp.toNumber() + (14 * 24 * 60 * 60)) {
        reward = order.orderCreationFee.toBigInt();
    }
    
    return reward;
}
```

## Key Contract Parameters

Direct Read Access:
```javascript
const firstOrderId = await contract.firstOrderId();
const nextOrderId = await contract.nextOrderId();
const feeToken = await contract.feeToken();
const orderCreationFeeAmount = await contract.orderCreationFeeAmount();
const accumulatedFees = await contract.accumulatedFees();
const isDisabled = await contract.isDisabled();  // Check if contract is disabled
```

Constants:
```javascript
const ORDER_EXPIRY = 7 * 24 * 60 * 60;    // 7 days in seconds
const GRACE_PERIOD = 7 * 24 * 60 * 60;    // 7 days in seconds
const MAX_RETRY_ATTEMPTS = 10;            // Maximum cleanup retries
```

## Event Subscriptions

To maintain real-time state:
```javascript
contract.on("OrderCreated", (orderId, maker, taker, sellToken, sellAmount, buyToken, buyAmount, timestamp, feeToken, orderCreationFee) => {
    // Add new order to state
});

contract.on("OrderFilled", (orderId, maker, taker, sellToken, sellAmount, buyToken, buyAmount, timestamp) => {
    // Remove order from active state
});

contract.on("OrderCanceled", (orderId, maker, timestamp) => {
    // Remove order from active state
});

contract.on("OrderCleanedUp", (orderId, maker, timestamp) => {
    // Remove order from active state
});

contract.on("RetryOrder", (oldOrderId, newOrderId, maker, tries, timestamp) => {
    // Update order ID in state
});

contract.on("CleanupError", (orderId, reason, timestamp) => {
    // Handle cleanup failure
});

contract.on("CleanupFeesDistributed", (recipient, feeToken, amount, timestamp) => {
    // Track cleanup rewards
});

contract.on("ContractDisabled", (owner, timestamp) => {
    // Update UI to prevent new order creation
});

contract.on("TransferError", (orderId, tokenType, reason, timestamp) => {
    // Handle token transfer errors
});

contract.on("TokenTransferAttempt", (orderId, success, returnData, fromBalance, toBalance, timestamp) => {
    // Track token transfer attempts
});

contract.on("FeeConfigUpdated", (feeToken, feeAmount, timestamp) => {
    // Update fee configuration in UI
});
```

## Error Handling

Common error messages to handle:
- "Order does not exist" - Invalid order ID
- "Order is not active" - Order already filled/canceled
- "Invalid sell token" - Zero address provided
- "Invalid buy token" - Zero address provided
- "Invalid sell amount" - Zero amount provided
- "Invalid buy amount" - Zero amount provided
- "Cannot swap same token" - Sell and buy tokens are the same
- "Insufficient balance for sell token" - Maker doesn't have enough tokens
- "Insufficient allowance for sell token" - Contract not approved to transfer tokens
- "Insufficient balance for fee" - Maker doesn't have enough fee tokens
- "Insufficient allowance for fee" - Contract not approved to transfer fee tokens
- "Order has expired" - Past 7-day expiry
- "Not authorized to fill this order" - Wrong taker address
- "Only maker can cancel order" - Non-maker tried to cancel
- "Grace period has expired" - Tried to cancel after grace period
- "Invalid fee token" - Zero address provided for fee token
- "Invalid fee amount" - Zero amount provided for fee
- "Contract is disabled" - Attempt to create new order when contract is disabled
- "Contract already disabled" - Attempt to disable an already disabled contract
- "Max retries reached" - Order cleanup failed after maximum attempts
- "Token transfer failed" - Problem with token transfer during fill/cancel/cleanup
