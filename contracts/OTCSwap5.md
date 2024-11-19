# OTC Swap Contract - Frontend Developer Guide

## Overview
This guide explains key aspects of interacting with the OTC Swap contract from a frontend perspective. The contract manages peer-to-peer token swaps with an automatic cleanup mechanism and dynamic fee adjustment.

## Key Features
- Direct peer-to-peer token swaps
- Small order creation fee to prevent spam
- Automatic adjustment of order creation fee based on gas usage
- 7-day order expiry with 7-day grace period
- Incentivized, permissionless order cleanup with rewards for cleaner
- Retry mechanism for failed cleanup operations

## How it Works
- Any user can create an order specifying the sell token the buy token and the amounts; the user creating the order is called the maker
- The maker can optionally specify the address of the taker; if not provided then anyone can be a taker
- To prevent spam and only allow serious orders there is a non-refundable order creation fee
- The maker can cancel the order at anytime if the trade is no longer fair and loses only the order creation fee
- If the order is filled the tokens from the taker are sent to the maker and the tokens locked in the contract are sent to the taker
- If an order is not filled within 7 days it is considered expired and can no longer be filled
- If an order has expired the maker should cancel the order to get the locked token back
- If the maker does not cancel the order within 7 days of the order expiring, the maker has to wait for the contract to cancel the order
- Anyone can call the cleanup function on the contract to delete orders that are older than 14 days
- When an Active order is cleaned up, any tokens that are still locked by the order are sent back to the maker
- To incentivize people to call the cleanup function the order creation fee is given to the caller when the order is deleted
- If an order could not be cleaned due to token transfer to maker failing, the order is reset as a new order and can be filled again
- If the order could not be cleaned after 10 attempts at 14 day intervals, the order is force deleted and the fees are distributed

## Building the Order Book State

### Event-Based State Building
The contract emits comprehensive events that allow rebuilding the complete state of active orders. You should query events from the last 14 days (7 days expiry + 7 days grace period) to ensure you catch all relevant orders.

Key Events to Monitor:
```solidity
OrderCreated(uint256 indexed orderId, address indexed maker, address indexed taker, address sellToken, uint256 sellAmount, address buyToken, uint256 buyAmount, uint256 timestamp, uint256 orderCreationFee)
OrderFilled(uint256 indexed orderId, address indexed maker, address indexed taker, address sellToken, uint256 sellAmount, address buyToken, uint256 buyAmount, uint256 timestamp)
OrderCanceled(uint256 indexed orderId, address indexed maker, uint256 timestamp)
OrderCleanedUp(uint256 indexed orderId, address indexed maker, uint256 timestamp)
RetryOrder(uint256 indexed oldOrderId, uint256 indexed newOrderId, address indexed maker, uint256 tries, uint256 timestamp)
CleanupFeesDistributed(address indexed recipient, uint256 amount, uint256 timestamp)
CleanupError(uint256 indexed orderId, string reason, uint256 timestamp)
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
            orderCreationFee: event.args.orderCreationFee
        };
        return acc;
    }, {});
```

## Order Creation Fee

The contract dynamically adjusts the order creation fee based on gas usage with a dampening mechanism to prevent high volatility. The fee for creating an order can be read directly from the contract:

```javascript
const orderCreationFee = await contract.orderCreationFee();
```

Important notes about the fee:
- Fee adjusts automatically after each order creation using a dampening formula
- Fee must be within 90-150% of the expected fee amount
- First ever order can be created with zero fee
- Fee is calculated using the formula: fee = 100 * (9 * currentFee + gasUsed) / 10
- Fee must be sent with the transaction in the native coin
- Fee is the same regardless of gas price used

## Cleanup Mechanism

The contract incentivizes cleanup of expired orders through rewards:

1. Orders become eligible for cleanup after:
   - 7 days (ORDER_EXPIRY) + 7 days (GRACE_PERIOD) = 14 days total
   - Applies to all orders regardless of status (Active, Filled, or Canceled)

2. Anyone can call cleanupExpiredOrders():
   - No parameters needed
   - Processes orders sequentially from firstOrderId
   - Stops at first non-cleanable order
   - Limited to MAX_CLEANUP_BATCH (10) orders per call
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
    
    // Look at up to MAX_CLEANUP_BATCH orders
    const batchEndId = Math.min(firstOrderId + 10, nextOrderId);
    
    for (let orderId = firstOrderId; orderId < batchEndId; orderId++) {
        const order = await contract.orders(orderId);
        
        // Skip empty orders
        if (order.maker === '0x0000000000000000000000000000000000000000') {
            continue;
        }
        
        // Check if grace period has passed
        if (currentTime > order.timestamp.toNumber() + (14 * 24 * 60 * 60)) {
            reward += order.orderCreationFee.toBigInt();
        } else {
            break; // Stop at first non-cleanable order
        }
    }
    
    return reward;
}
```

## Key Contract Parameters

Direct Read Access:
```javascript
const firstOrderId = await contract.firstOrderId();
const nextOrderId = await contract.nextOrderId();
const orderCreationFee = await contract.orderCreationFee();
const accumulatedFees = await contract.accumulatedFees();
```

Constants:
```javascript
const ORDER_EXPIRY = 7 * 24 * 60 * 60;    // 7 days in seconds
const GRACE_PERIOD = 7 * 24 * 60 * 60;    // 7 days in seconds
const MAX_CLEANUP_BATCH = 10;             // Max orders per cleanup
const FEE_DAMPENING_FACTOR = 9;           // Used in fee calculation
const MIN_FEE_PERCENTAGE = 90;            // 90% of expected fee
const MAX_FEE_PERCENTAGE = 150;           // 150% of expected fee
const MAX_RETRY_ATTEMPTS = 10;            // Maximum cleanup retries
```

## Event Subscriptions

To maintain real-time state:
```javascript
contract.on("OrderCreated", (orderId, maker, taker, sellToken, sellAmount, buyToken, buyAmount, timestamp, orderCreationFee) => {
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

contract.on("CleanupFeesDistributed", (recipient, amount, timestamp) => {
    // Track cleanup rewards
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
- "Order has expired" - Past 7-day expiry
- "Not authorized to fill this order" - Wrong taker address
- "Only maker can cancel order" - Non-maker tried to cancel
- "Grace period has expired" - Tried to cancel after grace period
- "Fee too low" - Fee amount below minimum threshold
- "Fee too high" - Fee amount above maximum threshold
- "Fee transfer failed" - Problem sending cleanup reward
- "Max retries reached" - Order cleanup failed after maximum attempts
