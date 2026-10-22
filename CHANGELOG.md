# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-10-22

### Fixed
- Settings page no longer re-requests accounts in an endless loop
- "Add Configuration" works inside the sandbox, which blocks native form submission

## [1.1.0] - 2026-10-22

### Changed
- Requires Wealthfolio 3.9 or newer; ported to the sandboxed addon runtime (SDK 3.9)
- Pages are declared in `manifest.json` (`contributes`) and mounted at `/addons/ibkr-multi-import`
- Flex Query requests go through the host network broker; the only allowed host is `ndcdyn.interactivebrokers.com`
- React, React Query, `@wealthfolio/ui` and `lucide-react` are provided by the host instead of bundled

### Known limitations
- The ticker cache and the direct Yahoo Finance ISIN lookup are unavailable inside the sandbox; tickers resolve through Wealthfolio's own search
- The host broker caps responses at 2 MiB, so very large Flex statements need a shorter date range

## [1.0.0] - 2025-01-19

### Added
- Multi-file CSV import support
- Flex Query API integration for automatic transaction fetching
- Auto-fetch on portfolio update feature
- Multiple Flex Query configuration support
- Automatic currency detection and multi-currency account creation
- ISIN-based ticker resolution to Yahoo Finance symbols
- FX conversion splitting into withdrawal/deposit pairs
- Smart deduplication between CSV and Flex Query imports
- Settings page for managing Flex Query configurations
- Secure credential storage using system keyring
- Transaction type support (trades, dividends, fees, deposits, withdrawals, transfers)
- Account reuse detection
