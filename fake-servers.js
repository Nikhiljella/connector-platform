const http = require('http');

// ═══════════════════════════════════════════
//  Fake JSON Servers — 3 APIs on ports 4001-4003
// ═══════════════════════════════════════════

// ── Server 1: Users API (port 4001) ──
const users = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  name: ['Alice Johnson', 'Bob Smith', 'Charlie Brown', 'Diana Ross', 'Ethan Hunt',
    'Fiona Apple', 'George Lucas', 'Hannah Montana', 'Ivan Drago', 'Julia Roberts',
    'Kevin Hart', 'Luna Lovegood', 'Mike Tyson', 'Nina Simone', 'Oscar Wilde',
    'Penny Lane', 'Quinn Hughes', 'Rachel Green', 'Steve Rogers', 'Tina Turner',
    'Uma Thurman', 'Victor Hugo', 'Wendy Darling', 'Xavier Charles', 'Yara Shahidi'][i],
  email: `user${i + 1}@example.com`,
  role: ['admin', 'editor', 'viewer', 'developer', 'analyst'][i % 5],
  active: i % 3 !== 0,
  created_at: new Date(Date.now() - Math.random() * 1e10).toISOString(),
}));

// ── Server 2: Metrics API (port 4002) ──
function generateMetrics() {
  return Array.from({ length: 10 }, (_, i) => ({
    id: i + 1,
    service: ['auth-service', 'api-gateway', 'payment-engine', 'notification-svc', 'search-index',
      'cache-layer', 'db-proxy', 'file-storage', 'ml-pipeline', 'scheduler'][i],
    cpu_percent: +(Math.random() * 80 + 5).toFixed(1),
    memory_mb: Math.floor(Math.random() * 2048 + 128),
    requests_per_sec: Math.floor(Math.random() * 500 + 10),
    error_rate: +(Math.random() * 5).toFixed(2),
    uptime_hours: Math.floor(Math.random() * 720 + 1),
    status: Math.random() > 0.1 ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
  }));
}

// ── Server 3: Products API (port 4003) ──
const products = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  name: ['Wireless Earbuds', 'Smart Watch', 'Laptop Stand', 'USB-C Hub', 'Mechanical Keyboard',
    'HD Webcam', 'Portable Charger', 'Bluetooth Speaker', 'LED Desk Lamp', 'Ergonomic Mouse',
    'Monitor Arm', 'Cable Organizer', 'Noise Cancelling Headphones', 'Tablet Stylus', 'Mini Projector',
    'Smart Plug', 'Fitness Tracker', 'External SSD', 'Ring Light', 'Desk Mat'][i],
  category: ['electronics', 'accessories', 'office', 'audio', 'lighting'][i % 5],
  price: +(Math.random() * 200 + 9.99).toFixed(2),
  stock: Math.floor(Math.random() * 500),
  rating: +(Math.random() * 2 + 3).toFixed(1),
  reviews: Math.floor(Math.random() * 1000),
}));

// ── Helper: create a JSON server ──
function createServer(port, name, getData) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(getData()));
  });

  server.listen(port, () => {
    console.log(`  ✅  ${name.padEnd(20)} → http://localhost:${port}`);
  });
}

console.log('\n🧪 Starting fake JSON servers...\n');

createServer(4001, 'Users API', () => users);
createServer(4002, 'Metrics API', () => generateMetrics());  // dynamic data each call
createServer(4003, 'Products API', () => products);

console.log('\n📋 Use these URLs to onboard connectors:\n');
console.log('  http://localhost:4001   — 25 users (static)');
console.log('  http://localhost:4002   — 10 service metrics (dynamic)');
console.log('  http://localhost:4003   — 20 products (static)\n');
