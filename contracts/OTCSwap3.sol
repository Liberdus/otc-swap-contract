// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract OTCSwap is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    
    uint256 public constant ORDER_EXPIRY = 7 days;
    uint256 public constant GRACE_PERIOD = 7 days;
    uint256 public constant GAS_BUFFER = 50000;  // Gas to keep for cleanup completion
    uint256 public constant MAX_CLEANUP_BATCH = 100;  // Maximum orders to process in one call

    uint256 public orderCreationFee;
    uint256 public accumulatedFees;
    uint256 public firstOrderId;  // First potentially active order
    uint256 public nextOrderId;   // Next order ID to be assigned

    enum OrderStatus {
        Active,     // Order is active and can be filled
        Filled,     // Order was filled
        Canceled    // Order was canceled by maker
    }

    struct Order {
        address maker;
        address taker;  // address(0) if open to anyone
        address sellToken;
        uint256 sellAmount;
        address buyToken;
        uint256 buyAmount;
        uint256 timestamp;
        OrderStatus status;
    }

    mapping(uint256 => Order) public orders;

    event OrderCreated(
        uint256 indexed orderId,
        address indexed maker,
        address indexed taker,
        address sellToken,
        uint256 sellAmount,
        address buyToken,
        uint256 buyAmount,
        uint256 timestamp
    );

    event OrderFilled(
        uint256 indexed orderId,
        address indexed maker,
        address indexed taker,
        address sellToken,
        uint256 sellAmount,
        address buyToken,
        uint256 buyAmount,
        uint256 timestamp
    );

    event OrderCanceled(
        uint256 indexed orderId,
        address indexed maker,
        uint256 timestamp
    );

    event OrderCleanedUp(
        uint256 indexed orderId,
        address indexed maker,
        uint256 timestamp
    );

    event CleanupFeesDistributed(
        address indexed recipient,
        uint256 amount,
        uint256 timestamp
    );

    modifier validOrder(uint256 orderId) {
        require(orders[orderId].maker != address(0), "Order does not exist");
        require(orders[orderId].status == OrderStatus.Active, "Order is not active");
        require(
            block.timestamp <= orders[orderId].timestamp + ORDER_EXPIRY,
            "Order has expired"
        );
        _;
    }

    constructor() {}

    function createOrder(
        address taker,
        address sellToken,
        uint256 sellAmount,
        address buyToken,
        uint256 buyAmount
    ) external payable nonReentrant returns (uint256) {
        uint256 startGas = gasleft();
        require(msg.value == orderCreationFee, "Incorrect fee amount");
        require(sellToken != address(0), "Invalid sell token");
        require(buyToken != address(0), "Invalid buy token");
        require(sellAmount > 0, "Invalid sell amount");
        require(buyAmount > 0, "Invalid buy amount");
        require(sellToken != buyToken, "Cannot swap same token");

        require(
            IERC20(sellToken).balanceOf(msg.sender) >= sellAmount,
            "Insufficient balance for sell token"
        );
        require(
            IERC20(sellToken).allowance(msg.sender, address(this)) >= sellAmount,
            "Insufficient allowance for sell token"
        );

        // Accumulate the creation fee
        accumulatedFees += msg.value;

        IERC20(sellToken).safeTransferFrom(msg.sender, address(this), sellAmount);

        uint256 orderId = nextOrderId++;
        
        orders[orderId] = Order({
            maker: msg.sender,
            taker: taker,
            sellToken: sellToken,
            sellAmount: sellAmount,
            buyToken: buyToken,
            buyAmount: buyAmount,
            timestamp: block.timestamp,
            status: OrderStatus.Active
        });

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

        // Update fee for next order based on gas usage
        orderCreationFee = (startGas - gasleft()) * 100;

        return orderId;
    }

    function fillOrder(uint256 orderId) external nonReentrant validOrder(orderId) {
        Order storage order = orders[orderId];
        
        require(
            order.taker == address(0) || order.taker == msg.sender,
            "Not authorized to fill this order"
        );

        require(
            IERC20(order.buyToken).balanceOf(msg.sender) >= order.buyAmount,
            "Insufficient balance for buy token"
        );
        require(
            IERC20(order.buyToken).allowance(msg.sender, address(this)) >= order.buyAmount,
            "Insufficient allowance for buy token"
        );

        // Transfer buy tokens from taker to maker
        IERC20(order.buyToken).safeTransferFrom(
            msg.sender,
            order.maker,
            order.buyAmount
        );

        // Transfer sell tokens from contract to taker
        IERC20(order.sellToken).safeTransfer(msg.sender, order.sellAmount);

        // Update order status
        order.status = OrderStatus.Filled;

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
        require(order.maker != address(0), "Order does not exist");
        require(order.maker == msg.sender, "Only maker can cancel order");
        require(order.status == OrderStatus.Active, "Order is not active");
        
        // Check if within cancellation window (expiry + grace period)
        require(
            block.timestamp <= order.timestamp + ORDER_EXPIRY + GRACE_PERIOD,
            "Grace period has expired"
        );

        // Return sell tokens to maker
        IERC20(order.sellToken).safeTransfer(msg.sender, order.sellAmount);

        // Update order status
        order.status = OrderStatus.Canceled;

        emit OrderCanceled(orderId, msg.sender, block.timestamp);
    }

    function cleanupExpiredOrders() external nonReentrant {
        uint256 gasStart = gasleft();
        uint256 feesToDistribute = 0;
        uint256 newFirstOrderId = firstOrderId;

        while (
            newFirstOrderId < nextOrderId && 
            gasleft() > GAS_BUFFER &&  // Prevent out-of-gas errors
            newFirstOrderId < firstOrderId + MAX_CLEANUP_BATCH // Limit batch size
        ) {
            Order storage order = orders[newFirstOrderId];
            
            if (order.maker == address(0) || order.status != OrderStatus.Active) {
                newFirstOrderId++;
                continue;
            }
            
            if (block.timestamp > order.timestamp + ORDER_EXPIRY + GRACE_PERIOD) {
                // Return tokens and cleanup
                IERC20(order.sellToken).safeTransfer(order.maker, order.sellAmount);
                feesToDistribute += orderCreationFee;
                
                address maker = order.maker;
                delete orders[newFirstOrderId];
                
                emit OrderCleanedUp(newFirstOrderId, maker, block.timestamp);
                newFirstOrderId++;
            } else {
                break;  // Found an order that can't be cleaned up yet
            }
        }

        if (newFirstOrderId > firstOrderId) {
            firstOrderId = newFirstOrderId;
        }

        if (feesToDistribute > 0 && feesToDistribute <= accumulatedFees) {
            accumulatedFees -= feesToDistribute;
            (bool success, ) = msg.sender.call{value: feesToDistribute}("");
            require(success, "Fee transfer failed");
            emit CleanupFeesDistributed(msg.sender, feesToDistribute, block.timestamp);
        }
    }

    function getCleanupReward() 
        external 
        view 
        returns (uint256 nativeCoinReward) 
    {
        uint256 currentId = firstOrderId;
        uint256 endId = currentId + MAX_CLEANUP_BATCH;
        if (endId > nextOrderId) {
            endId = nextOrderId;
        }

        while (currentId < endId) {
            Order storage order = orders[currentId];
            if (order.maker != address(0) &&
                order.status == OrderStatus.Active &&
                block.timestamp > order.timestamp + ORDER_EXPIRY + GRACE_PERIOD) {
                nativeCoinReward += orderCreationFee;
            }
            currentId++;
        }
    }

    // Allow contract to receive native coin for creation fees
    receive() external payable {}
}
