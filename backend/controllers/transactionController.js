// ============================================================
//  controllers/transactionController.js — Escrow Deals
// ============================================================

const { Op } = require("sequelize");
const { User, Transaction, Dispute, Rating } = require("../models");

/**
 * Creates or records an off-chain transaction entry.
 * Called after the frontend submits an on-chain escrow transaction via MetaMask.
 * POST /api/transactions
 */
const createTransaction = async (req, res, next) => {
  try {
    const {
      buyer_wallet,
      seller_wallet,
      description,
      amount,
      currency = "ETH",
      on_chain_tx_id,
      status = "Created",
    } = req.body;

    // Use authenticated wallet or supplied buyer_wallet
    const buyerAddress = (req.user?.wallet_address || buyer_wallet || "").toLowerCase();
    const sellerAddress = (seller_wallet || "").toLowerCase();

    if (!buyerAddress) {
      return res.status(400).json({
        success: false,
        message: "buyer_wallet is required or user must be authenticated.",
      });
    }

    if (buyerAddress === sellerAddress) {
      return res.status(400).json({
        success: false,
        message: "Buyer and seller cannot be the same wallet address.",
      });
    }

    // Ensure buyer & seller user profiles exist in DB
    await User.findOrCreate({
      where: { wallet_address: buyerAddress },
      defaults: { wallet_address: buyerAddress },
    });
    await User.findOrCreate({
      where: { wallet_address: sellerAddress },
      defaults: { wallet_address: sellerAddress },
    });

    // If on_chain_tx_id is provided, check if event listener already inserted a record
    if (on_chain_tx_id) {
      const existing = await Transaction.findOne({
        where: { on_chain_tx_id: on_chain_tx_id.toString() },
      });

      if (existing) {
        await existing.update({
          description: description || existing.description,
          amount: amount.toString() || existing.amount,
          currency: currency || existing.currency,
          status: status || existing.status,
          updated_at: new Date(),
        });

        return res.status(200).json({
          success: true,
          message: "Transaction record synchronized with existing on-chain event.",
          transaction: existing,
        });
      }
    }

    // Create new transaction row
    const transaction = await Transaction.create({
      buyer_wallet: buyerAddress,
      seller_wallet: sellerAddress,
      description,
      amount: amount.toString(),
      currency,
      status,
      on_chain_tx_id: on_chain_tx_id ? on_chain_tx_id.toString() : null,
    });

    return res.status(201).json({
      success: true,
      message: "Transaction created successfully.",
      transaction,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Gets full details of a transaction by ID.
 * GET /api/transactions/:id
 */
const getTransactionById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const transaction = await Transaction.findByPk(id, {
      include: [
        {
          model: User,
          as: "buyer",
          attributes: ["wallet_address", "display_name", "bio"],
        },
        {
          model: User,
          as: "seller",
          attributes: ["wallet_address", "display_name", "bio"],
        },
        {
          model: Dispute,
          as: "dispute",
        },
        {
          model: Rating,
          as: "ratings",
          include: [
            {
              model: User,
              as: "author",
              attributes: ["wallet_address", "display_name"],
            },
          ],
        },
      ],
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: `Transaction with ID '${id}' not found.`,
      });
    }

    return res.status(200).json({
      success: true,
      transaction,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Lists all transactions for a specific user wallet (as buyer or seller).
 * GET /api/transactions/user/:wallet
 */
const getUserTransactions = async (req, res, next) => {
  try {
    const wallet = req.params.wallet.toLowerCase();
    const { status, role } = req.query;

    let whereClause = {};

    if (role === "buyer") {
      whereClause.buyer_wallet = wallet;
    } else if (role === "seller") {
      whereClause.seller_wallet = wallet;
    } else {
      whereClause[Op.or] = [{ buyer_wallet: wallet }, { seller_wallet: wallet }];
    }

    if (status) {
      whereClause.status = status;
    }

    const transactions = await Transaction.findAll({
      where: whereClause,
      include: [
        { model: User, as: "buyer", attributes: ["wallet_address", "display_name"] },
        { model: User, as: "seller", attributes: ["wallet_address", "display_name"] },
        { model: Dispute, as: "dispute" },
      ],
      order: [["created_at", "DESC"]],
    });

    return res.status(200).json({
      success: true,
      count: transactions.length,
      transactions,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Updates the status of a transaction (e.g. after on-chain events or manual triggers).
 * PATCH /api/transactions/:id/status
 */
const updateTransactionStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, on_chain_tx_id } = req.body;

    const transaction = await Transaction.findByPk(id);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: `Transaction with ID '${id}' not found.`,
      });
    }

    transaction.status = status;
    if (on_chain_tx_id) {
      transaction.on_chain_tx_id = on_chain_tx_id.toString();
    }
    transaction.updated_at = new Date();
    await transaction.save();

    return res.status(200).json({
      success: true,
      message: `Transaction status updated to '${status}'.`,
      transaction,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createTransaction,
  getTransactionById,
  getUserTransactions,
  updateTransactionStatus,
};
