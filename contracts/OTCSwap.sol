// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract OTCSwap is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant ORDER_EXPIRY = 7 days;
    uint256 public constant GRACE_PERIOD = 7 days;
    uint256 public constant MAX_CLEANUP_BATCH = 1;  // Changed from 10 to 1
    uint256 public constant FEE_DAMPENING_FACTOR = 9;  // Used in fee calculation to smooth changes
    uint256 public constant MIN_FEE_PERCENTAGE = 90;   // 90% of expected fee
    uint256 public constant MAX_FEE_PERCENTAGE = 150;  // 150% of expected fee
    uint256 public constant MAX_RETRY_ATTEMPTS = 10;   // Maximum number of retry attempts

    uint256 public orderCreationFee;
    uint256 public averageGasUsed;
    uint256 public accumulatedFees;
    uint256 public firstOrderId;  // First potentially active order
    uint256 public nextOrderId;   // Next order ID to be assigned
    bool public isDisabled;       // Contract disabled status

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

    event ContractDisabled(
        address indexed owner,
        uint256 timestamp
    );

    event TransferError(
        uint256 indexed orderId,
        string tokenType,
        string reason,
        uint256 timestamp
    );

    event TokenTransferAttempt(
        uint256 indexed orderId,
        bool success,
        bytes returnData,
        uint256 fromBalance,
        uint256 toBalance,
        uint256 timestamp
    );

    modifier validOrder(uint256 orderId) {
        require(orders[orderId].maker != address(0), "Order does not exist");
        require(orders[orderId].status == OrderStatus.Active, "Order is not active");
        _;
    }

    constructor() Ownable(msg.sender) {}

    function disableContract() external onlyOwner {
        require(!isDisabled, "Contract already disabled");
        isDisabled = true;
        emit ContractDisabled(msg.sender, block.timestamp);
    }

    function createOrder(
        address taker,
        address sellToken,
        uint256 sellAmount,
        address buyToken,
        uint256 buyAmount
    ) external payable nonReentrant returns (uint256) {
        require(!isDisabled, "Contract is disabled");

        uint256 startGas = gasleft();

        // Calculate minimum and maximum acceptable fees
        uint256 minFee = (orderCreationFee * MIN_FEE_PERCENTAGE) / 100;
        uint256 maxFee = (orderCreationFee * MAX_FEE_PERCENTAGE) / 100;

        require(msg.value >= minFee, "Fee too low");
        require(nextOrderId == 0 || msg.value <= maxFee, "Fee too high");

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

        // Update order status first
        order.status = OrderStatus.Filled;

        // First transfer: buyToken from buyer to maker (using transferFrom)
        try this.externalTransferFrom(IERC20(order.buyToken), msg.sender, order.maker, order.buyAmount) {
            // Second transfer: sellToken from contract to buyer
            try this.externalTransfer(IERC20(order.sellToken), msg.sender, order.sellAmount) {
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
            } catch Error(string memory reason) {
                // Revert order status since second transfer failed
                order.status = OrderStatus.Active;
                emit TransferError(orderId, "sellToken", reason, block.timestamp);
                revert(string(abi.encodePacked("Sell token transfer failed: ", reason)));
            } catch (bytes memory) {
                // Revert order status since second transfer failed
                order.status = OrderStatus.Active;
                emit TransferError(orderId, "sellToken", "Unknown error", block.timestamp);
                revert("Sell token transfer failed with unknown error");
            }
        } catch Error(string memory reason) {
            // Revert order status since first transfer failed
            order.status = OrderStatus.Active;
            emit TransferError(orderId, "buyToken", reason, block.timestamp);
            revert(string(abi.encodePacked("Buy token transfer failed: ", reason)));
        } catch (bytes memory) {
            // Revert order status since first transfer failed
            order.status = OrderStatus.Active;
            emit TransferError(orderId, "buyToken", "Unknown error", block.timestamp);
            revert("Buy token transfer failed with unknown error");
        }
    }

    // Public function to enable try/catch for external transfers
    function externalTransfer(IERC20 token, address to, uint256 amount) external {
        require(msg.sender == address(this), "Only callable by the contract itself");
        token.safeTransfer(to, amount);
    }

    // Public function to enable try/catch for external transferFrom
    function externalTransferFrom(IERC20 token, address from, address to, uint256 amount) external {
        require(msg.sender == address(this), "Only callable by the contract itself");
        token.safeTransferFrom(from, to, amount);
    }

    function cancelOrder(uint256 orderId) external nonReentrant validOrder(orderId) {
        Order storage order = orders[orderId];
        require(order.maker == msg.sender, "Only maker can cancel order");
        require(
            block.timestamp <= order.timestamp + ORDER_EXPIRY + GRACE_PERIOD,
            "Grace period has expired"
        );

        // Update order status first
        order.status = OrderStatus.Canceled;

        // Then return sell tokens to maker
        IERC20(order.sellToken).safeTransfer(msg.sender, order.sellAmount);

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
            emit CleanupError(orderId, "Max retries reached", block.timestamp);
            delete orders[orderId];
            return order.orderCreationFee;
        } else {
            // check if order.maker is not a zero address
            require(order.maker != address(0), "Order maker is zero address in cleanup");

            // Create a deep copy of the order in memory before modifying it
            Order memory tempOrder = Order({
                maker: order.maker,
                sellToken: order.sellToken,
                buyToken: order.buyToken,
                sellAmount: order.sellAmount,
                buyAmount: order.buyAmount,
                tries: order.tries + 1,
                status: OrderStatus.Active,
                timestamp: block.timestamp,
                taker: order.taker,
                orderCreationFee: order.orderCreationFee
            });
            require(tempOrder.maker != address(0), "tempOrder maker is zero address in cleanup");

            // Create new order with incremented tries
            uint256 newOrderId = nextOrderId++;
            orders[newOrderId] = tempOrder;

            require(orders[newOrderId].maker != address(0), "orders[newOrderId] maker is zero address in cleanup");

            emit RetryOrder(
                orderId,
                newOrderId,
                orders[newOrderId].maker,
                orders[newOrderId].tries,
                block.timestamp
            );

            // Optionally delete the original order if needed
            delete orders[orderId];

            return 0;
        }
    }

    // Add another event for more granular debugging
    event TransferDebug(
        uint256 indexed orderId,
        bool tryCatchEntered,
        bool transferSuccess,
        string details
    );

    function cleanupExpiredOrders() external nonReentrant {
        uint256 feesToDistribute = 0;
        uint256 newFirstOrderId = firstOrderId;

        while (
            newFirstOrderId < nextOrderId &&
            newFirstOrderId < firstOrderId + MAX_CLEANUP_BATCH
        ) {
            Order storage order = orders[newFirstOrderId];

            // Skip empty orders
            if (order.maker == address(0)) {
                newFirstOrderId++;
                continue;
            }

            // Check if grace period has passed
            if (block.timestamp > order.timestamp + ORDER_EXPIRY + GRACE_PERIOD) {

                // Only attempt token transfer for Active orders
                if (order.status == OrderStatus.Active) {
                    IERC20 token = IERC20(order.sellToken);

                    bool transferSuccess;
                    try this.attemptTransfer(token, order.maker, order.sellAmount) {
                        transferSuccess = true;
                    } catch Error(string memory reason) {
                        transferSuccess = false;
                        emit CleanupError(newFirstOrderId, reason, block.timestamp);
                    } catch (bytes memory err) {
                        transferSuccess = false;
                        emit CleanupError(newFirstOrderId, "Unknown error", block.timestamp);
                    }

                    if (!transferSuccess) {
                        // Transfer failed, handle cleanup
                        feesToDistribute += _handleFailedCleanup(newFirstOrderId, order, "Token transfer failed");
                    } else {
                        feesToDistribute += order.orderCreationFee;
                        address maker = order.maker;
                        delete orders[newFirstOrderId];
                        emit OrderCleanedUp(newFirstOrderId, maker, block.timestamp);
                    }
                } else {
                    feesToDistribute += order.orderCreationFee;
                    address maker = order.maker;
                    delete orders[newFirstOrderId];
                    emit OrderCleanedUp(newFirstOrderId, maker, block.timestamp);
                }
                newFirstOrderId++;
            } else {
                break;
            }
        }

        if (newFirstOrderId > firstOrderId) {
            firstOrderId = newFirstOrderId;
        }

        if (feesToDistribute > 0 && feesToDistribute <= accumulatedFees) {
            accumulatedFees -= feesToDistribute;
            (bool success,) = msg.sender.call{value: feesToDistribute}("");
            require(success, "Fee transfer failed");
            emit CleanupFeesDistributed(msg.sender, feesToDistribute, block.timestamp);
        }
    }
    // Allow contract to receive native coin for creation fees
    receive() external payable {}

    function attemptTransfer(IERC20 token, address to, uint256 amount) external {
        require(msg.sender == address(this), "Only self");

        // Get balances before transfer
        uint256 fromBalance = token.balanceOf(address(this));
        uint256 toBalance = token.balanceOf(to);

        bool success;
        bytes memory returnData;

        try token.transfer(to, amount) returns (bool result) {
            success = result;
            returnData = abi.encode(result);
        } catch (bytes memory err) {
            success = false;
            returnData = err;
        }

        emit TokenTransferAttempt(
            0, // orderId
            success,
            returnData,
            fromBalance,
            toBalance,
            block.timestamp
        );
        require(success, "Token transfer failed");
    }
}
