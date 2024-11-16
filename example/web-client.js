import { ethers } from 'ethers';

class OTCClient {
  constructor(contractAddress, contractABI, provider) {
    this.provider = provider;
    this.contract = new ethers.Contract(contractAddress, contractABI, provider);
  }

  // Connect with signer
  connect(signer) {
    this.contract = this.contract.connect(signer);
  }

  // Create a new order
  async createOrder(params) {
    const {
      taker = ethers.ZeroAddress, // For public orders
      sellToken,
      sellAmount,
      buyToken,
      buyAmount
    } = params;

    try {
      // First approve the OTC contract to spend tokens
      const sellTokenContract = new ethers.Contract(
        sellToken,
        ['function approve(address spender, uint256 amount) public returns (bool)'],
        this.contract.signer
      );

      const approveTx = await sellTokenContract.approve(
        this.contract.target,
        sellAmount
      );
      await approveTx.wait();

      // Create the order
      const tx = await this.contract.createOrder(
        taker,
        sellToken,
        sellAmount,
        buyToken,
        buyAmount
      );
      const receipt = await tx.wait();

      // Find the OrderCreated event
      const event = receipt.logs.find(
        log => log.eventName === 'OrderCreated'
      );

      return {
        orderId: event.args.orderId,
        txHash: receipt.hash,
        maker: event.args.maker,
        creation: {
          timestamp: Number(event.args.createdAt),
          blockNumber: receipt.blockNumber
        }
      };
    } catch (error) {
      throw new Error(`Failed to create order: ${error.message}`);
    }
  }

  // Fill an existing order
  async fillOrder(params) {
    const { orderId, buyToken, buyAmount } = params;

    try {
      // First approve the spending of buy tokens
      const buyTokenContract = new ethers.Contract(
        buyToken,
        ['function approve(address spender, uint256 amount) public returns (bool)'],
        this.contract.signer
      );

      const approveTx = await buyTokenContract.approve(
        this.contract.target,
        buyAmount
      );
      await approveTx.wait();

      // Fill the order
      const tx = await this.contract.fillOrder(orderId);
      const receipt = await tx.wait();

      // Find the OrderFilled event
      const event = receipt.logs.find(
        log => log.eventName === 'OrderFilled'
      );

      return {
        orderId,
        txHash: receipt.hash,
        taker: event.args.taker,
        fill: {
          timestamp: Number(event.args.filledAt),
          blockNumber: receipt.blockNumber
        }
      };
    } catch (error) {
      throw new Error(`Failed to fill order: ${error.message}`);
    }
  }

  // Cancel an order
  async cancelOrder(orderId) {
    try {
      const tx = await this.contract.cancelOrder(orderId);
      const receipt = await tx.wait();

      // Find the OrderCancelled event
      const event = receipt.logs.find(
        log => log.eventName === 'OrderCancelled'
      );

      return {
        orderId,
        txHash: receipt.hash,
        cancellation: {
          timestamp: Number(event.args.cancelledAt),
          blockNumber: receipt.blockNumber
        }
      };
    } catch (error) {
      throw new Error(`Failed to cancel order: ${error.message}`);
    }
  }

  // Fetch active orders with pagination
  async getActiveOrders(params = {}) {
    const {
      offset = 0,
      limit = 10,
      // Optional filters for client-side filtering
      makerAddress = null,
      sellToken = null,
      buyToken = null
    } = params;

    try {
      const [
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
      ] = await this.contract.getActiveOrders(offset, limit);

      // Transform the raw data into a more usable format
      const orders = orderIds.map((id, index) => ({
        orderId: Number(id),
        maker: makers[index],
        taker: takers[index],
        sell: {
          token: sellTokens[index],
          amount: sellAmounts[index]
        },
        buy: {
          token: buyTokens[index],
          amount: buyAmounts[index]
        },
        createdAt: Number(createdAts[index]),
        isActive: actives[index]
      }));

      // Apply client-side filters if provided
      let filteredOrders = orders;
      if (makerAddress) {
        filteredOrders = filteredOrders.filter(
          order => order.maker.toLowerCase() === makerAddress.toLowerCase()
        );
      }
      if (sellToken) {
        filteredOrders = filteredOrders.filter(
          order => order.sell.token.toLowerCase() === sellToken.toLowerCase()
        );
      }
      if (buyToken) {
        filteredOrders = filteredOrders.filter(
          order => order.buy.token.toLowerCase() === buyToken.toLowerCase()
        );
      }

      return {
        orders: filteredOrders,
        pagination: {
          hasMore: nextOffset > 0,
          nextOffset: Number(nextOffset)
        }
      };
    } catch (error) {
      throw new Error(`Failed to fetch active orders: ${error.message}`);
    }
  }

  // Helper function to fetch token details
  async getTokenDetails(tokenAddress) {
    const tokenContract = new ethers.Contract(
      tokenAddress,
      [
        'function name() view returns (string)',
        'function symbol() view returns (string)',
        'function decimals() view returns (uint8)',
        'function balanceOf(address) view returns (uint256)'
      ],
      this.provider
    );

    const [name, symbol, decimals, balance] = await Promise.all([
      tokenContract.name(),
      tokenContract.symbol(),
      tokenContract.decimals(),
      tokenContract.balanceOf(this.contract.signer.address)
    ]);

    return { name, symbol, decimals, balance };
  }
}

// Example usage:
async function example() {
  // Initialize provider and signer
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  // Initialize client
  const client = new OTCClient(
    'CONTRACT_ADDRESS',
    CONTRACT_ABI,
    provider
  );
  client.connect(signer);

  // Create an order
  const order = await client.createOrder({
    sellToken: '0x...', // Token address
    sellAmount: ethers.parseEther('100'),
    buyToken: '0x...', // Token address
    buyAmount: ethers.parseEther('200')
  });

  // Fetch active orders with pagination
  const { orders, pagination } = await client.getActiveOrders({
    limit: 10,
    sellToken: '0x...' // Optional filter
  });

  // Fill an order
  if (orders.length > 0) {
    await client.fillOrder({
      orderId: orders[0].orderId,
      buyToken: orders[0].buy.token,
      buyAmount: orders[0].buy.amount
    });
  }
}
