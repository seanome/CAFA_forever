# CAFA Forever

> **seanome/CAFA_forever** is a fork of [anphan0828/CAFA_forever](https://github.com/anphan0828/CAFA_forever)
> (LAFA). It adds a second task, region transfer (where on a protein a domain or feature
> sits, with stratified and cost-aware scores), beside LAFA's GO scores, and publishes the
> frontend at https://seanome.github.io/CAFA_forever/. What changed and why:
> [docs/cafa_forever_map.md](docs/cafa_forever_map.md) and
> [docs/upstream_proposal.md](docs/upstream_proposal.md). Licence GPL-3.0; see [NOTICE](NOTICE).
>
> Build a region release from `results.parquet` and `compute.parquet`
> (`make leaderboard-tables` in seanome/2024-kmerseek-analysis):
>
> ```bash
> nextflow run main.nf --mode region_release \
>   --results_parquet results.parquet --compute_parquet compute.parquet \
>   --release_id region_qfo_pfam_2026_09_13 --release_title "QfO Pfam region benchmark" \
>   --source_repo seanome/2024-kmerseek-analysis --source_commit <sha> --run_date 2026-09-13
> ```
>
> Static build for GitHub Pages: `make pages` (writes `frontend/dist`).

CAFA Forever has three main components:

- a **Streamlit frontend** in `app/` that remains the default production frontend for now
- a **React frontend** for browsing published LAFA evaluation releases
- a **Nextflow backend** for building timepoints and publishing release windows

The frontend and backend share the same repository, but they do not read the same directories at runtime.

---

## Quick Start

### Prerequisites

| Component | Requirement |
|-----------|-------------|
| Frontend (development) | Node.js 20+, Python 3.9+ |
| Frontend (Docker) | Docker 20+ |
| Backend | Nextflow, conda/micromamba |

### Run Frontend Locally (Development)

```bash
cd frontend

# Install Node dependencies
npm install

# Generate JSON data from TSV releases
cd ..
python3 scripts/generate_data.py
cd frontend

# Start development server
npm run dev
```

Open http://localhost:5173 in your browser.

### Run Frontend with Docker (Production)

From the **repository root** (not the frontend folder):

```bash
# Build the image (includes data generation)
docker build -f Dockerfile.react -t lafa-frontend .

# Run the container
docker run -p 8501:8501 lafa-frontend
```

Open http://localhost:8501 in your browser.

Alternatively, use Docker Compose:

```bash
docker compose -f deploy/docker-compose.react.yml up -d --build
```

The Compose setup publishes the React frontend on http://localhost:8502 so it can run alongside the Streamlit frontend on port 8501.

### Health Check

```bash
curl http://localhost:8502/_health
```

---

## Frontend Architecture

The React frontend is a TypeScript single-page application that reads pre-generated JSON data. The Streamlit frontend remains available in `app/` and is the default deployment target while the React redesign matures.

### Why React Instead of Streamlit?

| Aspect | React | Streamlit |
|--------|-------|-----------|
| Deployment | Single Nginx container, no websockets | Requires Streamlit server process |
| Performance | Static assets, CDN-friendly | Server-side rendering per request |
| Responsiveness | Instant client-side interactions | Round-trip latency on every action |
| Infrastructure | Standard HTTP health checks | Custom Streamlit health endpoint |

### Trade-offs

- **Build step required**: Changes require `npm run build`. Streamlit had instant hot-reload.
- **JavaScript knowledge**: Maintainers need React/TypeScript familiarity.
- **Data pipeline**: The `generate_data.py` script must run whenever evaluation data updates.

### Tech Stack

- **Vite** - Build tool
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Visx** - PR curve visualizations
- **Recharts** - Bar charts and comparisons
- **Nginx** - Production serving

---

## Data Pipeline

The frontend reads JSON files, not TSV directly. A Python script transforms the backend's TSV output:

```bash
python3 scripts/generate_data.py
```

**Input:** `data/releases/{release_id}/*.tsv`

**Output:** `frontend/public/data/`
- `catalog.json` - Available releases and timepoints
- `methods.json` - Method display names and baseline flags
- `releases/{id}/meta.json` - Release metadata and target counts
- `releases/{id}/methods.json` - Method availability per release
- `releases/{id}/best.json` - Best metrics by subset/aspect
- `releases/{id}/curves.json` - Full PR curve data (lazy-loaded)

The Docker build runs this script automatically. For local development, run it manually after the backend publishes new releases.

---

## Frontend Features

### Main Dashboard
- **Timeline Selector**: Visual timeline for choosing evaluation windows
- **Method Selector**: Filter results by method, with baseline toggle
- **Summary Charts**: Overall rankings, F-max distributions, target counts

### PR Curves
- 3×3 grid: subsets (NK, LK, PK) × aspects (BP, MF, CC)
- F-score iso-contours (0.2, 0.4, 0.6, 0.8)
- Best threshold points marked on each curve

### Data Table
- Sortable columns by any metric
- CSV export functionality
- Subset and aspect filtering

### Window Comparison
- Compare method performance across two evaluation windows
- Side-by-side grouped bar charts
- Subtabs for NK, LK, PK knowledge levels

---

## Deployment Options

### Option 1: Docker (Recommended for Production)

The multi-stage Dockerfile handles everything:

1. **Stage 1**: Runs `generate_data.py` to create JSON from TSV
2. **Stage 2**: Builds the React app with `npm run build`
3. **Stage 3**: Serves static files via Nginx

```bash
# From repository root
docker build -f Dockerfile.react -t lafa-frontend .
docker run -d -p 8501:8501 --name lafa-frontend lafa-frontend
```

The container runs on port 8501 for compatibility with existing Nginx proxy configurations.

### Option 2: Docker Compose

```bash
docker compose -f deploy/docker-compose.react.yml up -d --build
```

The React compose file binds to `127.0.0.1:8501`, suitable when an external Nginx handles HTTPS termination.

### Option 3: Manual Deployment (Static Files)

Build the frontend and serve with any web server:

```bash
cd frontend
cd ..
python3 scripts/generate_data.py
cd frontend
npm ci
npm run build
# Deploy contents of dist/ to your web server
```

---

## Testing Changes

### 1. Local Development Cycle

```bash
cd frontend
npm run dev   # Hot-reload at localhost:5173
```

Edit files in `frontend/src/`. Changes appear instantly.

### 2. Test Production Build

```bash
cd frontend
npm run build
npm run preview   # Serves dist/ at localhost:4173
```

### 3. Test Docker Build

```bash
# From repository root
docker build -f Dockerfile.react -t lafa-frontend:test .
docker run --rm -p 8501:8501 lafa-frontend:test
```

Verify at http://localhost:8501

### 4. Verify Data Generation

If releases have changed:

```bash
python3 scripts/generate_data.py
# Check public/data/catalog.json for expected releases
```

---

## Updating After Backend Changes

When the backend publishes new releases to `data/releases/`:

### Local Development
```bash
python3 scripts/generate_data.py
# Restart dev server if running
```

### Docker Deployment
```bash
# Rebuild the image to regenerate JSON
docker build -f Dockerfile.react -t lafa-frontend .
docker compose -f deploy/docker-compose.react.yml up -d   # Recreates container with new data
```

---

## Backend Pointer

Backend setup and Nextflow usage are documented in [README_backend.md](README_backend.md).

The backend is responsible for:

- building canonical timepoint artifacts
- generating or reusing predictions
- evaluating `NK`, `LK`, and `PK`
- publishing frontend-ready release windows into `data/releases/`

---

## Repository Layout

```
CAFA_forever/
├── app/                         # Streamlit frontend (default/legacy)
├── frontend/                    # React frontend redesign
│   ├── src/                     # React components and hooks
│   ├── public/data/             # Generated JSON (gitignored)
│   └── nginx.conf               # Production server config
├── scripts/generate_data.py     # Shared TSV → JSON contract generator
├── deploy/                      # Compose files for Streamlit and React
├── data/releases/               # Published TSV releases (backend output)
├── workflows/                   # Nextflow backend workflows
├── modules/local/               # Nextflow reusable processes
├── main.nf                      # Backend entrypoint
├── Dockerfile.streamlit         # Streamlit image
└── Dockerfile.react             # React/Nginx image
```

---

## Migration from Streamlit

The old Streamlit deployment used:
- `Dockerfile.streamlit` (root) - Python/Streamlit image
- `deploy/docker-compose.streamlit.yml` - Streamlit service
- `app/streamlit_app.py` - Streamlit application

The new React deployment uses:
- `Dockerfile.react` - Multi-stage Node/Nginx image
- `deploy/docker-compose.react.yml` - React service
- `frontend/src/App.tsx` - React application

Both deployments serve on port 8501, so the external Nginx configuration remains unchanged.

---

## ISU Branding

CSS variables in `frontend/src/index.css`:

```css
:root {
  --isu-cardinal: #c8102e;
  --isu-cardinal-dark: #7c2529;
  --isu-gold: #f1be48;
  --isu-charcoal: #212529;
}
```

---

## Notes

The precision-recall curves are displayed with monotonic precision using a cumulative maximum over precision values. This makes curves easier to compare when small evaluation sets or threshold noise would otherwise introduce non-monotonic segments.
