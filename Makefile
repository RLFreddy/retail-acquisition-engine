.PHONY: help install dev start test typecheck build clean reset docker-build docker-run

help:          ## Show the available commands
	@grep -E '^[a-z-]+:.*##' Makefile | awk -F':.*## ' '{printf "  make %-13s %s\n", $$1, $$2}'

install:       ## Install dependencies
	pnpm install

dev:           ## Run the scraper locally (make dev LIMIT=10 for a quick test)
	pnpm dev

start:         ## Run the compiled scraper from dist/ (after make build)
	pnpm start

test:          ## Typecheck and run the tests
	pnpm typecheck && pnpm test

typecheck:     ## Typecheck src/ and test/ only
	pnpm typecheck

build:         ## Compile TypeScript to dist/
	pnpm build

clean:         ## Delete the compiled output (dist/)
	pnpm clean

reset:         ## Delete all results and the resume state (data/, data_docker/)
	rm -rf data data_docker

docker-build:  ## Build the Docker image
	docker compose build

docker-run:    ## Run the scraper in Docker (make docker-run LIMIT=10 for a quick test)
	docker compose run --rm $(if $(LIMIT),-e LIMIT=$(LIMIT)) scraper
