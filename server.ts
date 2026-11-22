import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const PORT = 3000;
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 5001);
const BACKEND_HOST = '127.0.0.1';

let pythonProc: ChildProcess | null = null;

function startPythonBackend(): void {
  const scriptPath = path.resolve(process.cwd(), 'backend/app.py');
  pythonProc = spawn('python3', [scriptPath], {
    env: {
      ...process.env,
      BACKEND_PORT: String(BACKEND_PORT),
      PYTHONUNBUFFERED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  pythonProc.stdout?.on('data', (chunk) => {
    process.stdout.write(`[python-api] ${chunk}`);
  });

  pythonProc.stderr?.on('data', (chunk) => {
    process.stderr.write(`[python-api] ${chunk}`);
  });

  pythonProc.on('exit', (code) => {
    console.error(`[python-api] exited with code ${code}`);
    pythonProc = null;
  });
}

async function waitForBackend(timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.get(
        { host: BACKEND_HOST, port: BACKEND_PORT, path: '/api/health', timeout: 800 },
        (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  console.warn('[server] Python backend health check timed out; continuing anyway.');
}

async function main() {
  startPythonBackend();
  await waitForBackend();

  const app = express();

  // Raw reverse-proxy for /api/* -> Python Flask/WSGI server
  app.use('/api', (req, res) => {
    const targetPath = req.originalUrl;
    const proxyReq = http.request(
      {
        host: BACKEND_HOST,
        port: BACKEND_PORT,
        path: targetPath,
        method: req.method,
        headers: {
          ...req.headers,
          host: `${BACKEND_HOST}:${BACKEND_PORT}`,
        },
      },
      (proxyRes) => {
        res.status(proxyRes.statusCode || 502);
        for (const [key, val] of Object.entries(proxyRes.headers)) {
          if (val !== undefined) {
            res.setHeader(key, val);
          }
        }
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).json({ error: `Backend API unavailable: ${err.message}` });
      }
    });

    req.pipe(proxyReq);
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Transport Route Optimization System listening on http://0.0.0.0:${PORT}`);
  });

  const cleanup = () => {
    server.close();
    if (pythonProc) {
      pythonProc.kill('SIGTERM');
    }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
