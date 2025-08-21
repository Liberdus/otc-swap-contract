// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract OTCSwap is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant ORDER_EXPIRY = 1 minutes;
    uint256 public constant GRACE_PERIOD = 1 minutes;
    uint256 public constant MAX_RETRY_ATTEMPTS = 3;

    address public feeToken;
    uint256 public orderCreationFeeAmount;
    uint256 public accumulatedFees;
    uint256 public firstOrderId;
    uint256 public nextOrderId;
    bool public isDisabled;
    
    mapping(address => bool) public allowedTokens;
    address[] public allowedTokensList;

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
        address feeToken;
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
        address feeToken,
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
        address indexed feeToken,
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

    event FeeConfigUpdated(
        address indexed feeToken,
        uint256 feeAmount,
        uint256 timestamp
    );

    event AllowedTokensUpdated(
        address[] tokens,
        bool[] allowed,
        uint256 timestamp
    );

    modifier validOrder(uint256 orderId) {
        require(orders[orderId].maker != address(0), "Order does not exist");
        require(orders[orderId].status == OrderStatus.Active, "Order is not active");
        _;
    }

    constructor(address _feeToken, uint256 _feeAmount, address[] memory _allowedTokens) Ownable(msg.sender) {
        require(_feeToken != address(0), "Invalid fee token");
        require(_feeAmount > 0, "Invalid fee amount");
        require(_allowedTokens.length > 0, "Must specify allowed tokens");
        
        feeToken = _feeToken;
        orderCreationFeeAmount = _feeAmount;
        
        // Initialize allowed tokens
        for (uint256 i = 0; i < _allowedTokens.length; i++) {
            require(_allowedTokens[i] != address(0), "Invalid token address");
            allowedTokens[_allowedTokens[i]] = true;
            allowedTokensList.push(_allowedTokens[i]);
        }
        
        emit FeeConfigUpdated(_feeToken, _feeAmount, block.timestamp);
    }

    function updateFeeConfig(address _feeToken, uint256 _feeAmount) external onlyOwner {
        require(_feeToken != address(0), "Invalid fee token");
        require(_feeAmount > 0, "Invalid fee amount");
        feeToken = _feeToken;
        orderCreationFeeAmount = _feeAmount;
        emit FeeConfigUpdated(_feeToken, _feeAmount, block.timestamp);
    }

    function disableContract() external onlyOwner {
        require(!isDisabled, "Contract already disabled");
        isDisabled = true;
        emit ContractDisabled(msg.sender, block.timestamp);
    }

    function updateAllowedTokens(address[] memory tokens, bool[] memory allowed) external onlyOwner {
        require(tokens.length == allowed.length, "Arrays length mismatch");
        require(tokens.length > 0, "Empty arrays");
        
        for (uint256 i = 0; i < tokens.length; i++) {
            require(tokens[i] != address(0), "Invalid token address");
            
            if (allowed[i] && !allowedTokens[tokens[i]]) {
                // Adding new token
                allowedTokens[tokens[i]] = true;
                allowedTokensList.push(tokens[i]);
            } else if (!allowed[i] && allowedTokens[tokens[i]]) {
                // Removing existing token
                allowedTokens[tokens[i]] = false;
                _removeFromAllowedTokensList(tokens[i]);
            }
        }
        
        emit AllowedTokensUpdated(tokens, allowed, block.timestamp);
    }

    function _removeFromAllowedTokensList(address tokenToRemove) internal {
        for (uint256 i = 0; i < allowedTokensList.length; i++) {
            if (allowedTokensList[i] == tokenToRemove) {
                allowedTokensList[i] = allowedTokensList[allowedTokensList.length - 1];
                allowedTokensList.pop();
                break;
            }
        }
    }

    function getAllowedTokens() external view returns (address[] memory) {
        return allowedTokensList;
    }

    function getAllowedTokensCount() external view returns (uint256) {
        return allowedTokensList.length;
    }

    function createOrder(
        address taker,
        address sellToken,
        uint256 sellAmount,
        address buyToken,
        uint256 buyAmount
    ) external nonReentrant returns (uint256) {
        require(!isDisabled, "Contract is disabled");
        require(sellToken != address(0), "Invalid sell token");
        require(buyToken != address(0), "Invalid buy token");
        require(sellAmount > 0, "Invalid sell amount");
        require(buyAmount > 0, "Invalid buy amount");
        require(sellToken != buyToken, "Cannot swap same token");
        require(allowedTokens[sellToken], "Sell token not allowed");
        require(allowedTokens[buyToken], "Buy token not allowed");

        require(
            IERC20(sellToken).balanceOf(msg.sender) >= sellAmount,
            "Insufficient balance for sell token"
        );
        require(
            IERC20(sellToken).allowance(msg.sender, address(this)) >= sellAmount,
            "Insufficient allowance for sell token"
        );
        require(
            IERC20(feeToken).balanceOf(msg.sender) >= orderCreationFeeAmount,
            "Insufficient balance for fee"
        );
        require(
            IERC20(feeToken).allowance(msg.sender, address(this)) >= orderCreationFeeAmount,
            "Insufficient allowance for fee"
        );
        require(
            IERC20(sellToken).allowance(msg.sender, address(this)) >= sellAmount,
            "Insufficient allowance for sell token"
        );

        // Transfer fee token
        IERC20(feeToken).safeTransferFrom(msg.sender, address(this), orderCreationFeeAmount);
        accumulatedFees += orderCreationFeeAmount;

        // Transfer sell token
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
            feeToken: feeToken,
            orderCreationFee: orderCreationFeeAmount,
            tries: 0
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
            feeToken,
            orderCreationFeeAmount
        );

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
    ) internal returns (uint256, address) {
        emit CleanupError(orderId, reason, block.timestamp);

        // If max retries reached, delete order and distribute fee
        if (order.tries >= MAX_RETRY_ATTEMPTS) {
            emit CleanupError(orderId, "Max retries reached", block.timestamp);
            address feeTokenAddress = order.feeToken;
            uint256 feeAmount = order.orderCreationFee;
            delete orders[orderId];
            return (feeAmount, feeTokenAddress);
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
                feeToken: order.feeToken,
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

            delete orders[orderId];

            return (0, address(0));
        }
    }

    function cleanupExpiredOrders() external nonReentrant {
        require(firstOrderId < nextOrderId, "No orders to clean up");

        Order storage order = orders[firstOrderId];

        // Skip empty orders
        if (order.maker == address(0)) {
            firstOrderId++;
            return;
        }

        uint256 feesToDistribute = 0;
        address currentFeeToken;

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
                    emit CleanupError(firstOrderId, reason, block.timestamp);
                } catch (bytes memory) {
                    transferSuccess = false;
                    emit CleanupError(firstOrderId, "Unknown error", block.timestamp);
                }

                if (!transferSuccess) {
                    (uint256 fees, address feeTokenAddr) = _handleFailedCleanup(firstOrderId, order, "Token transfer failed");
                    if (fees > 0) {
                        feesToDistribute = fees;
                        currentFeeToken = feeTokenAddr;
                    }
                } else {
                    feesToDistribute = order.orderCreationFee;
                    currentFeeToken = order.feeToken;
                    address maker = order.maker;
                    delete orders[firstOrderId];
                    emit OrderCleanedUp(firstOrderId, maker, block.timestamp);
                }
            } else {
                feesToDistribute = order.orderCreationFee;
                currentFeeToken = order.feeToken;
                address maker = order.maker;
                delete orders[firstOrderId];
                emit OrderCleanedUp(firstOrderId, maker, block.timestamp);
            }
            firstOrderId++;
        }

        if (feesToDistribute > 0 && feesToDistribute <= accumulatedFees) {
            accumulatedFees -= feesToDistribute;
            IERC20(currentFeeToken).safeTransfer(msg.sender, feesToDistribute);
            emit CleanupFeesDistributed(msg.sender, currentFeeToken, feesToDistribute, block.timestamp);
        }
    }

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
            0,
            success,
            returnData,
            fromBalance,
            toBalance,
            block.timestamp
        );
        require(success, "Token transfer failed");
    }
}
