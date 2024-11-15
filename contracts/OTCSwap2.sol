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

    struct OrderInfo {
        uint256 orderId;  // Added field for order identification
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
      
        // Update activeOrderIds array by replacing with last element
        uint256 orderIndex = orderIdToIndex[orderId];
        uint256 lastOrderId = activeOrderIds[activeOrderIds.length - 1];
        activeOrderIds[orderIndex] = lastOrderId;
        orderIdToIndex[lastOrderId] = orderIndex;
        activeOrderIds.pop();
        delete orderIdToIndex[orderId];
      
        // Delete cancelled order for gas refund
        delete orders[orderId];
      
        // Return sell tokens to maker
        IERC20(sellToken).safeTransfer(msg.sender, sellAmount);
      
        emit OrderCancelled(orderId, msg.sender, block.timestamp);
    }

    function getActiveOrders(uint256 offset, uint256 limit) 
        external 
        view 
        returns (OrderInfo[] memory orderInfos, uint256 nextOffset) 
    {
        // Cap the limit to MAX_PAGE_SIZE
        uint256 actualLimit = limit > MAX_PAGE_SIZE ? MAX_PAGE_SIZE : limit;
        
        // Calculate how many orders we can return
        uint256 remaining = activeOrderIds.length > offset ? 
            activeOrderIds.length - offset : 0;
        uint256 resultCount = remaining < actualLimit ? remaining : actualLimit;
        
        // Create array of exact size needed
        orderInfos = new OrderInfo[](resultCount);
        
        // Fill array with active, non-expired orders
        uint256 added = 0;
        for (uint256 i = 0; i < resultCount && (offset + i) < activeOrderIds.length; i++) {
            uint256 orderId = activeOrderIds[offset + i];
            Order storage order = orders[orderId];
            
            // Skip expired orders
            if (block.timestamp > order.createdAt + ORDER_EXPIRY) {
                continue;
            }
            
            orderInfos[added] = OrderInfo({
                orderId: orderId,
                maker: order.maker,
                partner: order.partner,
                sellToken: order.sellToken,
                sellAmount: order.sellAmount,
                buyToken: order.buyToken,
                buyAmount: order.buyAmount,
                createdAt: order.createdAt,
                active: order.active
            });
            added++;
        }
        
        // If we have more orders that could be retrieved
        nextOffset = offset + resultCount < activeOrderIds.length ? 
            offset + resultCount : 0;
            
        return (orderInfos, nextOffset);
    }
}

