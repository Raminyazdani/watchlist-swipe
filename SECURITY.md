# Security and privacy

Do not commit `.env`, credentials, browser storage or personal watchlist exports.
The distributed code has no fallback TMDB credential and uses sample titles only.
Client-side `VITE_` settings are visible in the browser bundle; confidential
credentials require a server-side design.

Dependency and secret-scan results describe the exact revision checked; they are
not a guarantee of absence of vulnerabilities. Report issues privately to the
repository owner rather than posting credentials or personal data in an issue.
