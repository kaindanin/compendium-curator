# Changelog

## Unreleased

### New

- Added reusable manual inclusions to Categories and table Item rules.
- Added a flat “No grouping” distribution that writes objects directly into the generated table branch.
- Added a table-level “No grouping / By groups” mode that either merges Categories and manual inclusions into one deduplicated local branch or keeps them separate, while linked tables remain independent.
- Added direct access to table defaults from Foundry's module settings.
- Added nested filter groups inside reusable categories, including a live Compendium Browser editor, zero-match groups, and per-group edit, duplicate, and delete actions.

### Improvements

- Renamed reusable filter groups to categories throughout the interface while preserving the existing storage format for compatibility.
- Moved the hidden-entry control into the native Compendium Browser filters as a three-state include, ignore, or exclude filter.
- Simplified the Curator toolbar and removed the duplicate defaults shortcut from the Table Manager.
- Duplicate detection now runs only on explicit request, can be cancelled, and automatically turns off when browser filters change.
- Cached hidden entries and invalidated translated duplicate metadata when source documents change.
- Categories now combine their filter groups with OR, while each group's criteria retain the Compendium Browser's AND semantics.
- Table generation now reevaluates persisted Category and restriction criteria instead of relying on cached UUID matches.
- Linked tables remain opaque RollTable references whose parent controls only the relationship weight.
- Compact table and Category rows show more content without changing their hierarchy.
- Table restrictions are dormant and hidden while their stored data remains available for compatibility.
- Legacy direct objects are preserved and presented as the table's Manual inclusion source.
- Made table inclusions more visible and added live selected/available counters plus bulk selection controls.

### Reliability

- Added cancellation checks between duplicate-loading and document-resolution batches.
- Added automated coverage for dormant restrictions, manual inclusions, local-source unions, and linked-table boundaries.
- Added an explicit v6-to-v7 migration that preserves existing category identifiers and converts every flat category into one same-named group without merging data.
- Kept version 1, 2 and 3 table bundles and legacy complete backups importable; new table bundles export Category-level inclusions as version 4.
- Prevented the custom hidden-state control from recursively redispatching its own change event during live browser synchronization.
- Kept manual inclusions in direct-content generation and migrated existing direct profiles explicitly to the grouped layout.

## 0.4.0

### New

- Added a complete RollTable manager with reusable filter groups, linked tables, recursive generation, configurable grouping and weighted distributions.
- Added visual manager folders and first-generation folder mirroring for world and compendium destinations.
- Added grouped item draws, stock quantities, price adjustments and Item Piles restocking workflows.
- Added import and export for individual tables and complete portable manager backups.
- Added bulk table selection, folder-level generation, and independent visual folders for filter groups.

### Improvements

- Redesigned table content as compact expandable branches with on-demand rendering.
- Linked tables now reproduce their original structure as a strictly read-only preview; only the parent relationship weight is editable.
- Generated technical tables are centralized below a root `Subtables` folder while preserving the manager hierarchy.
- Existing generated tables remain in their user-selected destination when updated.
- Manual inclusions now belong to filter groups and object rules use an extensible checklist.
- Improved duplicate handling, filter previews, table creation, searches and manager ergonomics.
- Redesigned filter groups as compact expandable cards with inline filters, matching objects and table usage.

### Reliability

- Failed generations now roll back updated tables and remove partially created documents.
- Added validation for complete backups, profile dependencies, folder relations and cyclic table links.
- Recursive draws now resolve linked RollTables from both the world and compendiums.
- Replaced runtime Table Manager method patches with explicit integration points.
- Added automated syntax, manifest and regression tests.
