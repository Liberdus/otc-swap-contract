const { expect } = require('chai')
const { ethers } = require('hardhat')
const { time } = require('@nomicfoundation/hardhat-toolbox/network-helpers')

describe('OTCSwap', function () {
  let otcSwap
  let tokenA
  let tokenB
  let owner
  let alice
  let bob
  let charlie

  const INITIAL_SUPPLY = ethers.parseEther('1000000')
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
  const ORDER_EXPIRY = 7 * 24 * 60 * 60 // 7 days in seconds
  const MAX_PAGE_SIZE = 100

  beforeEach(async function () {
    [owner, alice, bob, charlie] = await ethers.getSigners()

    const TestToken = await ethers.getContractFactory('TestToken')
    tokenA = await TestToken.deploy('Token A', 'TKA')
    await tokenA.waitForDeployment()
    tokenB = await TestToken.deploy('Token B', 'TKB')
    await tokenB.waitForDeployment()

    const OTCSwap = await ethers.getContractFactory('OTCSwap')
    otcSwap = await OTCSwap.deploy()
    await otcSwap.waitForDeployment()

    // Distribute tokens - now including Charlie
    await tokenA.transfer(alice.address, INITIAL_SUPPLY / BigInt(4))
    await tokenA.transfer(bob.address, INITIAL_SUPPLY / BigInt(4))
    await tokenA.transfer(charlie.address, INITIAL_SUPPLY / BigInt(4))
    await tokenB.transfer(alice.address, INITIAL_SUPPLY / BigInt(4))
    await tokenB.transfer(bob.address, INITIAL_SUPPLY / BigInt(4))
    await tokenB.transfer(charlie.address, INITIAL_SUPPLY / BigInt(4))
  });

  describe('Order Creation', function () {
    const sellAmount = ethers.parseEther('100')
    const buyAmount = ethers.parseEther('200')

    it('should create a public order and track it in active orders', async function () {
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)

      const tx = await otcSwap
        .connect(alice)
        .createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount
        )
      const receipt = await tx.wait()

      // Check OrderCreated event using event filters
      const orderCreatedFilter = otcSwap.filters.OrderCreated()
      const events = await otcSwap.queryFilter(
        orderCreatedFilter,
        receipt.blockNumber
      )
      expect(events.length).to.equal(1)
      expect(events[0].eventName).to.equal('OrderCreated')

      // Check active orders through getActiveOrders
      const [makers, , sellTokens, sellAmounts, , , , actives] =
        await otcSwap.getActiveOrders(0, 1)
      expect(makers[0]).to.equal(alice.address)
      expect(sellTokens[0]).to.equal(tokenA.target)
      expect(sellAmounts[0]).to.equal(sellAmount)
      expect(actives[0]).to.be.true
    });

    it('should emit OrderCreated event with correct timestamp', async function () {
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)

      const tx = await otcSwap
        .connect(alice)
        .createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount
        )
      const receipt = await tx.wait()

      const orderCreatedFilter = otcSwap.filters.OrderCreated()
      const events = await otcSwap.queryFilter(
        orderCreatedFilter,
        receipt.blockNumber
      )
      const currentTime = await time.latest()

      expect(events[0].args.createdAt).to.be.closeTo(
        BigInt(currentTime),
        BigInt(2)
      )
    });
  });

  describe('Order Filling', function () {
    const sellAmount = ethers.parseEther('100')
    const buyAmount = ethers.parseEther('200')
    let orderId

    beforeEach(async function () {
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)
      const tx = await otcSwap
        .connect(alice)
        .createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount
        )
      orderId = 0
    });

    it('should remove filled order from active orders', async function () {
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)
      await otcSwap.connect(bob).fillOrder(orderId)

      // Check that order is no longer in active orders
      const [makers, , , , , , , actives] = await otcSwap.getActiveOrders(0, 1)
      expect(makers.length).to.equal(0)
    });

    it('should fail when filling expired order', async function () {
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)

      // Fast forward time beyond expiry
      await time.increase(ORDER_EXPIRY + 1)

      await expect(otcSwap.connect(bob).fillOrder(orderId)).to.be.revertedWith(
        'Order expired'
      )
    });
  });
  describe('Active Orders Management', function () {
    const sellAmount = ethers.parseEther('100')
    const buyAmount = ethers.parseEther('200')

    beforeEach(async function () {
      // Create multiple orders with different makers
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount * BigInt(3))
      await tokenA.connect(bob).approve(otcSwap.target, sellAmount * BigInt(2))

      // Create orders alternating between alice and Òbob
      await otcSwap.connect(alice).createOrder(ZERO_ADDRESS, tokenA.target, sellAmount, tokenB.target, buyAmount)
      await otcSwap.connect(bob).createOrder(ZERO_ADDRESS, tokenA.target, sellAmount, tokenB.target, buyAmount)
      await otcSwap.connect(alice).createOrder(ZERO_ADDRESS, tokenA.target, sellAmount, tokenB.target, buyAmount)
      await otcSwap.connect(bob).createOrder(ZERO_ADDRESS, tokenA.target, sellAmount, tokenB.target, buyAmount)
      await otcSwap.connect(alice).createOrder(ZERO_ADDRESS, tokenA.target, sellAmount, tokenB.target, buyAmount)
    })

    it('should maintain active orders correctly after operations', async function () {
      // Fill an order
      await tokenB.connect(charlie).approve(otcSwap.target, buyAmount)
      await otcSwap.connect(charlie).fillOrder(2) // Fill order in middle

      // Verify order 2 is filled
      const orderAfterFill = await otcSwap.orders(2)
      expect(orderAfterFill.active).to.be.false

      // Cancel an order
      await otcSwap.connect(alice).cancelOrder(4) // Cancel last order

      // Get final state of active orders
      const [finalMakers, , , , , , , actives] = await otcSwap.getActiveOrders(
        0,
        5
      )

      // Verify the correct number of orders remain
      expect(finalMakers.length).to.equal(3) // Should have 3 active orders left

      // Verify all remaining orders are marked as active
      expect(actives.every((isActive) => isActive)).to.be.true

      // Verify order states individually
      for (let i = 0; i < 5; i++) {
        const order = await otcSwap.orders(i)
        if (i === 2 || i === 4) {
          // Orders 2 and 4 should be inactive
          expect(order.active).to.be.false
        }
      }

      // Check that the total number of active orders is correct
      const allOrders = await Promise.all(
        Array(5)
          .fill()
          .map((_, i) => otcSwap.orders(i))
      );
      const activeCount = allOrders.filter((order) => order.active).length
      expect(activeCount).to.equal(3)
    });

    it('should return correct order IDs with active orders', async function () {
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
      ] = await otcSwap.getActiveOrders(0, 5)

      expect(orderIds.length).to.equal(5)

      // Verify each order ID matches its corresponding order
      for (let i = 0; i < orderIds.length; i++) {
        const order = await otcSwap.orders(orderIds[i])
        expect(order.maker).to.equal(makers[i])
        expect(order.sellAmount).to.equal(sellAmounts[i])
        expect(order.active).to.be.true
      }

      // Verify order IDs are sequential
      for (let i = 0; i < orderIds.length; i++) {
        expect(orderIds[i]).to.equal(BigInt(i))
      }
    })

    it('should respect MAX_PAGE_SIZE limit', async function () {
      const [makers] = await otcSwap.getActiveOrders(0, MAX_PAGE_SIZE + 1)
      expect(makers.length).to.be.lte(MAX_PAGE_SIZE)
    })

    it('should handle pagination correctly', async function () {
      // Get first page
      const [makers1, , , , , , , , orderIds1, nextOffset1] =
        await otcSwap.getActiveOrders(0, 2)

      expect(makers1.length).to.equal(2)
      expect(orderIds1.length).to.equal(2)

      // Get second page using nextOffset
      const [makers2, , , , , , , , orderIds2, nextOffset2] =
        await otcSwap.getActiveOrders(nextOffset1, 2)

      expect(makers2.length).to.equal(2)
      expect(orderIds2.length).to.equal(2)

      // Verify the sequence of order IDs
      expect(orderIds1[0]).to.equal(BigInt(0))
      expect(orderIds1[1]).to.equal(BigInt(1))
      expect(orderIds2[0]).to.equal(BigInt(2))
      expect(orderIds2[1]).to.equal(BigInt(3))

      // Get last page
      const [makers3, , , , , , , , orderIds3, nextOffset3] =
        await otcSwap.getActiveOrders(nextOffset2, 2)

      expect(makers3.length).to.equal(1) // Last page should have 1 order
      expect(orderIds3.length).to.equal(1)
      expect(orderIds3[0]).to.equal(BigInt(4)) // Last order ID

      // Verify total number of orders retrieved equals expected total
      const totalOrders = makers1.length + makers2.length + makers3.length
      expect(totalOrders).to.equal(5)

      // Verify makers alternate between alice and bob
      expect(makers1[0].toLowerCase()).to.equal(alice.address.toLowerCase())
      expect(makers1[1].toLowerCase()).to.equal(bob.address.toLowerCase())
      expect(makers2[0].toLowerCase()).to.equal(alice.address.toLowerCase())
      expect(makers2[1].toLowerCase()).to.equal(bob.address.toLowerCase())
      expect(makers3[0].toLowerCase()).to.equal(alice.address.toLowerCase())
    });

    it('should handle empty pages correctly', async function () {
      const [makers, , , , , , , , orderIds, nextOffset] =
        await otcSwap.getActiveOrders(999, 2) // Use an offset beyond available orders

      expect(makers.length).to.equal(0)
      expect(orderIds.length).to.equal(0)
      expect(nextOffset).to.equal(0)
    })

    it('should maintain pagination order after operations', async function () {
      // Get first page
      const [, , , , , , , , orderIds1] = await otcSwap.getActiveOrders(0, 2)

      // Perform an operation (fill an order)
      await tokenB.connect(charlie).approve(otcSwap.target, buyAmount)
      await otcSwap.connect(charlie).fillOrder(1) // Fill the second order

      // Get first page again
      const [, , , , , , , , orderIds2] = await otcSwap.getActiveOrders(0, 2)

      // Verify the filled order is not in the results
      const secondPageIds = orderIds2.map((id) => id.toString())
      expect(secondPageIds).to.not.include('1')

      // Verify the number of orders decreased
      const [makers] = await otcSwap.getActiveOrders(0, 10)
      expect(makers.length).to.equal(4)
    });

    it('should handle order removal correctly', async function () {
      // Fill an order and verify active orders update
      await tokenB.connect(charlie).approve(otcSwap.target, buyAmount)
      await otcSwap.connect(charlie).fillOrder(2)

      // Get active orders after filling
      const [makersAfterFill] = await otcSwap.getActiveOrders(0, 5)
      expect(makersAfterFill.length).to.equal(4)

      // Cancel an order and verify active orders update again
      await otcSwap.connect(alice).cancelOrder(4)
      const [makersAfterCancel] = await otcSwap.getActiveOrders(0, 5)
      expect(makersAfterCancel.length).to.equal(3)
    });

    it('should not return expired orders', async function () {
      // Fast forward time beyond expiry
      await time.increase(ORDER_EXPIRY + 1)

      const [makers] = await otcSwap.getActiveOrders(0, 5)
      expect(makers.length).to.equal(0)
    });
  });

  describe('Order Expiry', function () {
    const sellAmount = ethers.parseEther('100')
    const buyAmount = ethers.parseEther('200')

    beforeEach(async function () {
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)
      await otcSwap
        .connect(alice)
        .createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount
        )
    });

    it('should allow filling just before expiry', async function () {
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)
      await time.increase(ORDER_EXPIRY - 60) // 1 minute before expiry
      await expect(otcSwap.connect(bob).fillOrder(0)).to.not.be.reverted
    })

    it('should handle orders near expiry boundary', async function () {
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)

      // Test exactly at expiry
      await time.increase(ORDER_EXPIRY)
      await expect(otcSwap.connect(bob).fillOrder(0)).to.be.revertedWith(
        'Order expired'
      )

      // Test one second after expiry
      await time.increase(1)
      await expect(otcSwap.connect(bob).fillOrder(0)).to.be.revertedWith(
        'Order expired'
      )
    });
  });

  describe('Gas Optimization Tests', function () {
    const sellAmount = ethers.parseEther('100')
    const buyAmount = ethers.parseEther('200')

    it('should show consistent gas costs for order lifecycle', async function () {
      // First approve tokens for multiple orders
      await tokenA
        .connect(alice)
        .approve(otcSwap.target, sellAmount * BigInt(3))

      // Create three orders and measure gas
      const gasCosts = []
      for (let i = 0; i < 3; i++) {
        const tx = await otcSwap
          .connect(alice)
          .createOrder(
            ZERO_ADDRESS,
            tokenA.target,
            sellAmount,
            tokenB.target,
            buyAmount
          )
        const receipt = await tx.wait()
        gasCosts.push({
          orderNum: i + 1,
          gasUsed: receipt.gasUsed
        });
      }

      // Log gas costs with better formatting
      console.log('\nGas costs for order creation:')
      gasCosts.forEach(({ orderNum, gasUsed }) => {
        console.log(`Order ${orderNum}: ${gasUsed.toString()} gas units`)
      });

      // Calculate percentage changes
      for (let i = 1; i < gasCosts.length; i++) {
        const percentChange = (
          (Number(gasCosts[i].gasUsed - gasCosts[i - 1].gasUsed) /
            Number(gasCosts[i - 1].gasUsed)) *
          100
        ).toFixed(2)
        console.log(`Change from order ${i} to ${i + 1}: ${percentChange}%`)
      }

      // Test order filling gas costs
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount * BigInt(3))

      const fillGasCosts = []
      for (let i = 0; i < 3; i++) {
        const tx = await otcSwap.connect(bob).fillOrder(i)
        const receipt = await tx.wait()
        fillGasCosts.push({
          orderNum: i + 1,
          gasUsed: receipt.gasUsed
        });
      }

      // Log fill gas costs
      console.log('\nGas costs for order filling:')
      fillGasCosts.forEach(({ orderNum, gasUsed }) => {
        console.log(`Fill ${orderNum}: ${gasUsed.toString()} gas units`)
      });

      // Calculate percentage changes for fills
      for (let i = 1; i < fillGasCosts.length; i++) {
        const percentChange = (
          (Number(fillGasCosts[i].gasUsed - fillGasCosts[i - 1].gasUsed) /
            Number(fillGasCosts[i - 1].gasUsed)) *
          100
        ).toFixed(2)
        console.log(`Change from fill ${i} to ${i + 1}: ${percentChange}%`)
      }

      // Verify gas costs are within expected ranges
      gasCosts.forEach(({ gasUsed }, index) => {
        if (index > 0) {
          // Convert BigInts to numbers for comparison
          const difference = Math.abs(Number(gasUsed - gasCosts[0].gasUsed))
          // Allow for some variation but not too much
          expect(difference).to.be.lessThan(
            50000,
            'Gas cost variation should not be too large between orders'
          )
        }
      });
    });

    it('should analyze gas costs for different operations', async function () {
      // Prepare tokens
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)

      // Measure gas for order creation
      const createTx = await otcSwap
        .connect(alice)
        .createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount
        )
      const createReceipt = await createTx.wait()
      const createGas = createReceipt.gasUsed

      // Measure gas for order filling
      const fillTx = await otcSwap.connect(bob).fillOrder(0)
      const fillReceipt = await fillTx.wait()
      const fillGas = fillReceipt.gasUsed

      // Create another order for cancellation
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)
      await otcSwap
        .connect(alice)
        .createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount
        )

      // Measure gas for order cancellation
      const cancelTx = await otcSwap.connect(alice).cancelOrder(1)
      const cancelReceipt = await cancelTx.wait()
      const cancelGas = cancelReceipt.gasUsed

      console.log('\nGas costs comparison:')
      console.log(`Order creation: ${createGas.toString()} gas units`)
      console.log(`Order filling: ${fillGas.toString()} gas units`)
      console.log(`Order cancellation: ${cancelGas.toString()} gas units`)

      // Break down the operations
      console.log('\nRelative gas costs:')
      console.log(
        `Fill is ${((Number(fillGas) / Number(createGas)) * 100).toFixed(
          1
        )}% of creation cost`
      )
      console.log(
        `Cancel is ${((Number(cancelGas) / Number(createGas)) * 100).toFixed(
          1
        )}% of creation cost`
      )
    });
  });
});
