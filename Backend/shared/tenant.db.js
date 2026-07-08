const mongoose = require('mongoose');

// Cache connections to avoid exceeding connection limits
const tenantConnections = {};

const getTenantConnection = async (companySlug, tenantDbUri) => {
  if (tenantConnections[companySlug]) {
    return tenantConnections[companySlug];
  }

  try {
    const connection = mongoose.createConnection(tenantDbUri, {
      // Additional options can go here
    });

    tenantConnections[companySlug] = connection;

    connection.on('error', (err) => {
      console.error(`Tenant DB connection error for slug: ${companySlug}`, err);
    });

    connection.once('open', () => {
      console.log(`Connected to Tenant DB for slug: ${companySlug}`);
    });

    return connection;
  } catch (error) {
    console.error(`Failed to connect to tenant DB: ${companySlug}`, error);
    throw error;
  }
};

module.exports = {
  getTenantConnection
};
