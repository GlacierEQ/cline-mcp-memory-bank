.PHONY: install build test audit ci pack clean

install:
	npm ci

build:
	npm run build

test:
	npm test

audit:
	npm audit --omit=dev

ci: test audit

pack:
	npm pack --dry-run

clean:
	npm run clean
