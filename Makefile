.PHONY: install build start stop dev test verify clean help

# Colors
GREEN  := \033[0;32m
CYAN   := \033[0;36m
YELLOW := \033[0;33m
RESET  := \033[0m

# Default target
help:
	@echo "$(CYAN)codex-failover$(RESET)"
	@echo ""
	@echo "$(GREEN)make install$(RESET)    Install everything (first time setup)"
	@echo "$(GREEN)make start$(RESET)      Start server + tray"
	@echo "$(GREEN)make stop$(RESET)       Stop all processes"
	@echo "$(GREEN)make dev$(RESET)        Start dev mode (backend + tray + harness)"
	@echo "$(GREEN)make test$(RESET)       Run all tests"
	@echo "$(GREEN)make verify$(RESET)     Lint + typecheck + test"
	@echo "$(GREEN)make clean$(RESET)      Remove build artifacts"
	@echo ""

# Full installation — clone and run this
install: check-node check-pnpm install-deps build link-cli configure-codex
	@echo ""
	@echo "$(GREEN)✅ Installation complete!$(RESET)"
	@echo ""
	@echo "Run: $(CYAN)make start$(RESET)"
	@echo ""

configure-codex:
	@echo "$(CYAN)Configuring Codex CLI to use codex-failover...$(RESET)"
	@codex-failover install 2>/dev/null || echo "$(YELLOW)  codex-failover install skipped (run manually if needed)$(RESET)"

check-node:
	@node --version > /dev/null 2>&1 || ( \
		echo "$(YELLOW)Node.js is not installed.$(RESET)"; \
		echo "Install it from https://nodejs.org (v20+ required)"; \
		exit 1 \
	)
	@NODE_VER=$$(node -v | sed 's/v//' | cut -d. -f1); \
	if [ "$$NODE_VER" -lt 20 ]; then \
		echo "$(YELLOW)Node.js v20+ required (found v$$NODE_VER).$(RESET)"; \
		echo "Update at https://nodejs.org"; \
		exit 1; \
	fi

check-pnpm:
	@pnpm --version > /dev/null 2>&1 || ( \
		echo "$(CYAN)Installing pnpm...$(RESET)"; \
		npm install -g pnpm@9; \
		pnpm --version > /dev/null 2>&1 || ( \
			echo "$(YELLOW)Failed to install pnpm.$(RESET)"; \
			exit 1 \
		) \
	)

install-deps:
	@echo "$(CYAN)Installing dependencies...$(RESET)"
	@pnpm install --frozen-lockfile 2>/dev/null || pnpm install

build:
	@echo "$(CYAN)Building all packages...$(RESET)"
	@pnpm build

link-cli:
	@echo "$(CYAN)Linking CLI command...$(RESET)"
	@npm link 2>/dev/null || true
	@which codex-failover > /dev/null 2>&1 && echo "$(GREEN)  codex-failover CLI available globally$(RESET)" || \
		echo "$(YELLOW)  Note: codex-failover CLI linked but may need PATH adjustment$(RESET)"

start:
	@-lsof -ti:8787 | xargs kill -9 2>/dev/null; true
	@-pkill -f "router-tray/dist/main.js" 2>/dev/null; true
	@sleep 0.3
	@codex-failover start

stop:
	@-lsof -ti:8787 | xargs kill -9 2>/dev/null; true
	@-pkill -f "router-tray/dist/main.js" 2>/dev/null; true
	@echo "$(GREEN)Stopped.$(RESET)"

dev:
	@pnpm dev

test:
	@pnpm test

verify:
	@pnpm verify

clean:
	@echo "$(CYAN)Cleaning build artifacts...$(RESET)"
	@find . -name 'dist' -type d -not -path '*/node_modules/*' -exec rm -rf {} + 2>/dev/null || true
	@find . -name '.tsbuildinfo' -type f -not -path '*/node_modules/*' -delete 2>/dev/null || true
	@echo "$(GREEN)Clean.$(RESET)"
