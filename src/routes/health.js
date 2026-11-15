import { Router } from "express";
import mongoose from "mongoose";

const router = Router();

router.get("/", (req, res) => {
  const isDatabaseConnected = mongoose.connection.readyState === 1;

  res.status(isDatabaseConnected ? 200 : 503).json({
    status: isDatabaseConnected ? "ok" : "unavailable",
    service: "datascope-api",
    database: isDatabaseConnected ? "connected" : "disconnected",
  });
});

export default router;
