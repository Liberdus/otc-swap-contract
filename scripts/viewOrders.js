const { ethers } = require('ethers');

// OTCSwap contract ABI (only what we need for querying)
const OTC_SWAP_ABI = [
  // Events
  'event OrderCreated(uint256 indexed orderId, address indexed maker, address indexed taker, address sellToken, uint256 sellAmount, address buyToken, uint256 buyAmount, uint256 timestamp, uint256 orderCreationFee)',
  // Functions
  'function orders(uint256) view returns (address maker, address taker, address sellToken, uint256 sellAmount, address buyToken, uint256 buyAmount, uint256 timestamp, uint8 status, uint256 orderCreationFee, uint256 tries)',
  'function nextOrderId() view returns (uint256)',
  'function firstOrderId() view returns (uint256)',
  // Constants
  'function GRACE_PERIOD() view returns (uint256)',
  'function ORDER_EXPIRY() view returns (uint256)'
];

async function queryActiveOrders() {
  // Connect to Amoy Polygon testnet
  const provider = new ethers.JsonRpcProvider('https://rpc-amoy.polygon.technology');

  // OTCSwap contract address on Amoy testnet (replace with actual address)
  const OTC_SWAP_ADDRESS = '0x3085Cd92888e9D49879947cBc3aBD5d11f842271';

  // Create contract instance
  const otcSwap = new ethers.Contract(OTC_SWAP_ADDRESS, OTC_SWAP_ABI, provider);

  try {
    // Get order ID range
    const firstOrderId = await otcSwap.firstOrderId();
    const nextOrderId = await otcSwap.nextOrderId();

    console.log(`Querying orders from ${firstOrderId} to ${nextOrderId - 1n}`);

    // Array to store active orders
    const activeOrders = [];

    const grace = await otcSwap.GRACE_PERIOD();

    console.log(`Grace period: ${grace} seconds`, grace);

    // Query all orders
    for (let i = firstOrderId; i < nextOrderId; i++) {
      const order = await otcSwap.orders(i);

      console.log('order', order, `is expired: `, order.status)

      // Check if order is active (status 0)
      if (order.status === 0 && order.maker !== ethers.ZeroAddress) {
        activeOrders.push({
          orderId: i,
          maker: order.maker,
          taker: order.taker,
          sellToken: order.sellToken,
          sellAmount: order.sellAmount,
          buyToken: order.buyToken,
          buyAmount: order.buyAmount,
          timestamp: order.timestamp,
          tries: order.tries
        });
      }
    }

    // Print results
    console.log('\nActive Orders:');
    console.log('=============');

    for (const order of activeOrders) {
      console.log(`\nOrder ID: ${order.orderId}`);
      console.log(`Maker: ${order.maker}`);
      console.log(`Taker: ${order.taker === ethers.ZeroAddress ? 'Any' : order.taker}`);
      console.log(`Sell Token: ${order.sellToken}`);
      console.log(`Sell Amount: ${ethers.formatEther(order.sellAmount)} tokens`);
      console.log(`Buy Token: ${order.buyToken}`);
      console.log(`Buy Amount: ${ethers.formatEther(order.buyAmount)} tokens`);
      console.log(`Created: ${new Date(Number(order.timestamp) * 1000).toLocaleString()}`);
      console.log(`Retry Attempts: ${order.tries}`);
    }

    console.log(`\nTotal Active Orders: ${activeOrders.length}`);

  } catch (error) {
    console.error('Error querying orders:', error);
  }
}

// Run the query
queryActiveOrders().catch(console.error);
