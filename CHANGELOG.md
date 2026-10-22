# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-10-22

### Added
- Each IBKR account (ClientAccountID) gets its own Wealthfolio accounts, named after its IBKR alias: "IBKR-Main - USD". The IBKR account number is stored as the account number, so renamed accounts still match on later imports and auto-fetch

### Fixed
- Repeated same-day IBKR postings were also collapsed by the addon's own batch dedup; activities with an IBKR TransactionID are now deduplicated by that id

## [1.3.0] - 2026-10-22

### Fixed
- Imports reported success but stored nothing: activities now go through `checkImport` (which resolves assets) before `import`, only valid rows are sent, and the result shows the host's real imported/failed counts and errors
- Positive Withholding Tax rows (IBKR tax reversals) are imported as `CREDIT`/`REFUND` instead of as additional tax
- Repeated same-day IBKR postings were collapsed by the host's content dedup; the IBKR TransactionID is now part of the activity comment, so each posting is kept and re-imports stay idempotent
- New accounts are created with the `TRANSACTIONS` tracking mode

## [1.2.2] - 2026-10-22

### Fixed
- Flex Query statements detected 0 currencies: they have no currency summary rows, so currencies now come from execution and detail rows when no summary exists

## [1.2.1] - 2026-10-22

### Fixed
- SendRequest retries IBKR's transient 1001 ("could not be generated at this time") and 1018 (rate limit) up to 4 times, waiting 10/20/30 seconds
- "History from" ranges end yesterday, since activity statements are built end-of-day

## [1.2.0] - 2026-10-22

### Added
- "History from" date in the Flex import: fetches everything up to today in 365-day chunks using the Flex `fd`/`td` parameters, spaced to respect IBKR's 10 requests/minute limit

### Fixed
- An XML statement now fails with a hint to set the query Format to CSV instead of importing nothing
- A period without activity no longer counts as a failed statement

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
