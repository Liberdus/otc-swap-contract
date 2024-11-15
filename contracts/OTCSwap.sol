// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract OTCSwap is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_PAGE_SIZE = 100;
    uint256 public constant ORDER_EXPIRY = 7 days;

    struct Order {
        address maker;
        address partner;
        address sellToken;
        uint256 sellAmount;
        address buyToken;
        uint256 buyAmount;
        uint256 createdAt;
        bool active;
    }

    mapping(uint256 => Order) public orders;
    uint256 public nextOrderId;

    // Track active order IDs in an array
    uint256[] private activeOrderIds;
    mapping(uint256 => uint256) private orderIdToIndex; // orderId => index in activeOrderIds

    event OrderCreated(
        uint256 indexed orderId,
        address indexed maker,
        address indexed partner,
        address sellToken,
        uint256 sellAmount,
        address buyToken,
        uint256 buyAmount,
        uint256 createdAt
    );

    event OrderFilled(
        uint256 indexed orderId,
        address indexed maker,
        address indexed taker,
        address sellToken,
        uint256 sellAmount,
        address buyToken,
        uint256 buyAmount,
        uint256 filledAt
    );

    event OrderCancelled(
        uint256 indexed orderId,
        address indexed maker,
        uint256 cancelledAt
    );

    function createOrder(
        address partner,
        address sellToken,
        uint256 sellAmount,
        address buyToken,
        uint256 buyAmount
    ) external nonReentrant returns (uint256) {
        require(sellToken != address(0), "Invalid sell token");
        require(buyToken != address(0), "Invalid buy token");
        require(sellToken != buyToken, "Same tokens");
        require(sellAmount > 0, "Invalid sell amount");
        require(buyAmount > 0, "Invalid buy amount");

        require(
            IERC20(sellToken).allowance(msg.sender, address(this)) >= sellAmount,
            "Insufficient allowance"
        );

        require(
            IERC20(sellToken).balanceOf(msg.sender) >= sellAmount,
            "Insufficient balance"
        );

        IERC20(sellToken).safeTransferFrom(msg.sender, address(this), sellAmount);

        uint256 orderId = nextOrderId++;
        orders[orderId] = Order({
            maker: msg.sender,
            partner: partner,
            sellToken: sellToken,
            sellAmount: sellAmount,
            buyToken: buyToken,
            buyAmount: buyAmount,
            createdAt: block.timestamp,
            active: true
        });

        // Add to active orders index
        orderIdToIndex[orderId] = activeOrderIds.length;
        activeOrderIds.push(orderId);

        emit OrderCreated(
            orderId,
            msg.sender,
            partner,
            sellToken,
            sellAmount,
            buyToken,
            buyAmount,
            block.timestamp
        );

        return orderId;
    }

    function fillOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.active, "Order not active");
        require(
            order.partner == address(0) || order.partner == msg.sender,
            "Not authorized partner"
        );
        require(
            block.timestamp <= order.createdAt + ORDER_EXPIRY,
            "Order expired"
        );

        // Mark order as inactive but preserve the data
        order.active = false;

        // replace the order with the last order in activeOrderIds
        uint256 lastOrderId = activeOrderIds[activeOrderIds.length - 1];
        uint256 orderIndex = orderIdToIndex[orderId];
        activeOrderIds[orderIndex] = lastOrderId;
        orderIdToIndex[lastOrderId] = orderIndex;
        // delete the last order as it is now a duplicate
        activeOrderIds.pop();
        delete orderIdToIndex[orderId];

        // Transfer buy tokens from taker to maker
        IERC20(order.buyToken).safeTransferFrom(
            msg.sender,
            order.maker,
            order.buyAmount
        );

        // Transfer sell tokens from contract to taker
        IERC20(order.sellToken).safeTransfer(msg.sender, order.sellAmount);

        emit OrderFilled(
            orderId,
            order.maker,
            msg.sender,
            order.sellToken,
            order.sellAmount,
            order.buyToken,
            order.buyAmount,
            block.timestamp
        );
    }

    function cancelOrder(uint256 orderId) external nonReentrant {
        Order memory order = orders[orderId];
        require(order.active, "Order not active");
        require(order.maker == msg.sender, "Not order maker");

        // Store values needed for transfer and event
        address sellToken = order.sellToken;
        uint256 sellAmount = order.sellAmount;

        // Delete cancelled order for gas refund
        delete orders[orderId];

        // Return sell tokens to maker
        IERC20(sellToken).safeTransfer(msg.sender, sellAmount);

        emit OrderCancelled(orderId, msg.sender, block.timestamp);
    }

    function getActiveOrders(uint256 offset, uint256 limit)
    external
    view
    returns (
        address[] memory makers,
        address[] memory partners,
        address[] memory sellTokens,
        uint256[] memory sellAmounts,
        address[] memory buyTokens,
        uint256[] memory buyAmounts,
        uint256[] memory createdAts,
        bool[] memory actives,
        uint256 nextOffset
    )
    {
        // Cap the limit to MAX_PAGE_SIZE
        uint256 actualLimit = limit > MAX_PAGE_SIZE ? MAX_PAGE_SIZE : limit;

        // If offset is 0, start from the latest order
        // Otherwise start from the provided offset
        uint256 current = offset == 0 ? nextOrderId - 1 : offset - 1;

        // First pass: Count valid orders
        uint256 validCount = 0;
        uint256 cursor = current;

        while (validCount < actualLimit && cursor >= 0) {
            Order storage order = orders[cursor];
            if (order.maker != address(0) &&
            order.active &&
                block.timestamp <= order.createdAt + ORDER_EXPIRY) {
                validCount++;
            }
            if (cursor == 0) break;
            cursor--;
        }

        // Create arrays of exact size needed
        makers = new address[](validCount);
        partners = new address[](validCount);
        sellTokens = new address[](validCount);
        sellAmounts = new uint256[](validCount);
        buyTokens = new address[](validCount);
        buyAmounts = new uint256[](validCount);
        createdAts = new uint256[](validCount);
        actives = new bool[](validCount);

        // Second pass: Fill arrays
        uint256 index = 0;
        cursor = current;

        // Fill arrays by scanning backwards from current
        while (index < validCount && cursor >= 0) {
            Order storage order = orders[cursor];
            if (order.maker != address(0) &&
            order.active &&
                block.timestamp <= order.createdAt + ORDER_EXPIRY) {
                makers[index] = order.maker;
                partners[index] = order.partner;
                sellTokens[index] = order.sellToken;
                sellAmounts[index] = order.sellAmount;
                buyTokens[index] = order.buyToken;
                buyAmounts[index] = order.buyAmount;
                createdAts[index] = order.createdAt;
                actives[index] = true;
                index++;
            }
            if (cursor == 0) break;
            cursor--;
        }

        // Return cursor as nextOffset for the next page
        nextOffset = cursor;

        return (
            makers,
            partners,
            sellTokens,
            sellAmounts,
            buyTokens,
            buyAmounts,
            createdAts,
            actives,
            nextOffset
        );
    }
}
