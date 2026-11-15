// ============================================================
//  app.js — Express Application Configuration
// ============================================================

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const apiRoutes = require("./routes");
const { notFoundHandler, errorHandler } = require("./middleware/errorHandler");

const app = express();

// Middlewares
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount API routes under /api
app.use("/api", apiRoutes);

// Root route
app.get("/", (req, res) => {
  res.json({
    message: "TrustChain Off-chain REST API",
    version: "1.0.0",
    docs: "/api/health",
  });
});

// 404 & Global Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
