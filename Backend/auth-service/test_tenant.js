const jwt = require('jsonwebtoken');

const token = jwt.sign(
  { id: 'mock_superadmin_123', email: 'admin@dms.com', role: 'SuperAdmin' },
  'super_secret_jwt_key_123',
  { expiresIn: '1h' }
);

async function testRegistration() {
  try {
    // 1. Create a dummy tenant
    const createRes = await fetch('http://localhost:3003/api/tenant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        companyName: "Test Tenant " + Date.now(),
        companyCode: "TEST" + Date.now(),
        adminEmail: "test@example.com",
        registrationDate: "2026-07-22"
      })
    });
    
    const createData = await createRes.json();
    console.log("Create Response:", createData.success);

    // 2. Fetch the tenants
    const res = await fetch('http://localhost:3003/api/tenant', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const data = await res.json();
    if (data.tenants && data.tenants.length > 0) {
      console.log("Most recent tenant:");
      const t = data.tenants[0];
      console.log({
        companyName: t.companyName,
        createdAt: t.createdAt,
        registrationDate: t.registrationDate
      });
    }
  } catch (err) {
    console.error("Fetch error:", err.message);
  }
}

testRegistration();
