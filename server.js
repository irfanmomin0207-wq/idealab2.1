#!/usr/bin/env node

/**
 * Local API Server for Development
 * Serves the serverless API functions locally for testing before Vercel deployment
 * 
 * Usage: node server.js
 * This will start both the frontend (port 3000) and API (port 3001)
 */

import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import fetch from 'cross-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const API_PORT = process.env.API_PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increased for base64 encoded files
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configure multer with higher limits for STL uploads
const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/sla' || file.originalname.toLowerCase().endsWith('.stl')) {
      cb(null, true);
    } else {
      cb(new Error('Only STL files are allowed'));
    }
  }
});

// Load environment variables safely
const env = { ...process.env };
try {
  const envPath = path.join(__dirname, '.env.local');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const envLines = envContent.split('\n');
    envLines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('#') && trimmed.includes('=')) {
        const [key, ...valueParts] = trimmed.split('=');
        env[key.trim()] = valueParts.join('=').trim();
      }
    });
  }
} catch (e) {
  console.warn('Could not read .env.local, using process.env');
}

console.log('Environment loaded:', {
  GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID ? '✓' : '✗',
  GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET ? '✓' : '✗',
  JWT_SECRET: env.JWT_SECRET ? '✓' : '✗',
});

// Google OAuth2 Configuration
const oauth2Client = new google.auth.OAuth2(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/auth/google/callback'
);

const MICROSOFT_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH_ENDPOINT = 'https://graph.microsoft.com/v1.0/me';

// ============================================================================
// GOOGLE OAUTH ROUTES
// ============================================================================

/**
 * GET /api/auth/google
 * Returns the Google OAuth2 login URL
 */
app.get('/api/auth/google', (req, res) => {
  try {
    const scopes = [
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
    ];

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      state: Buffer.from(JSON.stringify({ nonce: Date.now() })).toString('base64'),
    });

    console.log('[Google OAuth] Generated auth URL:', authUrl);
    res.json({ url: authUrl });
  } catch (error) {
    console.error('[Google OAuth] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/google
 * Exchanges authorization code for JWT token
 */
app.post('/api/auth/google', async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    console.log('[Google OAuth] Exchanging code for token...');

    // Exchange code for token
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user profile
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    console.log('[Google OAuth] User profile:', profile);

    // Create user object
    const user = {
      id: `USR-${profile.id}`,
      name: profile.name || 'Google User',
      email: profile.email,
      avatar: profile.picture || `https://ui-avatars.com/api/?name=${profile.name}`,
      type: 'non-university',
      isProfileComplete: true,
    };

    // Persist user to simple JSON DB (data/users.json)
    try {
      const dataDir = path.join(__dirname, 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const usersFile = path.join(dataDir, 'users.json');
      let users = [];
      if (fs.existsSync(usersFile)) {
        const raw = fs.readFileSync(usersFile, 'utf-8');
        users = raw ? JSON.parse(raw) : [];
      }

      const existing = users.find(u => u.email === user.email);
      if (existing) {
        // merge updates
        const updated = { ...existing, ...user };
        users = users.map(u => u.email === existing.email ? updated : u);
      } else {
        users.push(user);
      }
      fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf-8');
      console.log('[UserDB] Upserted user:', user.email);
    } catch (err) {
      console.warn('[UserDB] Failed to persist user:', err);
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      env.JWT_SECRET || 'your-super-secret-jwt-key-min-32-characters-recommended-here',
      { expiresIn: '7d' }
    );

    console.log('[Google OAuth] Token generated, user logged in:', user.email);
    res.json({ user, token });
  } catch (error) {
    console.error('[Google OAuth] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/auth/google/callback
 * Server-side redirect handler for Google OAuth callback
 */
app.get('/api/auth/google/callback', (req, res) => {
  try {
    const { code, error, state } = req.query;

    console.log('[Google Callback] Received from Google:', { code: !!code, error, state });

    if (error) {
      const errorUrl = `http://localhost:3000/#/auth/google/callback?error=${encodeURIComponent(error)}`;
      console.log('[Google Callback] Redirecting with error:', errorUrl);
      return res.redirect(errorUrl);
    }

    if (!code) {
      const errorUrl = `http://localhost:3000/#/auth/google/callback?error=no_code`;
      console.log('[Google Callback] No code received, redirecting with error:', errorUrl);
      return res.redirect(errorUrl);
    }

    // Redirect to frontend callback page with code
    const callbackUrl = `http://localhost:3000/#/auth/google/callback?code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}`;
    console.log('[Google Callback] Redirecting to frontend:', callbackUrl);
    res.redirect(callbackUrl);
  } catch (error) {
    console.error('[Google Callback] Error:', error);
    const errorUrl = `http://localhost:3000/#/auth/google/callback?error=server_error`;
    res.redirect(errorUrl);
  }
});

// ============================================================================
// MICROSOFT OAUTH ROUTES
// ============================================================================

/**
 * GET /api/auth/microsoft
 * Returns the Microsoft OAuth2 login URL
 */
app.get('/api/auth/microsoft', (req, res) => {
  try {
    const clientId = env.MICROSOFT_CLIENT_ID;
    const redirectUri = env.MICROSOFT_REDIRECT_URI || 'http://localhost:3001/api/auth/microsoft/callback';

    if (!clientId) {
      return res.status(500).json({ error: 'MICROSOFT_CLIENT_ID is not configured' });
    }

    const authUrl = new URL(`${MICROSOFT_ENDPOINT}/authorize`);
    authUrl.searchParams.append('client_id', clientId);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', 'openid profile email offline_access');
    authUrl.searchParams.append('state', Buffer.from(JSON.stringify({ nonce: Date.now() })).toString('base64'));

    console.log('[Microsoft OAuth] Generated auth URL:', authUrl.toString());
    res.json({ url: authUrl.toString() });
  } catch (error) {
    console.error('[Microsoft OAuth] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/microsoft
 * Exchanges authorization code for JWT token
 */
app.post('/api/auth/microsoft', async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    const clientId = env.MICROSOFT_CLIENT_ID;
    const clientSecret = env.MICROSOFT_CLIENT_SECRET;
    const redirectUri = env.MICROSOFT_REDIRECT_URI || 'http://localhost:3001/api/auth/microsoft/callback';

    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: 'Microsoft OAuth is not configured' });
    }

    console.log('[Microsoft OAuth] Exchanging code for token...');

    // Exchange code for token
    const tokenResponse = await fetch(`${MICROSOFT_ENDPOINT}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code: code,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
    }

    const { access_token } = await tokenResponse.json();

    // Get user profile from Microsoft Graph
    const profileResponse = await fetch(GRAPH_ENDPOINT, {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const profile = await profileResponse.json();

    console.log('[Microsoft OAuth] User profile:', profile);

    // Create user object
    const user = {
      id: `USR-${profile.id}`,
      name: profile.displayName || 'Microsoft User',
      email: profile.mail || profile.userPrincipalName,
      avatar: `https://ui-avatars.com/api/?name=${profile.displayName}`,
      type: 'university',
      isProfileComplete: true,
    };

    // Persist user to simple JSON DB (data/users.json)
    try {
      const dataDir = path.join(__dirname, 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const usersFile = path.join(dataDir, 'users.json');
      let users = [];
      if (fs.existsSync(usersFile)) {
        const raw = fs.readFileSync(usersFile, 'utf-8');
        users = raw ? JSON.parse(raw) : [];
      }

      const existing = users.find(u => u.email === user.email);
      if (existing) {
        const updated = { ...existing, ...user };
        users = users.map(u => u.email === existing.email ? updated : u);
      } else {
        users.push(user);
      }
      fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf-8');
      console.log('[UserDB] Upserted user:', user.email);
    } catch (err) {
      console.warn('[UserDB] Failed to persist user:', err);
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      env.JWT_SECRET || 'your-super-secret-jwt-key-min-32-characters-recommended-here',
      { expiresIn: '7d' }
    );

    console.log('[Microsoft OAuth] Token generated, user logged in:', user.email);
    res.json({ user, token });
  } catch (error) {
    console.error('[Microsoft OAuth] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/auth/microsoft/callback
 * Server-side redirect handler for Microsoft OAuth callback
 */
app.get('/api/auth/microsoft/callback', (req, res) => {
  try {
    const { code, error, state } = req.query;

    console.log('[Microsoft Callback] Received from Microsoft:', { code: !!code, error, state });

    if (error) {
      const errorUrl = `http://localhost:3000/#/auth/microsoft/callback?error=${encodeURIComponent(error)}`;
      console.log('[Microsoft Callback] Redirecting with error:', errorUrl);
      return res.redirect(errorUrl);
    }

    if (!code) {
      const errorUrl = `http://localhost:3000/#/auth/microsoft/callback?error=no_code`;
      console.log('[Microsoft Callback] No code received, redirecting with error:', errorUrl);
      return res.redirect(errorUrl);
    }

    // Redirect to frontend callback page with code
    const callbackUrl = `http://localhost:3000/#/auth/microsoft/callback?code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}`;
    console.log('[Microsoft Callback] Redirecting to frontend:', callbackUrl);
    res.redirect(callbackUrl);
  } catch (error) {
    console.error('[Microsoft Callback] Error:', error);
    const errorUrl = `http://localhost:3000/#/auth/microsoft/callback?error=server_error`;
    res.redirect(errorUrl);
  }
});

// ============================================================================
// STL ROUTES
// ============================================================================

// STL Data structures (using plain objects)

// Parse binary STL file
function parseBinarySTL(buffer) {
  const facets = [];
  const dataView = new DataView(buffer.buffer);

  // Skip 80-byte header
  let offset = 80;

  // Read number of triangles
  const numTriangles = dataView.getUint32(offset, true);
  offset += 4;

  for (let i = 0; i < numTriangles; i++) {
    const normal = {
      x: dataView.getFloat32(offset, true),
      y: dataView.getFloat32(offset + 4, true),
      z: dataView.getFloat32(offset + 8, true)
    };
    offset += 12;

    const v1 = {
      x: dataView.getFloat32(offset, true),
      y: dataView.getFloat32(offset + 4, true),
      z: dataView.getFloat32(offset + 8, true)
    };
    offset += 12;

    const v2 = {
      x: dataView.getFloat32(offset, true),
      y: dataView.getFloat32(offset + 4, true),
      z: dataView.getFloat32(offset + 8, true)
    };
    offset += 12;

    const v3 = {
      x: dataView.getFloat32(offset, true),
      y: dataView.getFloat32(offset + 4, true),
      z: dataView.getFloat32(offset + 8, true)
    };
    offset += 12;

    facets.push({ normal, vertices: [v1, v2, v3] });

    // Skip attribute byte count
    offset += 2;
  }

  return { facets };
}

// Parse ASCII STL file
function parseASCIISTL(content) {
  const facets = [];
  console.log('[ASCII STL] Content length:', content.length);
  console.log('[ASCII STL] First 200 chars:', content.substring(0, 200));

  // More flexible regex to handle various whitespace patterns
  const facetRegex = /facet\s+normal\s+([\d\.\-\s]+).*?outer\s+loop.*?vertex\s+([\d\.\-\s]+).*?vertex\s+([\d\.\-\s]+).*?vertex\s+([\d\.\-\s]+).*?endloop.*?endfacet/gsi;

  let match;
  let matchCount = 0;
  while ((match = facetRegex.exec(content)) !== null) {
    matchCount++;
    console.log('[ASCII STL] Match', matchCount, ':', match[0].substring(0, 100) + '...');
    try {
      const normalStr = match[1].trim().split(/\s+/).filter(s => s.length > 0);
      const v1Str = match[2].trim().split(/\s+/).filter(s => s.length > 0);
      const v2Str = match[3].trim().split(/\s+/).filter(s => s.length > 0);
      const v3Str = match[4].trim().split(/\s+/).filter(s => s.length > 0);

      console.log('[ASCII STL] Parsed - normal:', normalStr, 'v1:', v1Str, 'v2:', v2Str, 'v3:', v3Str);

      if (normalStr.length !== 3 || v1Str.length !== 3 || v2Str.length !== 3 || v3Str.length !== 3) {
        console.log('[ASCII STL] Skipping malformed facet - normal:', normalStr.length, 'vertices:', v1Str.length, v2Str.length, v3Str.length);
        continue;
      }

      const normal = {
        x: parseFloat(normalStr[0]),
        y: parseFloat(normalStr[1]),
        z: parseFloat(normalStr[2])
      };

      const v1 = {
        x: parseFloat(v1Str[0]),
        y: parseFloat(v1Str[1]),
        z: parseFloat(v1Str[2])
      };

      const v2 = {
        x: parseFloat(v2Str[0]),
        y: parseFloat(v2Str[1]),
        z: parseFloat(v2Str[2])
      };

      const v3 = {
        x: parseFloat(v3Str[0]),
        y: parseFloat(v3Str[1]),
        z: parseFloat(v3Str[2])
      };

      // Validate coordinates are numbers
      if (isNaN(normal.x) || isNaN(v1.x) || isNaN(v2.x) || isNaN(v3.x)) {
        console.log('[ASCII STL] Skipping facet with invalid coordinates');
        continue;
      }

      facets.push({ normal, vertices: [v1, v2, v3] });
    } catch (error) {
      console.log('[ASCII STL] Error parsing facet:', error.message);
      continue;
    }
  }

  console.log('[ASCII STL] Total matches found:', matchCount);
  console.log('[ASCII STL] Valid facets parsed:', facets.length);

  return { facets };
}

// Calculate bounding box
function calculateBoundingBox(facets) {
  if (facets.length === 0) return { widthMm: 0, heightMm: 0, depthMm: 0 };

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const facet of facets) {
    for (const vertex of facet.vertices) {
      minX = Math.min(minX, vertex.x);
      maxX = Math.max(maxX, vertex.x);
      minY = Math.min(minY, vertex.y);
      maxY = Math.max(maxY, vertex.y);
      minZ = Math.min(minZ, vertex.z);
      maxZ = Math.max(maxZ, vertex.z);
    }
  }

  return {
    widthMm: maxX - minX,
    heightMm: maxY - minY,
    depthMm: maxZ - minZ
  };
}

// Calculate volume using signed tetrahedron method
function calculateVolume(facets) {
  let volume = 0;

  for (const facet of facets) {
    const [v1, v2, v3] = facet.vertices;
    // Signed volume of tetrahedron formed by facet vertices and origin
    volume += (1/6) * (
      v1.x * (v2.y * v3.z - v3.y * v2.z) -
      v2.x * (v1.y * v3.z - v3.y * v1.z) +
      v3.x * (v1.y * v2.z - v2.y * v1.z)
    );
  }

  return Math.abs(volume); // Volume in mm³ (STL coordinates are typically in mm)
}

// Estimate print time (simplified)
function estimatePrintTime(volumeMm3, heightMm) {
  if (volumeMm3 <= 0 || heightMm <= 0) return { estimatedPrintTimeHours: 0, estimatedPrintTimeMinutes: 0 };

  const layerHeight = 0.2; // mm
  const numLayers = heightMm / layerHeight;
  const printSpeed = 60; // mm³/minute (simplified)
  const overheadPerLayer = 0.5; // minutes

  const printTimeMinutes = (volumeMm3 / printSpeed) + (numLayers * overheadPerLayer);
  const printTimeHours = printTimeMinutes / 60;

  return {
    estimatedPrintTimeHours: Math.round(printTimeHours * 10) / 10,
    estimatedPrintTimeMinutes: Math.round(printTimeMinutes)
  };
}

/**
 * POST /api/stl/upload
 * Uploads an STL file and returns file reference
 */
app.post('/api/stl/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.file;
    const buffer = file.buffer;

    // Basic validation
    if (buffer.length < 84) {
      return res.status(400).json({ error: 'File too small to be a valid STL' });
    }

    // Check if binary or ASCII
    const header = buffer.toString('ascii', 0, 80).toLowerCase();
    const isASCII = header.includes('solid');

    if (!isASCII && buffer.readUInt32LE(80) === 0) {
      return res.status(400).json({ error: 'Invalid STL file format' });
    }

    const fileReference = {
      id: `STL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      filename: file.originalname,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      buffer: buffer.toString('base64')
    };

    console.log(`[STL Upload] File uploaded: ${file.originalname} (${file.size} bytes)`);
    res.json({ fileReference });
  } catch (error) {
    console.error('[STL Upload] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

/**
 * POST /api/stl/analyze
 * Analyzes an uploaded STL file and returns geometry data
 */
app.post('/api/stl/analyze', (req, res) => {
  try {
    const { fileBuffer } = req.body;

    if (!fileBuffer) {
      return res.status(400).json({ error: 'fileBuffer is required' });
    }

    // Decode base64 buffer
    const buffer = Buffer.from(fileBuffer, 'base64');

    if (buffer.length < 84) {
      return res.status(400).json({ error: 'Invalid STL file' });
    }

    // Parse STL - improved detection
    console.log('[STL Analyze] Buffer size:', buffer.length);
    const header = buffer.toString('ascii', 0, Math.min(80, buffer.length)).toLowerCase();
    console.log('[STL Analyze] Header:', header.substring(0, 50));

    const isASCII = header.includes('solid') || header.includes('facet') || header.includes('vertex');
    console.log('[STL Analyze] Detected as ASCII:', isASCII);

    let stlData;
    if (isASCII) {
      console.log('[STL Analyze] Parsing as ASCII STL');
      const content = buffer.toString('ascii');
      stlData = parseASCIISTL(content);
      console.log('[STL Analyze] ASCII parsing result - facets:', stlData.facets.length);
    } else {
      console.log('[STL Analyze] Checking binary format...');
      // Double-check it's actually binary by checking for triangle count
      if (buffer.length >= 84) {
        const triangleCount = buffer.readUInt32LE(80);
        console.log('[STL Analyze] Binary triangle count:', triangleCount);
        const expectedSize = 84 + (triangleCount * 50); // 50 bytes per triangle
        console.log('[STL Analyze] Expected size:', expectedSize, 'Actual size:', buffer.length);

        if (buffer.length >= expectedSize) {
          console.log('[STL Analyze] Parsing as binary STL');
          stlData = parseBinarySTL(buffer);
          console.log('[STL Analyze] Binary parsing result - facets:', stlData.facets.length);
        } else {
          // Fallback to ASCII parsing if binary format doesn't match
          console.log('[STL Analyze] Binary format mismatch, falling back to ASCII');
          const content = buffer.toString('ascii');
          stlData = parseASCIISTL(content);
          console.log('[STL Analyze] ASCII fallback result - facets:', stlData.facets.length);
        }
      } else {
        // Too small for binary, try ASCII
        console.log('[STL Analyze] Too small for binary, trying ASCII');
        const content = buffer.toString('ascii');
        stlData = parseASCIISTL(content);
        console.log('[STL Analyze] ASCII parsing result - facets:', stlData.facets.length);
      }
    }

    if (stlData.facets.length === 0) {
      console.log('[STL Analyze] ERROR: No valid facets found');
      return res.status(400).json({ error: 'No valid facets found in STL file' });
    }

    // Calculate metrics
    const boundingBox = calculateBoundingBox(stlData.facets);
    const volumeMm3 = calculateVolume(stlData.facets);
    const volumeCm3 = volumeMm3 / 1000;
    const plaDensity = 1.25; // g/cm³
    const plaWeightGrams = volumeCm3 * plaDensity;
    const estimatedCostINR = plaWeightGrams * 4.5; // ₹4.5 per gram
    const printTime = estimatePrintTime(volumeMm3, boundingBox.heightMm);
    const supportWastePercentage = 10; // Simplified

    const analysis = {
      volume: {
        mm3: Math.round(volumeMm3),
        cm3: Math.round(volumeCm3 * 100) / 100
      },
      boundingBox,
      material: {
        plaWeightGrams: Math.round(plaWeightGrams * 100) / 100,
        estimatedCostINR: Math.round(estimatedCostINR)
      },
      printing: {
        estimatedPrintTimeHours: printTime.estimatedPrintTimeHours,
        estimatedPrintTimeMinutes: printTime.estimatedPrintTimeMinutes,
        supportWastePercentage
      }
    };

    console.log(`[STL Analyze] Analyzed ${stlData.facets.length} facets, volume: ${volumeMm3} mm³`);
    res.json({ analysis });
  } catch (error) {
    console.error('[STL Analyze] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Analysis failed' });
  }
});

/**
 * POST /api/stl/upload-analyze
 * Combined upload and analyze endpoint for better performance
 */
app.post('/api/stl/upload-analyze', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.file;
    const buffer = file.buffer;

    // Basic validation
    if (buffer.length < 84) {
      return res.status(400).json({ error: 'File too small to be a valid STL' });
    }

    // Check if binary or ASCII
    const header = buffer.toString('ascii', 0, 80).toLowerCase();
    const isASCII = header.includes('solid');

    if (!isASCII && buffer.readUInt32LE(80) === 0) {
      return res.status(400).json({ error: 'Invalid STL file format' });
    }

    // Parse STL
    let stlData;
    if (isASCII) {
      const content = buffer.toString('ascii');
      stlData = parseASCIISTL(content);
    } else {
      stlData = parseBinarySTL(buffer);
    }

    if (stlData.facets.length === 0) {
      return res.status(400).json({ error: 'No valid facets found in STL file' });
    }

    // Calculate metrics
    const boundingBox = calculateBoundingBox(stlData.facets);
    const volumeMm3 = calculateVolume(stlData.facets);
    const volumeCm3 = volumeMm3 / 1000;
    const plaDensity = 1.25; // g/cm³
    const plaWeightGrams = volumeCm3 * plaDensity;
    const estimatedCostINR = plaWeightGrams * 4.5; // ₹4.5 per gram
    const printTime = estimatePrintTime(volumeMm3, boundingBox.heightMm);
    const supportWastePercentage = 10; // Simplified

    const fileReference = {
      id: `STL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      filename: file.originalname,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      buffer: buffer.toString('base64')
    };

    const analysis = {
      volume: {
        mm3: Math.round(volumeMm3),
        cm3: Math.round(volumeCm3 * 100) / 100
      },
      boundingBox,
      material: {
        plaWeightGrams: Math.round(plaWeightGrams * 100) / 100,
        estimatedCostINR: Math.round(estimatedCostINR)
      },
      printing: {
        estimatedPrintTimeHours: printTime.estimatedPrintTimeHours,
        estimatedPrintTimeMinutes: printTime.estimatedPrintTimeMinutes,
        supportWastePercentage
      }
    };

    console.log(`[STL Upload-Analyze] Processed ${file.originalname}: ${stlData.facets.length} facets, volume: ${volumeMm3} mm³`);
    res.json({ fileReference, analysis });
  } catch (error) {
    console.error('[STL Upload-Analyze] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Upload and analysis failed' });
  }
});

/**
 * POST /api/stl/price
 * Calculates printing price based on weight and user type
 */
app.post('/api/stl/price', (req, res) => {
  try {
    const { grams, userType } = req.body;

    if (grams === undefined || grams === null) {
      return res.status(400).json({ error: 'grams parameter is required' });
    }

    if (typeof grams !== 'number' || grams < 0) {
      return res.status(400).json({ error: 'grams must be a positive number' });
    }

    const validUserTypes = ['student', 'faculty', 'guest'];
    const normalizedUserType = (userType || 'guest').toLowerCase();

    if (!validUserTypes.includes(normalizedUserType)) {
      return res.status(400).json({ error: `userType must be one of: ${validUserTypes.join(', ')}` });
    }

    let costPerGram = 0;
    let discount = 0;

    switch (normalizedUserType) {
      case 'student':
        costPerGram = 2.5;
        break;
      case 'faculty':
        costPerGram = 2.0;
        discount = 20;
        break;
      case 'guest':
        costPerGram = 3.5;
        break;
    }

    const materialCost = grams * costPerGram;
    const supportMaterialCost = materialCost * 0.1;
    const serviceCharge = (materialCost + supportMaterialCost) * 0.05;
    const totalBeforeDiscount = materialCost + supportMaterialCost + serviceCharge;
    const discountAmount = (totalBeforeDiscount * discount) / 100;
    const finalCost = totalBeforeDiscount - discountAmount;
    const costRupees = Math.round(finalCost);

    const breakdown = {
      grams: parseFloat(grams.toFixed(2)),
      userType: normalizedUserType,
      costPerGram,
      materialCost: parseFloat(materialCost.toFixed(2)),
      supportMaterialCost: parseFloat(supportMaterialCost.toFixed(2)),
      serviceCharge: parseFloat(serviceCharge.toFixed(2)),
      subtotal: parseFloat(totalBeforeDiscount.toFixed(2)),
      discountPercentage: discount,
      discountAmount: parseFloat(discountAmount.toFixed(2)),
      finalCost: parseFloat(finalCost.toFixed(2))
    };

    console.log(`[STL Price] Calculated price for ${grams}g (${normalizedUserType}): ₹${costRupees}`);
    res.json({ costRupees, breakdown });
  } catch (error) {
    console.error('[STL Price] Error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Price calculation failed' });
  }
});

// ============================================================================
// PCB BUILDER ROUTES
// ============================================================================

const pcbOptionsPath = path.join(__dirname, 'api', 'pcb', 'options.json');
let pcbOptions = null;
try {
  if (fs.existsSync(pcbOptionsPath)) {
    pcbOptions = JSON.parse(fs.readFileSync(pcbOptionsPath, 'utf-8'));
  }
} catch (e) {
  console.warn('Could not read pcb options.json:', e.message);
}

app.get('/api/pcb/builder', (req, res) => {
  res.json({ success: true, options: pcbOptions || {} });
});

app.post('/api/pcb/builder', (req, res) => {
  try {
    const { width, height, layerCount, color, copperThickness } = req.body || {};
    if (!width || !height || !layerCount || !color || !copperThickness) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: width, height, layerCount, color, copperThickness'
      });
    }

    const boardAreaCm2 = (width / 10) * (height / 10);
    const basePricePerCm2 = 15;
    
    const colorOpt = pcbOptions?.colors?.find(c => c.id === color);
    const copperOpt = pcbOptions?.copperThickness?.find(c => c.id === copperThickness);
    const layerOpt = pcbOptions?.layerCount?.find(l => l.value === layerCount);
    
    const totalMultiplier = (colorOpt?.priceMultiplier || 1) * (copperOpt?.priceMultiplier || 1) * (layerOpt?.priceMultiplier || 1);
    const basePrice = boardAreaCm2 * basePricePerCm2 * totalMultiplier;
    
    const thicknessMm = (copperOpt?.micrometers || 35) / 1000;
    const copperUsageGrams = parseFloat((((width * height) * thicknessMm * 8.96 / 1000) * layerCount).toFixed(2));

    res.json({
      success: true,
      specification: req.body,
      calculations: {
        boardAreaCm2: parseFloat(boardAreaCm2.toFixed(2)),
        boardAreaMm2: parseFloat((boardAreaCm2 * 100).toFixed(2)),
        copperUsageGrams,
        estimatedPriceINR: Math.round(basePrice),
        priceBreakdown: {
          basePrice: parseFloat(basePrice.toFixed(2)),
          sgst: parseFloat((basePrice * 0.09).toFixed(2)),
          cgst: parseFloat((basePrice * 0.09).toFixed(2)),
          totalWithGST: parseFloat((basePrice * 1.18).toFixed(2))
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(API_PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║                     🚀 API Server Running                          ║
╚════════════════════════════════════════════════════════════════════╝

📡 API Server:  http://localhost:${API_PORT}
🌐 Frontend:    http://localhost:3000

✅ OAuth Endpoints:
   - GET  /api/auth/google
   - POST /api/auth/google
   - GET  /api/auth/google/callback
   - GET  /api/auth/microsoft
   - POST /api/auth/microsoft
   - GET  /api/auth/microsoft/callback

✅ STL Endpoints:
   - POST /api/stl/upload
   - POST /api/stl/analyze
   - POST /api/stl/price

✅ Health Check:
   - GET  /api/health

📚 Make sure to:
   1. Run 'npm run dev' in another terminal for the frontend
   2. Update Google Cloud Console with: http://localhost:${API_PORT}/api/auth/google/callback
   3. Update Microsoft Azure with: http://localhost:${API_PORT}/api/auth/microsoft/callback

Press Ctrl+C to stop
`);
});
