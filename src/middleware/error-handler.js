export function notFoundHandler(req, res) {
  res.status(404).json({
    error: "Not Found",
    message: `No route found for ${req.method} ${req.originalUrl}.`,
  });
}

export function errorHandler(error, req, res, next) {
  console.error(error);

  if (res.headersSent) {
    next(error);
    return;
  }

  const statusCode = Number.isInteger(error.status) ? error.status : 500;
  res.status(statusCode).json({
    error: statusCode >= 500 ? "Internal Server Error" : "Request Error",
    message: statusCode >= 500 ? "An unexpected server error occurred." : error.message,
  });
}
