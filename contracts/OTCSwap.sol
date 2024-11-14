// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title OTCSwap
 * @dev Enables peer-to-peer token swaps with optional partner specification
 */
contract OTCSwap is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Order {
        address maker;
        address partner;     // Optional specific address that can fill this order
        address sellToken;
        uint256 sellAmount;
        address buyToken;
        uint256 buyAmount;
        uint256 createdAt;
        bool active;
    }

    // Mapping from order ID to Order
    mapping(uint256 => Order) public orders;
    uint256 public nextOrderId;

    // Events
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
        address indexed taker,
        address sellToken,
        uint256 sellAmount,
        address buyToken,
        uint256 buyAmount
    );

    event OrderCancelled(
        uint256 indexed orderId,
        address indexed maker
    );

    /**
     * @dev Creates a new swap order
     * @param partner Optional address that can fill this order. If zero address, anyone can fill
     * @param sellToken Address of the token to sell
     * @param sellAmount Amount of tokens to sell
     * @param buyToken Address of the token to buy
     * @param buyAmount Amount of tokens to buy
     */
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

        // Transfer sell tokens to contract
        IERC20(sellToken).safeTransferFrom(msg.sender, address(this), sellAmount);

        // Create order
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

    /**
     * @dev Fills an existing swap order
     * @param orderId ID of the order to fill
     */
    function fillOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.active, "Order not active");
        require(
            order.partner == address(0) || order.partner == msg.sender,
            "Not authorized partner"
        );

        // Mark order as inactive before transfers to prevent reentrancy
        order.active = false;

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
            msg.sender,
            order.sellToken,
            order.sellAmount,
            order.buyToken,
            order.buyAmount
        );
    }

    /**
     * @dev Cancels an existing order and returns tokens to maker
     * @param orderId ID of the order to cancel
     */
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.active, "Order not active");
        require(order.maker == msg.sender, "Not order maker");

        // Mark order as inactive
        order.active = false;

        // Return sell tokens to maker
        IERC20(order.sellToken).safeTransfer(msg.sender, order.sellAmount);

        emit OrderCancelled(orderId, msg.sender);
    }

    /**
     * @dev Gets the current order count
     */
    function getOrderCount() external view returns (uint256) {
        return nextOrderId;
    }

    /**
     * @dev Checks if an order is active
     * @param orderId ID of the order to check
     */
    function isOrderActive(uint256 orderId) external view returns (bool) {
        return orders[orderId].active;
    }

    /**
     * @dev Gets order details
     * @param orderId ID of the order to get
     */
    function getOrder(uint256 orderId) external view returns (
        address maker,
        address partner,
        address sellToken,
        uint256 sellAmount,
        address buyToken,
        uint256 buyAmount,
        uint256 createdAt,
        bool active
    ) {
        Order storage order = orders[orderId];
        return (
            order.maker,
            order.partner,
            order.sellToken,
            order.sellAmount,
            order.buyToken,
            order.buyAmount,
            order.createdAt,
            order.active
        );
    }

    /**
    * @dev Gets a batch of orders
 * @param offset Starting index
 * @param limit Maximum number of orders to return
 */
    function getOrders(uint256 offset, uint256 limit)
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
        bool[] memory actives
    )
    {
        // Check if offset is out of range
        if (offset >= nextOrderId) {
            // Return empty arrays if offset is beyond available orders
            makers = new address[](0);
            partners = new address[](0);
            sellTokens = new address[](0);
            sellAmounts = new uint256[](0);
            buyTokens = new address[](0);
            buyAmounts = new uint256[](0);
            createdAts = new uint256[](0);
            actives = new bool[](0);
            return (
                makers,
                partners,
                sellTokens,
                sellAmounts,
                buyTokens,
                buyAmounts,
                createdAts,
                actives
            );
        }

        // Calculate remaining orders from offset
        uint256 remainingOrders = nextOrderId - offset;
        // Adjust limit if it exceeds remaining orders
        uint256 actualLimit = limit > remainingOrders ? remainingOrders : limit;

        // Initialize arrays with actual size
        makers = new address[](actualLimit);
        partners = new address[](actualLimit);
        sellTokens = new address[](actualLimit);
        sellAmounts = new uint256[](actualLimit);
        buyTokens = new address[](actualLimit);
        buyAmounts = new uint256[](actualLimit);
        createdAts = new uint256[](actualLimit);
        actives = new bool[](actualLimit);

        // Fill arrays with order data
        for (uint256 i = 0; i < actualLimit; i++) {
            Order storage order = orders[offset + i];
            makers[i] = order.maker;
            partners[i] = order.partner;
            sellTokens[i] = order.sellToken;
            sellAmounts[i] = order.sellAmount;
            buyTokens[i] = order.buyToken;
            buyAmounts[i] = order.buyAmount;
            createdAts[i] = order.createdAt;
            actives[i] = order.active;
        }

        return (
            makers,
            partners,
            sellTokens,
            sellAmounts,
            buyTokens,
            buyAmounts,
            createdAts,
            actives
        );
    }
}
