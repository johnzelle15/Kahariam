React frontend scaffold (Vite) — ready to install.

To run locally:

1. Install Node.js (>=16): https://nodejs.org/
2. From project root run:

```bash
cd frontend
npm install
npm run dev
```

This will start the dev server on http://localhost:5173 and call backend endpoints at the same origin if you run Flask on port 5000; to avoid CORS, run frontend with a proxy or set `VITE_API_BASE` and configure.

Proxy notes:
- A Vite proxy config is included (`vite.config.js`) which forwards common API routes to `http://localhost:5000` during development. Start your Flask backend on port 5000 first, then run the frontend dev server.

If your backend runs on a different host/port, update `vite.config.js` accordingly or set up a reverse proxy.

Production build and serving from Flask
-------------------------------------
- Build the frontend:

```bash
cd frontend
npm install
npm run build
```

- This produces the static site in `frontend/dist`. The Flask app is already configured to serve files from `frontend/dist` when present — simply start your Flask server (`python app.py`) and it will serve the built frontend at `/` alongside the API endpoints.

- If you prefer to serve the built files from a separate web server (nginx, etc.), point the server to the `frontend/dist` directory.
