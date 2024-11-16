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
        address taker;
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
        address indexed taker,
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
        address taker,
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
            taker: taker,
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
            taker,
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
            order.taker == address(0) || order.taker == msg.sender,
            "Not authorized taker"
        );
        require(
            block.timestamp <= order.createdAt + ORDER_EXPIRY,
            "Order expired"
        );

        // Mark order as inactive
        order.active = false;

        // Remove from active orders
        uint256 lastOrderId = activeOrderIds[activeOrderIds.length - 1];
        uint256 orderIndex = orderIdToIndex[orderId];
        activeOrderIds[orderIndex] = lastOrderId;
        orderIdToIndex[lastOrderId] = orderIndex;
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
        Order storage order = orders[orderId];
        require(order.active, "Order not active");
        require(order.maker == msg.sender, "Not order maker");

        // Mark order as inactive
        order.active = false;

        // Remove from active orders
        uint256 lastOrderId = activeOrderIds[activeOrderIds.length - 1];
        uint256 orderIndex = orderIdToIndex[orderId];
        activeOrderIds[orderIndex] = lastOrderId;
        orderIdToIndex[lastOrderId] = orderIndex;
        activeOrderIds.pop();
        delete orderIdToIndex[orderId];

        // Return sell tokens to maker
        IERC20(order.sellToken).safeTransfer(msg.sender, order.sellAmount);

        emit OrderCancelled(orderId, msg.sender, block.timestamp);
    }

    function getActiveOrders(
        uint256 offset,
        uint256 limit
    )
    external
    view
    returns (
        address[] memory makers,
        address[] memory takers,
        address[] memory sellTokens,
        uint256[] memory sellAmounts,
        address[] memory buyTokens,
        uint256[] memory buyAmounts,
        uint256[] memory createdAts,
        bool[] memory actives,
        uint256[] memory orderIds,
        uint256 nextOffset
    )
    {
        // Cap the limit to MAX_PAGE_SIZE
        uint256 actualLimit = limit > MAX_PAGE_SIZE ? MAX_PAGE_SIZE : limit;

        // Find starting index based on offset
        uint256 startIndex = 0;
        bool validOffset = false;
        if (offset > 0) {
            for (uint256 i = 0; i < activeOrderIds.length; i++) {
                if (activeOrderIds[i] == offset) {
                    startIndex = i;
                    validOffset = true;
                    break;
                }
            }
            // If offset is provided but not found, return empty arrays
            if (!validOffset) {
                makers = new address[](0);
                takers = new address[](0);
                sellTokens = new address[](0);
                sellAmounts = new uint256[](0);
                buyTokens = new address[](0);
                buyAmounts = new uint256[](0);
                createdAts = new uint256[](0);
                actives = new bool[](0);
                orderIds = new uint256[](0);
                nextOffset = 0;
                return (
                    makers,
                    takers,
                    sellTokens,
                    sellAmounts,
                    buyTokens,
                    buyAmounts,
                    createdAts,
                    actives,
                    orderIds,
                    nextOffset
                );
            }
        }

        // Count valid active orders from the starting index
        uint256 validCount = 0;
        for (
            uint256 i = startIndex;
            i < activeOrderIds.length && validCount < actualLimit;
            i++
        ) {
            Order storage order = orders[activeOrderIds[i]];
            if (block.timestamp <= order.createdAt + ORDER_EXPIRY) {
                validCount++;
            }
        }

        // Initialize arrays with the valid count
        makers = new address[](validCount);
        takers = new address[](validCount);
        sellTokens = new address[](validCount);
        sellAmounts = new uint256[](validCount);
        buyTokens = new address[](validCount);
        buyAmounts = new uint256[](validCount);
        createdAts = new uint256[](validCount);
        actives = new bool[](validCount);
        orderIds = new uint256[](validCount);

        // Fill arrays with active order data
        uint256 index = 0;
        for (
            uint256 i = startIndex;
            i < activeOrderIds.length && index < validCount;
            i++
        ) {
            uint256 orderId = activeOrderIds[i];
            Order storage order = orders[orderId];

            if (block.timestamp <= order.createdAt + ORDER_EXPIRY) {
                makers[index] = order.maker;
                takers[index] = order.taker;
                sellTokens[index] = order.sellToken;
                sellAmounts[index] = order.sellAmount;
                buyTokens[index] = order.buyToken;
                buyAmounts[index] = order.buyAmount;
                createdAts[index] = order.createdAt;
                actives[index] = true;
                orderIds[index] = orderId;
                index++;
            }
        }

        // Set nextOffset to the next orderId, or 0 if we've reached the end
        if (startIndex + index < activeOrderIds.length) {
            nextOffset = activeOrderIds[startIndex + index];
        } else {
            nextOffset = 0;
        }

        return (
            makers,
            takers,
            sellTokens,
            sellAmounts,
            buyTokens,
            buyAmounts,
            createdAts,
            actives,
            orderIds,
            nextOffset
        );
    }
}
