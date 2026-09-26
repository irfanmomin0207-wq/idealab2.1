import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function apiDevMiddleware(): Plugin {
  return {
    name: 'api-dev-middleware',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api')) {
          return next();
        }

        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathname = url.pathname;

        if (pathname === '/api/health') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
          return;
        }

        if (pathname === '/api/pcb/builder') {
          const optionsPath = path.resolve(__dirname, 'api/pcb/options.json');
          let options = {};
          if (fs.existsSync(optionsPath)) {
            options = JSON.parse(fs.readFileSync(optionsPath, 'utf-8'));
          }

          if (req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, options }));
            return;
          }

          if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const data = JSON.parse(body || '{}');
                const { width = 50, height = 50, layerCount = 2, color = 'green', copperThickness = '1oz' } = data;
                const boardAreaCm2 = (width / 10) * (height / 10);
                const basePricePerCm2 = 15;
                const layerMultiplier = layerCount === 4 ? 2.5 : layerCount === 6 ? 4.0 : layerCount === 8 ? 6.0 : 1.0;
                const colorMultiplier = color === 'black' ? 1.25 : color === 'yellow' || color === 'white' ? 1.2 : color === 'red' || color === 'blue' ? 1.15 : 1.0;
                const copperMultiplier = copperThickness === '3oz' ? 1.6 : copperThickness === '2oz' ? 1.3 : 1.0;
                const basePrice = boardAreaCm2 * basePricePerCm2 * layerMultiplier * colorMultiplier * copperMultiplier;

                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                  success: true,
                  specification: data,
                  calculations: {
                    boardAreaCm2: parseFloat(boardAreaCm2.toFixed(2)),
                    boardAreaMm2: parseFloat((boardAreaCm2 * 100).toFixed(2)),
                    copperUsageGrams: parseFloat((boardAreaCm2 * 0.45).toFixed(2)),
                    estimatedPriceINR: Math.round(basePrice),
                    priceBreakdown: {
                      basePrice: parseFloat(basePrice.toFixed(2)),
                      sgst: parseFloat((basePrice * 0.09).toFixed(2)),
                      cgst: parseFloat((basePrice * 0.09).toFixed(2)),
                      totalWithGST: parseFloat((basePrice * 1.18).toFixed(2))
                    }
                  }
                }));
              } catch (e: any) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: false, error: e.message }));
              }
            });
            return;
          }
        }

        if (pathname === '/api/stl/price' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const { grams = 0, userType = 'student' } = JSON.parse(body || '{}');
              const costPerGram = userType === 'faculty' ? 2.0 : userType === 'student' ? 2.5 : 3.5;
              const discount = userType === 'faculty' ? 20 : 0;
              const materialCost = grams * costPerGram;
              const supportCost = materialCost * 0.1;
              const serviceCharge = (materialCost + supportCost) * 0.05;
              const subtotal = materialCost + supportCost + serviceCharge;
              const discountAmt = (subtotal * discount) / 100;
              const finalCost = subtotal - discountAmt;

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                costRupees: Math.round(finalCost),
                breakdown: {
                  grams,
                  userType,
                  costPerGram,
                  materialCost,
                  supportMaterialCost: supportCost,
                  serviceCharge,
                  subtotal,
                  discountPercentage: discount,
                  discountAmount: discountAmt,
                  finalCost
                }
              }));
            } catch (e: any) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: e.message }));
            }
          });
          return;
        }

        next();
      });
    }
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        allowedHosts: true,
      },
      plugins: [react(), apiDevMiddleware()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        __ENV_API_URL__: JSON.stringify(env.VITE_API_URL || '/api'),
        __ENV_GOOGLE_CLIENT_ID__: JSON.stringify(env.VITE_GOOGLE_CLIENT_ID || '')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
