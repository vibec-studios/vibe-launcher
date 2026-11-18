# Vibe online services – terms of use for software

Vibe Craft Studios operates online services for its own apps:

- the Vibe backend at `vibe.henny.dev` (accounts, friends, chats, presence, invites, shared modpacks, cosmetics
  catalog, cosmetic assets, loadouts, client downloads, submissions, all APIs and the realtime gateway),
- the Vibey relay at `vibey.henny.dev` and `*.vibey.henny.dev`,
- any other host we use for the same purpose.

The open source license of the code **does not include any right to use these services**. They are offered only to
end users of the **official builds** published by Vibe Craft Studios (the Vibe Launcher releases on
github.com/vibec-studios and the official Vibey Client / Vibey Multiplayer builds).

## Not allowed without our written permission

- shipping a fork, modified build or other software that connects to the Vibe services,
- using the services for other products, bots, scrapers or automation,
- downloading the cosmetics catalog or cosmetic assets in bulk, or redistributing them,
- getting around limits, ownership checks, bans or other protections,
- presenting a modified build to the services as an official one.

## Allowed

- using the official apps normally,
- developing and testing changes against **your own local instance** of a backend or relay; contributions to our
  repositories are welcome,
- linking to our websites and to the official downloads.

We may block software, accounts or addresses that break these terms and may change or end the services at any time.
The services come without warranty, to the extent permitted by law.

## For fork maintainers

Online features in forks must be switched off or pointed at services you run yourself. The service addresses in the
code (for the launcher: `src-tauri/src/vibe/` and `src-tauri/src/server/mod.rs`) are there for the official builds
only.
