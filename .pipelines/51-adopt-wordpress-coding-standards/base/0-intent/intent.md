# Adopt WordPress coding standards in Biome formatting

> Source: GitHub issue [#51](https://github.com/Automattic/skillsmith/issues/51).
> This file is self-contained; agents do not need to open the source issue.

## Goal

skillsmith's code formatting **fully adopts WordPress coding standards** — including spaces inside delimiters/parentheses (`array( 1, 2 )`, `[ 1, 2 ]`), enabled by Biome's new `delimiterSpacing` option. This is the complete WordPress style (tabs, single quotes, trailing commas, CSS overrides, etc.), not only the delimiter spacing.

## Context

- Prompted by Biome v2.5's new `delimiterSpacing` formatter option: https://biomejs.dev/blog/biome-v2-5/#new-delimiterspacing-formatter-option
- WordPress's JS standard is codified in `@wordpress/prettier-config`. Its WordPress-only setting `parenSpacing: true` (spaces inside parentheses) historically required the `wp-prettier` fork; Biome's `delimiterSpacing: true` is the stock equivalent that finally makes full WordPress-style formatting achievable with stock Biome.
- No official `@wordpress/biome-config` package exists (checked June 2026), so the WordPress standard has to be expressed as a Biome config mirroring `@wordpress/prettier-config`.
- skillsmith already uses Biome (`2.4.12`).

## Assumptions / directions to explore

_Open — agents may confirm or revise._

- Translating `@wordpress/prettier-config` to Biome likely entails: `delimiterSpacing: true`, single quotes (skillsmith currently uses double), tabs with width 4, line width 80, `es5` trailing commas, plus the CSS overrides (single quotes off, delimiter spacing off). The exact mapping is for later phases to verify.
- `delimiterSpacing` requires Biome ≥ 2.5, so this likely entails bumping `@biomejs/biome` (currently `2.4.12`) and the `biome.json` `$schema` pin.
