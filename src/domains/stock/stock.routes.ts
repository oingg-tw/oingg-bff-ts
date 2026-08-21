import { Router } from "ultimate-express";
import { AppError } from "../../shared/errorHandler.js";
import { getStockQuote } from "./stock.service.js";

export const stockRouter = Router();

stockRouter.get("/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const quote = await getStockQuote(symbol);
  if (!quote) {
    throw new AppError(`No stock data found for symbol "${symbol}"`, 404);
  }
  res.json(quote);
});
