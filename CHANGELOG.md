# Changelog

## Unreleased

### New

- Added table-wide Compendium Browser filters that apply to every linked category and remain visible in the expanded table preview.
- Added direct access to table defaults from Foundry's module settings.

### Improvements

- Renamed reusable filter groups to categories throughout the interface while preserving the existing storage format for compatibility.
- Moved the hidden-entry control into the native Compendium Browser filters as a three-state include, ignore, or exclude filter.
- Simplified the Curator toolbar and removed the duplicate defaults shortcut from the Table Manager.
- Duplicate detection now runs only on explicit request, can be cancelled, and automatically turns off when browser filters change.
- Cached hidden entries and invalidated translated duplicate metadata when source documents change.

### Reliability

- Added cancellation checks between duplicate-loading and document-resolution batches.
- Added automated coverage for saving, normalizing, and clearing table-wide filters.

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
