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

    // Distribute tokens
    await tokenA.transfer(alice.address, INITIAL_SUPPLY / BigInt(4))
    await tokenA.transfer(bob.address, INITIAL_SUPPLY / BigInt(4))
    await tokenB.transfer(alice.address, INITIAL_SUPPLY / BigInt(4))
    await tokenB.transfer(bob.address, INITIAL_SUPPLY / BigInt(4))
  })

  describe('Order Creation', function () {
    const sellAmount = ethers.parseEther('100')
    const buyAmount = ethers.parseEther('200')

    it('should create a public order successfully', async function () {
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)

      const tx = await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount
      )
      const receipt = await tx.wait()

      const orderCreatedFilter = otcSwap.filters.OrderCreated()
      const events = await otcSwap.queryFilter(orderCreatedFilter, receipt.blockNumber)
      expect(events.length).to.equal(1)

      const orderCreatedEvent = events[0]
      expect(orderCreatedEvent.args.orderId).to.equal(0)
      expect(orderCreatedEvent.args.maker).to.equal(alice.address)

      const order = await otcSwap.getOrder(0)
      expect(order.maker).to.equal(alice.address)
      expect(order.active).to.be.true

      // Verify tokens were transferred to contract
      expect(await tokenA.balanceOf(otcSwap.target)).to.equal(sellAmount)
    })

    it('should create a private order successfully', async function () {
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)

      const tx = await otcSwap.connect(alice).createOrder(
        bob.address,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount
      )
      const receipt = await tx.wait()

      // Get the event
      const orderCreatedFilter = otcSwap.filters.OrderCreated()
      const events = await otcSwap.queryFilter(orderCreatedFilter, receipt.blockNumber)
      expect(events.length).to.equal(1)

      const event = events[0]

      // Check all arguments except timestamp
      expect(event.args.orderId).to.equal(0)
      expect(event.args.maker).to.equal(alice.address)
      expect(event.args.partner).to.equal(bob.address)
      expect(event.args.sellToken).to.equal(tokenA.target)
      expect(event.args.sellAmount).to.equal(sellAmount)
      expect(event.args.buyToken).to.equal(tokenB.target)
      expect(event.args.buyAmount).to.equal(buyAmount)

      // For timestamp, just verify it's a recent timestamp (within last 5 seconds)
      const currentTime = await time.latest()
      expect(Number(event.args.createdAt)).to.be.closeTo(currentTime, 5)

      // Verify order details
      const order = await otcSwap.getOrder(0)
      expect(order.maker).to.equal(alice.address)
      expect(order.partner).to.equal(bob.address)
      expect(order.active).to.be.true
    })

    // Alternative approach with matching event but ignoring timestamp
    it('should create a private order and emit correct event', async function () {
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)

      const tx = await otcSwap.connect(alice).createOrder(
        bob.address,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount
      )

      const receipt = await tx.wait()
      const event = receipt.logs[0]

      // Get timestamp from the actual event
      const eventTimestamp = (await otcSwap.queryFilter(otcSwap.filters.OrderCreated(), receipt.blockNumber))[0].args.createdAt

      await expect(tx)
        .to.emit(otcSwap, 'OrderCreated')
        .withArgs(
          0,                // orderId
          alice.address,    // maker
          bob.address,      // partner
          tokenA.target,    // sellToken
          sellAmount,       // sellAmount
          tokenB.target,    // buyToken
          buyAmount,        // buyAmount
          eventTimestamp    // createdAt - use actual timestamp
        )
    })
    it('should fail when creating order with invalid tokens', async function () {
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)

      await expect(
        otcSwap.connect(alice).createOrder(
          ZERO_ADDRESS,
          ZERO_ADDRESS,
          sellAmount,
          tokenB.target,
          buyAmount
        )
      ).to.be.revertedWith('Invalid sell token')

      await expect(
        otcSwap.connect(alice).createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          ZERO_ADDRESS,
          buyAmount
        )
      ).to.be.revertedWith('Invalid buy token')
    })

    it('should fail when creating order with same tokens', async function () {
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)

      await expect(
        otcSwap.connect(alice).createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenA.target,
          buyAmount
        )
      ).to.be.revertedWith('Same tokens')
    })

    it('should fail when creating order with zero amounts', async function () {
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)

      await expect(
        otcSwap.connect(alice).createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          0,
          tokenB.target,
          buyAmount
        )
      ).to.be.revertedWith('Invalid sell amount')

      await expect(
        otcSwap.connect(alice).createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenB.target,
          0
        )
      ).to.be.revertedWith('Invalid buy amount')
    })

    it('should fail when creating order without sufficient approval', async function () {
      await expect(
        otcSwap.connect(alice).createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount
        )
      ).to.be.reverted
    })
  })

  describe('Order Filling', function () {
    const sellAmount = ethers.parseEther('100')
    const buyAmount = ethers.parseEther('200')
    let orderId

    beforeEach(async function () {
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)
      const tx = await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount
      )
      const receipt = await tx.wait()
      orderId = 0
    })

    it('should fill public order successfully', async function () {
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)

      const bobInitialBalanceA = await tokenA.balanceOf(bob.address)
      const aliceInitialBalanceB = await tokenB.balanceOf(alice.address)

      await expect(otcSwap.connect(bob).fillOrder(orderId))
        .to.emit(otcSwap, 'OrderFilled')
        .withArgs(
          orderId,
          bob.address,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount
        )

      // Verify token transfers
      expect(await tokenA.balanceOf(bob.address)).to.equal(bobInitialBalanceA + sellAmount)
      expect(await tokenB.balanceOf(alice.address)).to.equal(aliceInitialBalanceB + buyAmount)
      expect(await tokenA.balanceOf(otcSwap.target)).to.equal(0)
    })

    it('should fail when filling inactive order', async function () {
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)
      await otcSwap.connect(alice).cancelOrder(orderId)

      await expect(
        otcSwap.connect(bob).fillOrder(orderId)
      ).to.be.revertedWith('Order not active')
    })

    it('should fail when filling order without sufficient approval', async function () {
      await expect(
        otcSwap.connect(bob).fillOrder(orderId)
      ).to.be.reverted
    })
  })

  describe('Private Orders', function () {
    const sellAmount = ethers.parseEther('100')
    const buyAmount = ethers.parseEther('200')
    let orderId

    beforeEach(async function () {
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)
      const tx = await otcSwap.connect(alice).createOrder(
        bob.address,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount
      )
      const receipt = await tx.wait()
      orderId = 0
    })

    it('should allow specified partner to fill order', async function () {
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)
      await expect(otcSwap.connect(bob).fillOrder(orderId)).to.not.be.reverted
    })

    it('should prevent non-partner from filling order', async function () {
      await tokenB.connect(charlie).approve(otcSwap.target, buyAmount)
      await expect(
        otcSwap.connect(charlie).fillOrder(orderId)
      ).to.be.revertedWith('Not authorized partner')
    })
  })

  describe('Order Cancellation', function () {
    const sellAmount = ethers.parseEther('100')
    const buyAmount = ethers.parseEther('200')
    let orderId

    beforeEach(async function () {
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)
      const tx = await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount
      )
      const receipt = await tx.wait()
      orderId = 0
    })

    it('should allow maker to cancel order', async function () {
      const initialBalance = await tokenA.balanceOf(alice.address)

      await expect(otcSwap.connect(alice).cancelOrder(orderId))
        .to.emit(otcSwap, 'OrderCancelled')
        .withArgs(orderId, alice.address)

      // Verify tokens returned
      expect(await tokenA.balanceOf(alice.address)).to.equal(initialBalance + sellAmount)
      expect(await tokenA.balanceOf(otcSwap.target)).to.equal(0)

      // Verify order marked inactive
      const order = await otcSwap.getOrder(orderId)
      expect(order.active).to.be.false
    })

    it('should prevent non-maker from cancelling order', async function () {
      await expect(
        otcSwap.connect(bob).cancelOrder(orderId)
      ).to.be.revertedWith('Not order maker')
    })

    it('should prevent cancelling inactive order', async function () {
      await otcSwap.connect(alice).cancelOrder(orderId)

      await expect(
        otcSwap.connect(alice).cancelOrder(orderId)
      ).to.be.revertedWith('Order not active')
    })
  })

  describe('Order Querying', function () {
    const sellAmount = ethers.parseEther('100')
    const buyAmount = ethers.parseEther('200')

    beforeEach(async function () {
      // Create multiple orders
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount * BigInt(3))

      for (let i = 0; i < 3; i++) {
        await otcSwap.connect(alice).createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount
        )
      }
    })

    it('should return correct order count', async function () {
      expect(await otcSwap.getOrderCount()).to.equal(3)
    })

    it('should return correct order details', async function () {
      const order = await otcSwap.getOrder(1)
      expect(order.maker).to.equal(alice.address)
      expect(order.sellToken).to.equal(tokenA.target)
      expect(order.sellAmount).to.equal(sellAmount)
      expect(order.buyToken).to.equal(tokenB.target)
      expect(order.buyAmount).to.equal(buyAmount)
      expect(order.active).to.be.true
    })

    it('should return correct batch of orders', async function () {
      const [
        makers,
        partners,
        sellTokens,
        sellAmounts,
        buyTokens,
        buyAmounts,
        createdAts,
        actives
      ] = await otcSwap.getOrders(1, 2)

      expect(makers.length).to.equal(2)
      expect(makers[0]).to.equal(alice.address)
      expect(sellTokens[0]).to.equal(tokenA.target)
      expect(sellAmounts[0]).to.equal(sellAmount)
      expect(actives[0]).to.be.true
    })

    it('should handle out of range queries gracefully', async function () {
      // Test offset beyond order count
      const [makers1] = await otcSwap.getOrders(5, 10)
      expect(makers1.length).to.equal(0)

      // Test offset at order count
      const [makers2] = await otcSwap.getOrders(3, 10)
      expect(makers2.length).to.equal(0)

      // Test limit greater than remaining orders
      const [makers3] = await otcSwap.getOrders(1, 10)
      expect(makers3.length).to.equal(2) // Should return remaining 2 orders

      // Test zero limit
      const [makers4] = await otcSwap.getOrders(0, 0)
      expect(makers4.length).to.equal(0)
    })

    it('should handle partial result sets correctly', async function () {
      // Get last two orders
      const [makers] = await otcSwap.getOrders(1, 2)
      expect(makers.length).to.equal(2)

      // Get last order
      const [makers2] = await otcSwap.getOrders(2, 1)
      expect(makers2.length).to.equal(1)
    })
  })

  describe('Edge Cases and Security', function () {
    const sellAmount = ethers.parseEther('100')
    const buyAmount = ethers.parseEther('200')

    it('should handle very large numbers correctly', async function () {
      // Use a portion of initial supply to ensure we have enough tokens
      const largeSellAmount = INITIAL_SUPPLY / BigInt(2) // Half of initial supply
      const largeBuyAmount = INITIAL_SUPPLY / BigInt(2)

      // Transfer large amount to Alice
      await tokenA.connect(owner).transfer(alice.address, largeSellAmount)
      await tokenA.connect(alice).approve(otcSwap.target, largeSellAmount)

      // Verify Alice's balance before creating order
      const aliceBalance = await tokenA.balanceOf(alice.address)
      expect(aliceBalance).to.be.gte(largeSellAmount)

      // Create order with large amounts
      const tx = await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        largeSellAmount,
        tokenB.target,
        largeBuyAmount
      )
      const receipt = await tx.wait()

      // Verify order was created successfully
      const orderId = 0
      const order = await otcSwap.getOrder(orderId)
      expect(order.sellAmount).to.equal(largeSellAmount)
      expect(order.buyAmount).to.equal(largeBuyAmount)
      expect(order.active).to.be.true

      // Verify contract balance
      const contractBalance = await tokenA.balanceOf(otcSwap.target)
      expect(contractBalance).to.equal(largeSellAmount)
    })

    it('should handle concurrent operations correctly', async function () {
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)

      const createTx = await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount
      )
      await createTx.wait()

      // Try to fill and cancel concurrently
      const fillPromise = otcSwap.connect(bob).fillOrder(0)
      const cancelPromise = otcSwap.connect(alice).cancelOrder(0)

      // One of these should succeed and one should fail
      await expect(Promise.all([fillPromise, cancelPromise])).to.be.rejected
    })

    it('should handle minimum amounts correctly', async function () {
      const minAmount = BigInt(1) // Minimum possible amount

      await tokenA.connect(alice).approve(otcSwap.target, minAmount)

      // Create order with minimum amounts
      await expect(otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        minAmount,
        tokenB.target,
        minAmount
      )).to.not.be.reverted
    })

    it('should handle multiple orders with different amounts', async function () {
      const amounts = [
        ethers.parseEther('1'),     // Small amount
        ethers.parseEther('1000'),  // Medium amount
        INITIAL_SUPPLY / BigInt(10) // Large amount (10% of supply)
      ]

      // Approve all amounts
      const totalAmount = amounts.reduce((a, b) => a + b, BigInt(0))
      await tokenA.connect(alice).approve(otcSwap.target, totalAmount)

      // Create orders with different amounts
      for (const amount of amounts) {
        await expect(otcSwap.connect(alice).createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          amount,
          tokenB.target,
          amount
        )).to.not.be.reverted
      }

      // Verify all orders were created correctly
      for (let i = 0; i < amounts.length; i++) {
        const order = await otcSwap.getOrder(i)
        expect(order.sellAmount).to.equal(amounts[i])
        expect(order.active).to.be.true
      }
    })
  })

  describe('Malicious Token Security Tests', function () {
    let maliciousToken
    const sellAmount = ethers.parseEther('100')
    const buyAmount = ethers.parseEther('200')

    beforeEach(async function () {
      // Deploy malicious token
      const MaliciousToken = await ethers.getContractFactory('MaliciousToken')
      maliciousToken = await MaliciousToken.deploy()
      await maliciousToken.waitForDeployment()

      // Set up attack parameters
      await maliciousToken.setAttackParams(otcSwap.target, 0) // Initially no attack

      // Mint tokens to Alice
      await maliciousToken.mint(alice.address, ethers.parseEther('1000'))
    })

    it('should prevent reentrancy attack during order creation', async function () {
      // Set attack mode for order creation
      await maliciousToken.setAttackParams(otcSwap.target, 1)

      // Approve tokens
      await maliciousToken.connect(alice).approve(otcSwap.target, sellAmount)

      // Attempt to create order with malicious token
      await expect(
        otcSwap.connect(alice).createOrder(
          ZERO_ADDRESS,
          maliciousToken.target,
          sellAmount,
          tokenB.target,
          buyAmount
        )
      ).to.be.reverted
    })

    it('should prevent reentrancy attack during order filling', async function () {
      // First create a legitimate order
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)
      await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        maliciousToken.target,
        buyAmount
      )

      // Set attack mode for order filling
      await maliciousToken.setAttackParams(otcSwap.target, 2)
      await maliciousToken.connect(bob).approve(otcSwap.target, buyAmount)

      // Attempt to fill order with malicious token
      await expect(
        otcSwap.connect(bob).fillOrder(0)
      ).to.be.reverted
    })

    it('should prevent reentrancy attack during order cancellation', async function () {
      // Create order with malicious token
      await maliciousToken.connect(alice).approve(otcSwap.target, sellAmount)
      await maliciousToken.setAttackParams(otcSwap.target, 0) // Temporarily disable attack

      await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        maliciousToken.target,
        sellAmount,
        tokenB.target,
        buyAmount
      )

      // Enable attack for cancellation
      await maliciousToken.setAttackParams(otcSwap.target, 3)

      // Attempt to cancel order
      await expect(
        otcSwap.connect(alice).cancelOrder(0)
      ).to.be.reverted
    })

    it('should prevent multiple reentrancy vectors in single transaction', async function () {
      // Create order with malicious token
      await maliciousToken.connect(alice).approve(otcSwap.target, sellAmount)
      await maliciousToken.setAttackParams(otcSwap.target, 0)

      const createTx = await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        maliciousToken.target,
        sellAmount,
        tokenB.target,
        buyAmount
      )
      await createTx.wait()

      // Try different attack modes
      for (let mode = 1; mode <= 3; mode++) {
        await maliciousToken.setAttackParams(otcSwap.target, mode)
        await expect(
          otcSwap.connect(alice).cancelOrder(0)
        ).to.be.reverted
      }
    })
  })
})
