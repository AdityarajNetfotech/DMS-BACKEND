const errorHandler = (err, req, res, next) => {
  console.error(err.stack || err.message);
  
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  if (err.code === 'LIMIT_FILE_SIZE' || (err.message && err.message.toLowerCase().includes('file size too large'))) {
    statusCode = 400;
    message = "Can't upload file more than 10 MB";
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = { errorHandler };
