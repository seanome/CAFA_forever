# Static build of the frontend for GitHub Pages (seanome fork). `make pages` writes
# frontend/dist with base path /CAFA_forever/; .github/workflows/pages.yml runs the same steps.
.PHONY: data pages check

data:
	python3 scripts/generate_data.py

pages: data
	cd frontend && npm ci && npm run build:pages && touch dist/.nojekyll

# Converter round trip and release checks. LEADERBOARD_TABLES is the folder holding
# results.parquet and compute.parquet (`make leaderboard-tables` in 2024-kmerseek-analysis).
check:
	python3 -m pytest checks/
