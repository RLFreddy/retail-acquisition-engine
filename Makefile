.PHONY: help install dev test build reset docker-build docker-run

help:          ## Show the available commands
	@grep -E '^[a-z-]+:.*##' Makefile | awk -F':.*## ' '{printf "  make %-13s %s\n", $$1, $$2}'

install:       ## Install dependencies
	pnpm install

dev:           ## Run the scraper locally (LIMIT=10 make dev for a quick test)
	pnpm dev

test:          ## Typecheck and run the tests
	pnpm typecheck && pnpm test

build:         ## Compile TypeScript to dist/
	pnpm build

reset:         ## Delete all results and the resume state (data/, data_docker/)
	rm -rf data data_docker

docker-build:  ## Build the Docker image
	docker compose build

docker-run:    ## Run the scraper in Docker
	docker compose run --rm scraper
