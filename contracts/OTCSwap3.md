# OTC Swap Contract - Frontend Developer Guide

## Overview
This guide explains key aspects of interacting with the OTC Swap contract from a frontend perspective. The contract manages peer-to-peer token swaps with an automatic cleanup mechanism and dynamic fee adjustment.

## Key Features
- Direct peer-to-peer token swaps
- Automatic adjustment of order creation fee based on gas usage
- 7-day order expiry with 7-day grace period
- Permissionless order cleanup with rewards
- Any user can create an order specifying the sell token the buy token and the amounts; the user creating the order is called the maker
- The maker can optionally specify the address of the taker; if not provided then anyone can be a taker
- To preven spam and only allow serious orders there is a nonrefundable order creation fee
- If an order is not filled within 7 days it is considered expired and can no longer be filled
- If an order has expired the maker should cancel the order to get the locked token back
- If the maker does not cancel the order within 7 days of the order expiring the grace period is over and the maker has to wait for the contract to cancel the order
- Anyone can call the cleanup function on the contract to delete orders that are older than 14 days
- To incentivize people to call the cleanup function the order creation fees that were collected for the deleted orders are given to the caller

## Building the Order Book State

### Event-Based State Building
The contract emits comprehensive events that allow rebuilding the complete state of active orders. You should query events from the last 14 days (7 days expiry + 7 days grace period) to ensure you catch all relevant orders.

Key Events to Monitor:
```solidity
OrderCreated(uint256 orderId, address maker, address taker, address sellToken, uint256 sellAmount, address buyToken, uint256 buyAmount, uint256 timestamp)
OrderFilled(uint256 orderId, address maker, address taker, address sellToken, uint256 sellAmount, address buyToken, uint256 buyAmount, uint256 timestamp)
OrderCanceled(uint256 orderId, address maker, uint256 timestamp)
OrderCleanedUp(uint256 orderId, address maker, uint256 timestamp)
```

Building State Algorithm:
1. Query OrderCreated events for last 14 days
2. For each order:
   - Check OrderFilled events (order inactive if filled)
   - Check OrderCanceled events (order inactive if canceled)
   - Check OrderCleanedUp events (order deleted if cleaned)
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

// Create lookup maps for filled/canceled/cleaned orders
const filledOrders = new Set(filledEvents.map(e => e.args.orderId.toString()));
const canceledOrders = new Set(canceledEvents.map(e => e.args.orderId.toString()));
const cleanedOrders = new Set(cleanedEvents.map(e => e.args.orderId.toString()));

// Build active orders map
const activeOrders = createdEvents
    .filter(event => {
        const orderId = event.args.orderId.toString();
        const isExpired = event.args.timestamp + EXPIRY < Date.now()/1000;
        return !filledOrders.has(orderId) && 
               !canceledOrders.has(orderId) && 
               !cleanedOrders.has(orderId) &&
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
            timestamp: event.args.timestamp
        };
        return acc;
    }, {});
```

## Order Creation Fee

The contract dynamically adjusts the order creation fee based on gas usage. The fee for creating an order can be read directly from the contract:

```javascript
const orderCreationFee = await contract.orderCreationFee();
```

Important notes about the fee:
- Fee adjusts automatically after each order creation
- First ever order can be created with zero fee
- Fee is based purely on gas used (gasUsed * 100)
- Fee must be sent with the transaction in the native coin
- Fee is the same regardless of gas price used

## Cleanup Mechanism

The contract incentivizes cleanup of expired orders through rewards:

1. Orders become eligible for cleanup after:
   - 7 days (ORDER_EXPIRY) + 7 days (GRACE_PERIOD) = 14 days total
   - Only if they haven't been filled or canceled

2. Anyone can call cleanupExpiredOrders():
   - No parameters needed
   - Processes orders sequentially from firstOrderId
   - Stops at first non-cleanable order
   - Limited to MAX_CLEANUP_BATCH (100) orders per call
   - Caller receives accumulated creation fees as reward

3. Check potential reward before cleaning:
```javascript
const reward = await contract.getCleanupReward();
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
const MAX_CLEANUP_BATCH = 100;            // Max orders per cleanup
```

## Event Subscriptions

To maintain real-time state:
```javascript
contract.on("OrderCreated", (orderId, maker, taker, sellToken, sellAmount, buyToken, buyAmount, timestamp) => {
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
```

## Error Handling

Common error messages to handle:
- "Incorrect fee amount" - Wrong amount of native coin sent
- "Invalid sell token" - Zero address provided
- "Invalid buy token" - Zero address provided
- "Invalid sell amount" - Zero amount provided
- "Invalid buy amount" - Zero amount provided
- "Cannot swap same token" - Sell and buy tokens are the same
- "Insufficient balance for sell token" - Maker doesn't have enough tokens
- "Insufficient allowance for sell token" - Contract not approved to transfer tokens
- "Order does not exist" - Invalid order ID
- "Order is not active" - Order already filled/canceled
- "Order has expired" - Past 7-day expiry
- "Not authorized to fill this order" - Wrong taker address
- "Only maker can cancel order" - Non-maker tried to cancel
- "Grace period has expired" - Tried to cancel after grace period
- "Fee transfer failed" - Problem sending cleanup reward
