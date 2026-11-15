// ============================================================
//  routes/demoRoutes.js — Demo Management Endpoint
// ============================================================

const express = require("express");
const router = express.Router();
const demoController = require("../controllers/demoController");

// POST /api/demo/reset — Reset database to clean demo state
router.post("/reset", demoController.resetDemoData);

module.exports = router;
