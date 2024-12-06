const { expect } = require('chai')
const { ethers } = require('hardhat')
const { time } = require('@nomicfoundation/hardhat-toolbox/network-helpers')

describe('OTCSwap', function () {
  let otcSwap
  let tokenA
  let tokenB
  let feeToken
  let owner
  let alice
  let bob
  let charlie

  const INITIAL_SUPPLY = ethers.parseEther('1000000')
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
  const ORDER_EXPIRY = 7 * 24 * 60 * 60 // 7 days in seconds
  const GRACE_PERIOD = 7 * 24 * 60 * 60 // 7 days in seconds

  // Fixed test values
  const sellAmount = ethers.parseEther('100')
  const buyAmount = ethers.parseEther('200')
  const ORDER_FEE = ethers.parseUnits('1', 6) // $1 in USDC (6 decimals)
  const generousFeeAllowance = ORDER_FEE * BigInt(1000)

  beforeEach(async function () {
    [owner, alice, bob, charlie] = await ethers.getSigners()

    // Deploy test tokens
    const TestToken = await ethers.getContractFactory('TestToken')
    tokenA = await TestToken.deploy('Token A', 'TKA')
    await tokenA.waitForDeployment()
    tokenB = await TestToken.deploy('Token B', 'TKB')
    await tokenB.waitForDeployment()

    // Deploy fee token (USDC mock with 6 decimals)
    const FeeToken = await ethers.getContractFactory('TestTokenDecimals')
    feeToken = await FeeToken.deploy('USD Coin', 'USDC', 6)
    await feeToken.waitForDeployment()

    // Deploy OTCSwap with fee token configuration
    const OTCSwap = await ethers.getContractFactory('OTCSwap')
    otcSwap = await OTCSwap.deploy(feeToken.target, ORDER_FEE)
    await otcSwap.waitForDeployment()

    // Distribute tokens
    await tokenA.transfer(alice.address, INITIAL_SUPPLY / BigInt(4))
    await tokenA.transfer(bob.address, INITIAL_SUPPLY / BigInt(4))
    await tokenA.transfer(charlie.address, INITIAL_SUPPLY / BigInt(4))
    await tokenB.transfer(alice.address, INITIAL_SUPPLY / BigInt(4))
    await tokenB.transfer(bob.address, INITIAL_SUPPLY / BigInt(4))
    await tokenB.transfer(charlie.address, INITIAL_SUPPLY / BigInt(4))

    // Distribute fee tokens
    await feeToken.mint(alice.address, ORDER_FEE * BigInt(1000))
    await feeToken.mint(bob.address, ORDER_FEE * BigInt(1000))
    await feeToken.mint(charlie.address, ORDER_FEE * BigInt(1000))
  })

  describe('Contract Administration', function () {
    it('should allow owner to update fee configuration', async function () {
      const newFeeAmount = ORDER_FEE * BigInt(2)
      const tx = await otcSwap.connect(owner).updateFeeConfig(feeToken.target, newFeeAmount)

      await expect(tx)
        .to.emit(otcSwap, 'FeeConfigUpdated')
        .withArgs(feeToken.target, newFeeAmount, await time.latest())

      expect(await otcSwap.feeToken()).to.equal(feeToken.target)
      expect(await otcSwap.orderCreationFeeAmount()).to.equal(newFeeAmount)
    })

    it('should prevent non-owner from updating fee configuration', async function () {
      await expect(otcSwap.connect(alice).updateFeeConfig(feeToken.target, ORDER_FEE))
        .to.be.revertedWithCustomError(otcSwap, 'OwnableUnauthorizedAccount')
        .withArgs(alice.address)
    })

    it('should prevent setting invalid fee configuration', async function () {
      await expect(otcSwap.connect(owner).updateFeeConfig(ZERO_ADDRESS, ORDER_FEE))
        .to.be.revertedWith('Invalid fee token')

      await expect(otcSwap.connect(owner).updateFeeConfig(feeToken.target, 0))
        .to.be.revertedWith('Invalid fee amount')
    })

    it('should allow owner to disable contract', async function () {
      const tx = await otcSwap.connect(owner).disableContract()

      await expect(tx)
        .to.emit(otcSwap, 'ContractDisabled')
        .withArgs(owner.address, await time.latest())

      expect(await otcSwap.isDisabled()).to.be.true
    })
  });

  describe('Order Creation with Fees', function () {
    beforeEach(async function () {
      // Approve tokens for order creation
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount * BigInt(5))
      await feeToken.connect(alice).approve(otcSwap.target, generousFeeAllowance)
    })

    it('should create order with valid fee token payment', async function () {
      const tx = await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount
      )

      await expect(tx)
        .to.emit(otcSwap, 'OrderCreated')
        .withArgs(
          0,
          alice.address,
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount,
          await time.latest(),
          feeToken.target,
          ORDER_FEE
        )

      // Verify fee token transfer
      expect(await feeToken.balanceOf(otcSwap.target)).to.equal(ORDER_FEE)
    })

    it('should fail if fee token allowance is insufficient', async function () {
      await feeToken.connect(alice).approve(otcSwap.target, 0)

      await expect(otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount
      )).to.be.revertedWith('Insufficient allowance for fee')
    })

    it('should fail if fee token balance is insufficient', async function () {
      // Transfer away all fee tokens
      const balance = await feeToken.balanceOf(alice.address)
      await feeToken.connect(alice).transfer(bob.address, balance)

      await expect(otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount
      )).to.be.revertedWith('Insufficient balance for fee')
    })
  });

  describe('Order Filling', function () {
    const sellAmount = ethers.parseEther('100')
    const buyAmount = ethers.parseEther('200')
    let orderId

    beforeEach(async function () {
      // Approve tokens for alice (maker)
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)
      // Approve fee token for alice
      await feeToken.connect(alice).approve(otcSwap.target, generousFeeAllowance)

      // Transfer and approve tokens for bob (taker)
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)

      // Create an order as alice
      await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS, // public order
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount
      )
      orderId = 0
    })

    it('should successfully fill a valid order', async function () {
      // Check initial balances
      const aliceInitialTokenB = await tokenB.balanceOf(alice.address)
      const bobInitialTokenA = await tokenA.balanceOf(bob.address)

      // Pre-approve tokens and transfer buyTokens from bob to contract
      // await tokenB.connect(bob).transfer(otcSwap.target, buyAmount)

      // approve tokens for bob
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)

      // log order amounts
      const order = await otcSwap.orders(orderId)

      // check balance of sell token in contract
      const balanceBefore = await tokenA.balanceOf(otcSwap.target)

      // check the balance of buy token in contract
      const balanceBeforeBuy = await tokenB.balanceOf(otcSwap.target)

      // check the balance of buy token in bob
      const balanceBeforeBob = await tokenB.balanceOf(bob.address)

      // check the allowance of buy token for the contract by bob
      const allowanceBefore = await tokenB.allowance(bob.address, otcSwap.target)

      // Fill order
      await otcSwap.connect(bob).fillOrder(orderId)

      // Check final balances
      expect(await tokenB.balanceOf(alice.address)).to.equal(aliceInitialTokenB + buyAmount)
      expect(await tokenA.balanceOf(bob.address)).to.equal(bobInitialTokenA + sellAmount)
    })

    it('should enforce taker restrictions', async function () {
      // Create order with specific taker
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount)
      await feeToken.connect(alice).approve(otcSwap.target, generousFeeAllowance)

      await otcSwap.connect(alice).createOrder(
        charlie.address, // specific taker
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount,
      )

      // Setup for bob's attempt
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)
      await tokenB.connect(bob).transfer(otcSwap.target, buyAmount)

      // Setup for charlie's attempt
      await tokenB.connect(charlie).approve(otcSwap.target, buyAmount)
      await tokenB.connect(charlie).transfer(otcSwap.target, buyAmount)

      // Bob should not be able to fill
      await expect(otcSwap.connect(bob).fillOrder(1))
        .to.be.revertedWith('Not authorized to fill this order')

      // Charlie should be able to fill
      await otcSwap.connect(charlie).fillOrder(1)
    })

    it('should handle insufficient balance issues', async function () {
      // Transfer all tokens away
      const balance = await tokenB.balanceOf(bob.address)
      await tokenB.connect(bob).transfer(charlie.address, balance)

      await expect(otcSwap.connect(bob).fillOrder(orderId))
        .to.be.revertedWith('Insufficient balance for buy token')
    })

    it('should emit correct events on fill', async function () {
      // Pre-transfer buyTokens
      await tokenB.connect(bob).transfer(otcSwap.target, buyAmount)

      const tx = await otcSwap.connect(bob).fillOrder(orderId)
      await expect(tx)
        .to.emit(otcSwap, 'OrderFilled')
        .withArgs(
          orderId,
          alice.address,
          bob.address,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount,
          await time.latest()
        )
    })

    it('should handle sequential fills correctly', async function () {
      // Create multiple orders
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount * BigInt(3))

      for (let i = 1; i < 3; i++) {
        await otcSwap.connect(alice).createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount,
        );
      }

      // Pre-transfer all buyTokens needed
      // await tokenB.connect(bob).transfer(otcSwap.target, buyAmount * BigInt(3))

      // approve all buyTokens needed
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount * BigInt(3))

      // Fill orders sequentially
      for (let i = 0; i < 3; i++) {
        await otcSwap.connect(bob).fillOrder(i)
        const order = await otcSwap.orders(i)
        expect(order.status).to.equal(1) // Filled status
      }
    });
  });

  describe('Order Cleanup', function () {
    beforeEach(async function () {
      // Approve tokens for order creation
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount * BigInt(5))
      await feeToken.connect(alice).approve(otcSwap.target, generousFeeAllowance)
    })

    it('should cleanup one expired order per call', async function () {
      // Create multiple orders
      for (let i = 0; i < 3; i++) {
        await otcSwap.connect(alice).createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount
        )
      }

      await time.increase(ORDER_EXPIRY + GRACE_PERIOD + 1)

      // First cleanup
      const charlieInitialBalance = await feeToken.balanceOf(charlie.address)
      await otcSwap.connect(charlie).cleanupExpiredOrders()

      // Verify only one order was cleaned
      expect(await feeToken.balanceOf(charlie.address)).to.equal(
        charlieInitialBalance + ORDER_FEE
      )

      const firstOrder = await otcSwap.orders(0)
      expect(firstOrder.maker).to.equal(ZERO_ADDRESS)

      // Second order should still exist
      const secondOrder = await otcSwap.orders(1)
      expect(secondOrder.maker).to.not.equal(ZERO_ADDRESS)
    })

    it('should distribute fees in correct token', async function () {
      // Create first order with old fee token
      await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount
      )

      // Create order with old fee token (this will be order ID 0)
      const oldFeeToken = feeToken

      // Deploy new fee token and update config
      const NewFeeToken = await ethers.getContractFactory('TestTokenDecimals')
      const newFeeToken = await NewFeeToken.deploy('New Fee Token', 'NFT', 6)
      await newFeeToken.waitForDeployment()

      const newFeeAmount = ORDER_FEE * BigInt(2)
      await otcSwap.connect(owner).updateFeeConfig(newFeeToken.target, newFeeAmount)

      // check if the fee token is updated
      expect(await otcSwap.feeToken()).to.equal(newFeeToken.target)
      expect(await otcSwap.orderCreationFeeAmount()).to.equal(newFeeAmount)

      // Mint and approve new fee token for alice to create second order
      await newFeeToken.mint(alice.address, generousFeeAllowance * BigInt(2))
      await newFeeToken.connect(alice).approve(otcSwap.target, generousFeeAllowance)
      const allowance = await newFeeToken.allowance(alice.address, otcSwap.target)

      // Create order with new fee token (this will be order ID 1)
      await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount
      )

      await time.increase(ORDER_EXPIRY + GRACE_PERIOD + 1)

      // Verify firstOrderId is 0 before cleanup starts
      expect(await otcSwap.firstOrderId()).to.equal(0)

      // Cleanup first order (old fee token)
      const initialOldBalance = await oldFeeToken.balanceOf(charlie.address)
      const tx1 = await otcSwap.connect(charlie).cleanupExpiredOrders()
      const receipt1 = await tx1.wait()

      // Verify order 0 was cleaned up through event
      const cleanupEvent1 = receipt1.logs.find(
        log => log.fragment?.name === 'OrderCleanedUp'
      )
      expect(cleanupEvent1.args.orderId).to.equal(0)

      // Verify firstOrderId moved to 1
      expect(await otcSwap.firstOrderId()).to.equal(1)

      // Cleanup second order (new fee token)
      const initialNewBalance = await newFeeToken.balanceOf(charlie.address)
      const tx2 = await otcSwap.connect(charlie).cleanupExpiredOrders()
      const receipt2 = await tx2.wait()

      // Verify order 1 was cleaned up through event
      const cleanupEvent2 = receipt2.logs.find(
        log => log.fragment?.name === 'OrderCleanedUp'
      )
      expect(cleanupEvent2.args.orderId).to.equal(1)

      // Verify firstOrderId moved to 2
      expect(await otcSwap.firstOrderId()).to.equal(2)

      // Verify fee distributions
      expect(await oldFeeToken.balanceOf(charlie.address)).to.equal(
        initialOldBalance + ORDER_FEE
      )
      expect(await newFeeToken.balanceOf(charlie.address)).to.equal(
        initialNewBalance + newFeeAmount
      )
    })
  });

  describe('Order Lifecycle', function () {
    let orderId

    beforeEach(async function () {
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount * BigInt(2))
      await feeToken.connect(alice).approve(otcSwap.target, generousFeeAllowance)

      await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        tokenA.target,
        sellAmount,
        tokenB.target,
        buyAmount,
      )
      orderId = 0
    });

    it('should track order status correctly through lifecycle', async function () {
      let order = await otcSwap.orders(orderId)
      expect(order.status).to.equal(0) // OrderStatus.Active

      // Setup for fill
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)
      await tokenB.connect(bob).transfer(otcSwap.target, buyAmount)

      await otcSwap.connect(bob).fillOrder(orderId)

      order = await otcSwap.orders(orderId)
      expect(order.status).to.equal(1) // OrderStatus.Filled
    })
  });

  describe('Order Cancellation - Edge Cases', function () {
    beforeEach(async function () {
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount * BigInt(5))
      await feeToken.connect(alice).approve(otcSwap.target, generousFeeAllowance)
      // Create multiple orders
      for (let i = 0; i < 3; i++) {
        await otcSwap.connect(alice).createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount,
        )
      }
    });

    it('should prevent cancellation after grace period', async function () {
      await time.increase(ORDER_EXPIRY + GRACE_PERIOD + 1)
      await expect(otcSwap.connect(alice).cancelOrder(0))
        .to.be.revertedWith('Grace period has expired')
    })

    it('should allow cancellation just before grace period ends', async function () {
      await time.increase(ORDER_EXPIRY + GRACE_PERIOD - 60) // 1 minute before expiry
      await expect(otcSwap.connect(alice).cancelOrder(0))
        .to.not.be.reverted
    })

    it('should prevent cancellation of filled orders', async function () {
      // Setup token approvals and transfers
      await tokenB.connect(bob).approve(otcSwap.target, buyAmount)
      await tokenB.connect(bob).transfer(otcSwap.target, buyAmount)

      // Fill the order
      await otcSwap.connect(bob).fillOrder(0)

      // Try to cancel filled order
      await expect(otcSwap.connect(alice).cancelOrder(0))
        .to.be.revertedWith('Order is not active')
    });

    it('should prevent cancellation by non-maker', async function () {
      await expect(otcSwap.connect(bob).cancelOrder(0))
        .to.be.revertedWith('Only maker can cancel order')
    })

    it('should handle cancellation of multiple orders in same block', async function () {
      for (let i = 0; i < 3; i++) {
        await otcSwap.connect(alice).cancelOrder(i)
        const order = await otcSwap.orders(i)
        expect(order.status).to.equal(2) // Canceled status
      }
    });
  });

  describe('Order Cleanup - Edge Cases', function () {
    let misbehavingToken

    it('should handle failed token transfers during cleanup', async function () {
      // Deploy pausable token
      const PausableToken = await ethers.getContractFactory('MisbehavingToken')
      const pausableToken = await PausableToken.deploy()

      // Give Alice some tokens
      await pausableToken.mint(alice.address, sellAmount)

      // Create order
      await pausableToken.connect(alice).approve(otcSwap.target, sellAmount)
      await feeToken.connect(alice).approve(otcSwap.target, generousFeeAllowance)

      const tx = await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        pausableToken.target,
        sellAmount,
        tokenB.target,
        buyAmount,
      )
      await tx.wait()

      // Verify initial state
      const orderId = 0
      const originalOrder = await otcSwap.orders(orderId)
      // Pause the token
      await pausableToken.pause()

      // Advance time
      await time.increase(ORDER_EXPIRY + GRACE_PERIOD + 1)

      // check the balance of buy token in contract before cleanup
      const balanceBefore = await pausableToken.balanceOf(otcSwap.target)

      // Try cleanup
      const cleanupTx = await otcSwap.connect(charlie).cleanupExpiredOrders()
      const receipt = await cleanupTx.wait()

      // Print all events
      for (const log of receipt.logs) {
        try {
          const parsedLog = otcSwap.interface.parseLog(log)
          if (parsedLog) {
            // console.log('OTCSwap Event:', parsedLog.name)
            // console.log('Args:', parsedLog.args)
          }
        } catch (e) {
          try {
            const parsedLog = pausableToken.interface.parseLog(log)
            if (parsedLog) {
              // console.log('PausableToken Event:', parsedLog.name)
              // console.log('Args:', parsedLog.args)
            }
          } catch (e2) {
            // Skip unparseable logs
          }
        }
      }

      // Check final states
      const orderAfterCleanup = await otcSwap.orders(orderId)
      const newOrderId = await otcSwap.nextOrderId() - 1n
      const retryOrder = await otcSwap.orders(newOrderId)

      // check the balance of buy token in contract after cleanup
      const balanceAfter = await pausableToken.balanceOf(otcSwap.target)

      // Final state verification
      expect(retryOrder.tries).to.equal(1n)
    });

    it('should handle MAX_RETRY_ATTEMPTS correctly', async function () {
      // Deploy contracts
      const [owner, alice, bob, charlie] = await ethers.getSigners()
      const OTCSwap = await ethers.getContractFactory('OTCSwap')
      const otcSwap = await OTCSwap.deploy(feeToken.target, ORDER_FEE)

      const PausableToken = await ethers.getContractFactory('MisbehavingToken')
      const misbehavingToken = await PausableToken.deploy()
      const TokenB = await ethers.getContractFactory('MisbehavingToken')
      const tokenB = await TokenB.deploy()

      // Setup amounts
      const sellAmount = ethers.parseEther('100')
      const buyAmount = ethers.parseEther('50')
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

      // Mint tokens to Alice
      await misbehavingToken.mint(alice.address, sellAmount)

      // Create order
      await misbehavingToken.connect(alice).approve(otcSwap.target, sellAmount)
      await feeToken.connect(alice).approve(otcSwap.target, generousFeeAllowance)
      await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        misbehavingToken.target,
        sellAmount,
        tokenB.target,
        buyAmount,
      )

      // Advance time and pause token
      await time.increase(ORDER_EXPIRY + GRACE_PERIOD + 1)
      await misbehavingToken.pause()

      const initialOrderId = await otcSwap.firstOrderId()

      // Perform cleanup MAX_RETRY_ATTEMPTS + 1 times
      for (let i = 0; i <= 10; i++) {
        await otcSwap.connect(charlie).cleanupExpiredOrders()
      }

      // The order should be deleted after max retries
      const order = await otcSwap.orders(initialOrderId)
      expect(order.maker).to.equal(ZERO_ADDRESS)
    });

    it('should maintain order status through failed cleanup attempts', async function () {
      // Deploy contracts
      const [owner, alice, bob, charlie] = await ethers.getSigners()
      const OTCSwap = await ethers.getContractFactory('OTCSwap')
      const otcSwap = await OTCSwap.deploy(feeToken.target, ORDER_FEE)

      const PausableToken = await ethers.getContractFactory('MisbehavingToken')
      const misbehavingToken = await PausableToken.deploy()
      const TokenB = await ethers.getContractFactory('MisbehavingToken')
      const tokenB = await TokenB.deploy()

      // Setup amounts
      const sellAmount = ethers.parseEther('100')
      const buyAmount = ethers.parseEther('50')
      const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

      // Mint tokens to Alice
      await misbehavingToken.mint(alice.address, sellAmount)

      // Create order
      await misbehavingToken.connect(alice).approve(otcSwap.target, sellAmount)
      await feeToken.connect(alice).approve(otcSwap.target, generousFeeAllowance)
      const orderId = await otcSwap.connect(alice).createOrder(
        ZERO_ADDRESS,
        misbehavingToken.target,
        sellAmount,
        tokenB.target,
        buyAmount,
      )

      // Advance time and pause token
      await time.increase(ORDER_EXPIRY + GRACE_PERIOD + 1)
      await misbehavingToken.pause()

      await otcSwap.connect(charlie).cleanupExpiredOrders()

      // Check that retry order maintains the same status
      const nextOrderId = await otcSwap.nextOrderId()
      const retryOrder = await otcSwap.orders(nextOrderId - BigInt(1))
      expect(retryOrder.status).to.equal(0) // Active
    });

    it('should not clean more than MAX_CLEANUP_BATCH orders per call', async function () {
// Create multiple orders (more than MAX_CLEANUP_BATCH which is 1)
      const numOrders = 3
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount * BigInt(numOrders))
      await feeToken.connect(alice).approve(otcSwap.target, generousFeeAllowance)

      // Create orders
      for (let i = 0; i < numOrders; i++) {
        await otcSwap.connect(alice).createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount,
        )
      }

      // Record initial state
      const initialFirstOrderId = await otcSwap.firstOrderId()
      const initialNextOrderId = await otcSwap.nextOrderId()

      // Helper function to count expired active orders
      const countExpiredOrders = async () => {
        let count = 0
        const currentTime = await time.latest()
        for (let i = initialFirstOrderId; i < initialNextOrderId; i++) {
          const order = await otcSwap.orders(i)
          if (order.maker !== ZERO_ADDRESS &&
            order.status == 0 && // Active status
            order.timestamp + BigInt(ORDER_EXPIRY + GRACE_PERIOD) < currentTime) {
            count++
          }
        }
        return count
      }

      // Advance time past expiry and grace period
      await time.increase(ORDER_EXPIRY + GRACE_PERIOD + 10)

      // Count initial expired orders
      const initialExpiredCount = await countExpiredOrders()
      expect(initialExpiredCount).to.equal(numOrders)

      // First cleanup
      console.log('\nFirst cleanup (order 0):')
      const tx1 = await otcSwap.connect(charlie).cleanupExpiredOrders()
      const receipt1 = await tx1.wait()
      console.log('Gas used:', receipt1.gasUsed.toString())

      // Verify exactly one order was cleaned
      const expiredCountAfterFirst = await countExpiredOrders()
      console.log('Expired orders after first cleanup:', expiredCountAfterFirst)
      expect(expiredCountAfterFirst).to.equal(initialExpiredCount - 1)

      // Second cleanup
      console.log('\nSecond cleanup (order 1):')
      const tx2 = await otcSwap.connect(charlie).cleanupExpiredOrders()
      const receipt2 = await tx2.wait()
      console.log('Gas used:', receipt2.gasUsed.toString())

      // Verify exactly one more order was cleaned
      const expiredCountAfterSecond = await countExpiredOrders()
      console.log('Expired orders after second cleanup:', expiredCountAfterSecond)
      expect(expiredCountAfterSecond).to.equal(initialExpiredCount - 2)

      // Third cleanup
      console.log('\nThird cleanup (order 2):')
      const tx3 = await otcSwap.connect(charlie).cleanupExpiredOrders()
      const receipt3 = await tx3.wait()
      console.log('Gas used:', receipt3.gasUsed.toString())

      // Verify all orders are now cleaned
      const finalExpiredCount = await countExpiredOrders()
      console.log('Expired orders after final cleanup:', finalExpiredCount)
      expect(finalExpiredCount).to.equal(0)

      // Additional verification that orders were cleaned in sequence
      for (let i = 0; i < numOrders; i++) {
        const order = await otcSwap.orders(initialFirstOrderId + BigInt(i))
        expect(order.maker).to.equal(ZERO_ADDRESS, `Order ${i} should be cleaned`)
      }
    })

    it('should compare cleanup costs vs earned rewards', async function () {
      // Create multiple orders
      const numOrders = 3
      await tokenA.connect(alice).approve(otcSwap.target, sellAmount * BigInt(numOrders))
      await feeToken.connect(alice).approve(otcSwap.target, generousFeeAllowance)

      // Create orders and track total fees paid
      let totalFeesPaid = BigInt(0)
      for (let i = 0; i < numOrders; i++) {
        totalFeesPaid += ORDER_FEE
        await otcSwap.connect(alice).createOrder(
          ZERO_ADDRESS,
          tokenA.target,
          sellAmount,
          tokenB.target,
          buyAmount
        )
      }

      console.log('\nTotal fees paid for orders:', ethers.formatUnits(totalFeesPaid, 6), 'USDC')

      // Advance time past expiry and grace period
      await time.increase(ORDER_EXPIRY + GRACE_PERIOD + 1)

      // Track charlie's balances
      const charlieInitialETH = await ethers.provider.getBalance(charlie.address)
      const charlieInitialFeeToken = await feeToken.balanceOf(charlie.address)

      // First cleanup
      console.log('\nFirst cleanup (order 0):')
      const tx1 = await otcSwap.connect(charlie).cleanupExpiredOrders()
      const receipt1 = await tx1.wait()
      const gasCost1 = receipt1.gasUsed * receipt1.gasPrice
      console.log('Gas used:', receipt1.gasUsed.toString())
      console.log('Gas cost:', ethers.formatEther(gasCost1), 'ETH')

      // Second cleanup
      console.log('\nSecond cleanup (order 1):')
      const tx2 = await otcSwap.connect(charlie).cleanupExpiredOrders()
      const receipt2 = await tx2.wait()
      const gasCost2 = receipt2.gasUsed * receipt2.gasPrice
      console.log('Gas used:', receipt2.gasUsed.toString())
      console.log('Gas cost:', ethers.formatEther(gasCost2), 'ETH')

      // Third cleanup
      console.log('\nThird cleanup (order 2):')
      const tx3 = await otcSwap.connect(charlie).cleanupExpiredOrders()
      const receipt3 = await tx3.wait()
      const gasCost3 = receipt3.gasUsed * receipt3.gasPrice
      console.log('Gas used:', receipt3.gasUsed.toString())
      console.log('Gas cost:', ethers.formatEther(gasCost3), 'ETH')

      const charlieEndFeeToken = await feeToken.balanceOf(charlie.address)
      const totalGasCost = gasCost1 + gasCost2 + gasCost3
      const totalFeeTokenReward = charlieEndFeeToken - charlieInitialFeeToken

      console.log('\nProfit/Loss Analysis:')
      console.log('Total gas cost:', ethers.formatEther(totalGasCost), 'ETH')
      console.log('Total fee token rewards:', ethers.formatUnits(totalFeeTokenReward, 6), 'USDC')

      // Note: In a real environment, you would need to consider:
      // 1. The ETH/USDC exchange rate to truly compare costs vs rewards
      // 2. Gas price variations
      // 3. Market conditions for token swaps
      console.log('\nNote: Actual profitability depends on:')
      console.log('- Current ETH/USDC exchange rate')
      console.log('- Gas prices')
      console.log('- Market conditions for token swaps')

      // Verify fees were distributed correctly
      expect(totalFeeTokenReward).to.equal(totalFeesPaid)

      // Additional checks
      console.log('\nFee Distribution Stats:')
      console.log('Total fees collected:', ethers.formatUnits(totalFeesPaid, 6), 'USDC')
      console.log('Total fees distributed:', ethers.formatUnits(totalFeeTokenReward, 6), 'USDC')
      console.log('Distribution rate:', (Number(totalFeeTokenReward) / Number(totalFeesPaid) * 100).toFixed(2), '%')
      console.log('Average gas per cleanup:', ethers.formatEther(totalGasCost / BigInt(numOrders)), 'ETH')
    })
  });
});
