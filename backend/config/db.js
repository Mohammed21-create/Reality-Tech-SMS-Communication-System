'use strict';
const mongoose = require('mongoose');
const env = require('./env');
const logger = require('../utils/logger');

async function connectDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri, {
    maxPoolSize: env.mongoPoolSize,
    serverSelectionTimeoutMS: 10000,
  });
  logger.info('mongo_connected');
  return mongoose.connection;
}

async function disconnectDb() {
  await mongoose.disconnect();
}

module.exports = { connectDb, disconnectDb, mongoose };
