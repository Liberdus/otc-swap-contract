// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract OTCSwap is ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    uint256 public constant ORDER_EXPIRY = 7 days;
    uint256 public constant GRACE_PERIOD = 7 days;
    uint256 public constant MAX_CLEANUP_BATCH = 10;  // Maximum orders to process in one call
    uint256 public constant FEE_DAMPENING_FACTOR = 9;  // Used in fee calculation to smooth changes
    uint256 public constant MIN_FEE_PERCENTAGE = 90;   // 90% of expected fee
    uint256 public constant MAX_FEE_PERCENTAGE = 150;  // 150% of expected fee
    uint256 public constant MAX_RETRY_ATTEMPTS = 10;   // Maximum number of retry attempts

    uint256 public orderCreationFee;
    uint256 public avgerageGasUsed;
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
        uint256 orderCreationFee;  // Fee paid when order was created
        uint256 tries;             // Number of cleanup attempts
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
        uint256 timestamp,
        uint256 orderCreationFee
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

    event RetryOrder(
        uint256 indexed oldOrderId,
        uint256 indexed newOrderId,
        address indexed maker,
        uint256 tries,
        uint256 timestamp
    );

    event CleanupFeesDistributed(
        address indexed recipient,
        uint256 amount,
        uint256 timestamp
    );

    event CleanupError(
        uint256 indexed orderId,
        string reason,
        uint256 timestamp
    );

    modifier validOrder(uint256 orderId) {
        require(orders[orderId].maker != address(0), "Order does not exist");
        require(orders[orderId].status == OrderStatus.Active, "Order is not active");
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
        
        // Calculate minimum and maximum acceptable fees
        uint256 minFee = (orderCreationFee * MIN_FEE_PERCENTAGE) / 100;
        uint256 maxFee = (orderCreationFee * MAX_FEE_PERCENTAGE) / 100;
        
        require(msg.value >= minFee, "Fee too low");
        require(msg.value <= maxFee, "Fee too high");
        
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
            status: OrderStatus.Active,
            orderCreationFee: msg.value,  // Store actual fee paid
            tries: 0                      // Initialize tries to 0
        });

        emit OrderCreated(
            orderId,
            msg.sender,
            taker,
            sellToken,
            sellAmount,
            buyToken,
            buyAmount,
            block.timestamp,
            msg.value  // Emit actual fee paid
        );

        // Update fee using dampening formula: fee = 100 * (9 * currentFee + gasUsed) / 10
        uint256 gasUsed = startGas - gasleft();
        averageGasUsed = (FEE_DAMPENING_FACTOR * averageGasUsed + gasUsed) / (FEE_DAMPENING_FACTOR + 1);
        orderCreationFee = 100 * averageGasUsed;

        return orderId;
    }

    function fillOrder(uint256 orderId) external nonReentrant validOrder(orderId) {
        Order storage order = orders[orderId];
        
        require(
            block.timestamp <= order.timestamp + ORDER_EXPIRY,
            "Order has expired"
        );
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

    function cancelOrder(uint256 orderId) external nonReentrant validOrder(orderId) {
        Order storage order = orders[orderId];
        require(order.maker == msg.sender, "Only maker can cancel order");
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

    function _handleFailedCleanup(
        uint256 orderId,
        Order storage order,
        string memory reason
    ) internal returns (uint256) {
        emit CleanupError(orderId, reason, block.timestamp);
        // If max retries reached, delete order and distribute fee
        if (order.tries >= MAX_RETRY_ATTEMPTS) {
            delete orders[orderId];
            emit CleanupError(orderId, "Max retries reached", block.timestamp);
            return order.orderCreationFee;
        } else {
            // Create new order with incremented tries
            uint256 newOrderId = nextOrderId++;
            orders[newOrderId] = Order({
                maker: order.maker,
                taker: order.taker,
                sellToken: order.sellToken,
                sellAmount: order.sellAmount,
                buyToken: order.buyToken,
                buyAmount: order.buyAmount,
                timestamp: block.timestamp,  // Reset timestamp for new retry delay
                status: order.status,       // Preserve original status
                orderCreationFee: order.orderCreationFee,
                tries: order.tries + 1
            });
            
            emit RetryOrder(
                orderId,
                newOrderId,
                order.maker,
                order.tries + 1,
                block.timestamp
            );
            
            delete orders[orderId];
            return 0;
        }
    }

    function cleanupExpiredOrders() external nonReentrant {
        uint256 feesToDistribute = 0;
        uint256 newFirstOrderId = firstOrderId;

        while (
            newFirstOrderId < nextOrderId && 
            gasleft() > orderCreationFee/100 &&  // Dynamic gas buffer based on current fee
            newFirstOrderId < firstOrderId + MAX_CLEANUP_BATCH // Limit batch size
        ) {
            Order storage order = orders[newFirstOrderId];
            
            // Skip empty orders
            if (order.maker == address(0)) {
                newFirstOrderId++;
                continue;
            }
            
            // Check if grace period has passed
            if (block.timestamp > order.timestamp + ORDER_EXPIRY + GRACE_PERIOD) {
                // Only attempt token transfer for Active orders or orders with previous failed transfers
                if (order.status == OrderStatus.Active || order.tries > 0) {
                    try this.attemptTransfer(IERC20(order.sellToken), order.maker, order.sellAmount) {
                        feesToDistribute += order.orderCreationFee;
                        address maker = order.maker;
                        delete orders[newFirstOrderId];
                        emit OrderCleanedUp(newFirstOrderId, maker, block.timestamp);
                    } catch Error(string memory reason) {
                        feesToDistribute += _handleFailedCleanup(newFirstOrderId, order, reason);
                    } catch (bytes memory) {
                        feesToDistribute += _handleFailedCleanup(newFirstOrderId, order, "Token transfer failed");
                    }
                } else {
                    // For Filled or Canceled orders with no previous transfer attempts,
                    // just delete and distribute fee
                    feesToDistribute += order.orderCreationFee;
                    address maker = order.maker;
                    delete orders[newFirstOrderId];
                    emit OrderCleanedUp(newFirstOrderId, maker, block.timestamp);
                }
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

    // Allow contract to receive native coin for creation fees
    receive() external payable {}

    function attemptTransfer(IERC20 token, address to, uint256 amount) external {
        require(msg.sender == address(this), "Only self");  // Optional but recommended security check
        token.safeTransfer(to, amount);
    }
}
