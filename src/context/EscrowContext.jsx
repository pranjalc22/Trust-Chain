import React, { createContext, useContext, useState, useCallback } from 'react';
import { useWallet } from './WalletContext';
import * as api from '../services/api';
import * as contracts from '../services/contracts';

const EscrowContext = createContext();

export const EscrowProvider = ({ children }) => {
  // Toast notification state
  const [toastMessage, setToastMessage] = useState(null);

  // Global loading / pending-tx state
  const [pendingAction, setPendingAction] = useState(null); // { type, message }

  const { account } = useWallet();

  // ─── Toast ────────────────────────────────────────────

  const showToast = useCallback((title, message, type = 'success') => {
    setToastMessage({ title, message, type, id: Date.now() });
    setTimeout(() => setToastMessage(null), 4500);
  }, []);

  // ─── Loading Helpers ──────────────────────────────────

  const startPending = useCallback((message) => setPendingAction({ message }), []);
  const clearPending = useCallback(() => setPendingAction(null), []);

  // ─── Classify and show contract errors ────────────────

  const handleContractError = useCallback((err) => {
    const classified = contracts.classifyContractError(err);
    showToast('Transaction Failed', classified.message, 'error');
    return classified;
  }, [showToast]);

  // ─── Create Transaction (on-chain + backend) ─────────

  const createTransaction = useCallback(async ({ seller, amount, description, deliveryTerms, currency, inspectionPeriodDays }) => {
    startPending('Waiting for MetaMask approval...');
    try {
      // 1. On-chain: lock escrow
      startPending('Confirm the transaction in MetaMask...');
      const { txHash, onChainTxId } = await contracts.createEscrowTransaction(seller, amount);

      // 2. Backend: record the transaction with metadata
      startPending('Recording transaction on backend...');
      const result = await api.createTransaction({
        buyer_wallet: account,
        seller_wallet: seller,
        description,
        amount,
        currency: currency || 'ETH',
        on_chain_tx_id: onChainTxId,
        status: 'Created',
      });

      clearPending();
      showToast('Escrow Funds Locked!', `Transaction created with ${amount} ${currency || 'ETH'} in escrow. Tx: ${txHash.slice(0, 12)}...`, 'success');
      return { backendTx: result.transaction, txHash, onChainTxId };
    } catch (err) {
      clearPending();
      handleContractError(err);
      throw err;
    }
  }, [account, startPending, clearPending, showToast, handleContractError]);

  // ─── Mark Delivered (on-chain + backend) ──────────────

  const markDelivered = useCallback(async (backendTxId, onChainTxId) => {
    startPending('Confirm delivery in MetaMask...');
    try {
      await contracts.markDeliveredOnChain(onChainTxId);

      startPending('Updating backend status...');
      await api.updateTransactionStatus(backendTxId, { status: 'Delivered' });

      clearPending();
      showToast('Order Delivered!', 'Marked as delivered on-chain. Inspection period is now active.', 'info');
    } catch (err) {
      clearPending();
      handleContractError(err);
      throw err;
    }
  }, [startPending, clearPending, showToast, handleContractError]);

  // ─── Confirm Completion (on-chain + backend) ──────────

  const confirmCompletion = useCallback(async (backendTxId, onChainTxId) => {
    startPending('Confirm completion in MetaMask...');
    try {
      await contracts.confirmCompletionOnChain(onChainTxId);

      startPending('Updating backend status...');
      await api.updateTransactionStatus(backendTxId, { status: 'Completed' });

      clearPending();
      showToast('Escrow Settled!', 'Funds released to seller! You can now rate your counterpart.', 'success');
    } catch (err) {
      clearPending();
      handleContractError(err);
      throw err;
    }
  }, [startPending, clearPending, showToast, handleContractError]);

  // ─── Raise Dispute (on-chain + backend) ───────────────

  const raiseDispute = useCallback(async (backendTxId, onChainTxId, reason) => {
    startPending('Raising dispute on-chain via MetaMask...');
    try {
      await contracts.raiseDisputeOnChain(onChainTxId);

      startPending('Recording dispute on backend...');
      await api.createDispute({
        transaction_id: backendTxId,
        raised_by: account,
        evidence_buyer: reason,
      });

      clearPending();
      showToast('Dispute Opened', 'Escrow locked by arbitration protocol. Both parties may submit evidence.', 'warning');
    } catch (err) {
      clearPending();
      handleContractError(err);
      throw err;
    }
  }, [account, startPending, clearPending, showToast, handleContractError]);

  // ─── Resolve Dispute (on-chain + backend) ─────────────

  const resolveDispute = useCallback(async (backendTxId, onChainTxId, disputeId, decision, notes) => {
    const releaseToSeller = decision === 'release_to_seller';
    startPending('Resolving dispute on-chain via MetaMask...');
    try {
      await contracts.resolveDisputeOnChain(onChainTxId, releaseToSeller);

      startPending('Recording resolution on backend...');
      await api.resolveDispute(disputeId, {
        resolution: notes || 'Arbitration judgment rendered.',
        outcome: releaseToSeller ? 'Resolved_Seller' : 'Resolved_Buyer',
        resolved_by: account,
      });

      clearPending();
      showToast(
        'Dispute Arbitrated',
        releaseToSeller ? 'Funds released to seller by Arbitrator.' : 'Funds refunded to buyer by Arbitrator.',
        'success'
      );
    } catch (err) {
      clearPending();
      handleContractError(err);
      throw err;
    }
  }, [account, startPending, clearPending, showToast, handleContractError]);

  // ─── Submit Review (on-chain + backend) ───────────────

  const submitReview = useCallback(async (backendTxId, recipientAddress, stars, comment) => {
    startPending('Submitting rating on-chain via MetaMask...');
    try {
      // On-chain rating (may fail if already rated or no completed tx)
      try {
        await contracts.submitRatingOnChain(recipientAddress, stars);
      } catch (chainErr) {
        // If on-chain fails (e.g. already rated), still record off-chain
        console.warn('On-chain rating failed (may have already rated):', chainErr.message);
      }

      startPending('Recording rating on backend...');
      await api.submitRating({
        transaction_id: backendTxId,
        to_wallet: recipientAddress,
        from_wallet: account,
        stars,
        comment,
      });

      clearPending();
      showToast('Feedback Published', 'Reputation rating submitted!', 'success');
    } catch (err) {
      clearPending();
      handleContractError(err);
      throw err;
    }
  }, [account, startPending, clearPending, showToast, handleContractError]);

  // ─── Read Helpers (delegate to API) ───────────────────

  const fetchUserTransactions = useCallback(async (wallet) => {
    try {
      const data = await api.getUserTransactions(wallet);
      return data.transactions || [];
    } catch (err) {
      console.error('fetchUserTransactions error:', err);
      return [];
    }
  }, []);

  const fetchTransactionById = useCallback(async (id) => {
    try {
      const data = await api.getTransactionById(id);
      return data.transaction || null;
    } catch (err) {
      console.error('fetchTransactionById error:', err);
      return null;
    }
  }, []);

  const fetchUserProfile = useCallback(async (wallet) => {
    try {
      const data = await api.getUserProfile(wallet);
      return data;
    } catch (err) {
      console.error('fetchUserProfile error:', err);
      return null;
    }
  }, []);

  const fetchLiveReputation = useCallback(async (wallet) => {
    try {
      const data = await api.getLiveReputation(wallet);
      return data;
    } catch (err) {
      console.error('fetchLiveReputation error:', err);
      return null;
    }
  }, []);

  const fetchOpenDisputes = useCallback(async () => {
    try {
      const data = await api.getOpenDisputes();
      return data.disputes || [];
    } catch (err) {
      console.error('fetchOpenDisputes error:', err);
      return [];
    }
  }, []);

  // ─── Context Value ────────────────────────────────────

  return (
    <EscrowContext.Provider
      value={{
        toastMessage,
        pendingAction,
        showToast,

        // Write operations (on-chain + backend)
        createTransaction,
        markDelivered,
        confirmCompletion,
        raiseDispute,
        resolveDispute,
        submitReview,

        // Read operations (backend API)
        fetchUserTransactions,
        fetchTransactionById,
        fetchUserProfile,
        fetchLiveReputation,
        fetchOpenDisputes,
      }}
    >
      {children}
    </EscrowContext.Provider>
  );
};

export const useEscrow = () => useContext(EscrowContext);
