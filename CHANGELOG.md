# Changelog

## 0.4.0

### New

- Added a complete RollTable manager with reusable filter groups, linked tables, recursive generation, configurable grouping and weighted distributions.
- Added visual manager folders and first-generation folder mirroring for world and compendium destinations.
- Added grouped item draws, stock quantities, price adjustments and Item Piles restocking workflows.
- Added import and export for individual tables and complete portable manager backups.

### Improvements

- Redesigned table content as compact expandable branches with on-demand rendering.
- Linked tables now reproduce their original structure as a strictly read-only preview; only the parent relationship weight is editable.
- Generated technical tables are centralized below a root `Subtables` folder while preserving the manager hierarchy.
- Existing generated tables remain in their user-selected destination when updated.
- Manual inclusions now belong to filter groups and object rules use an extensible checklist.
- Improved duplicate handling, filter previews, table creation, searches and manager ergonomics.

### Reliability

- Failed generations now roll back updated tables and remove partially created documents.
- Added validation for complete backups, profile dependencies, folder relations and cyclic table links.
- Recursive draws now resolve linked RollTables from both the world and compendiums.
- Replaced runtime Table Manager method patches with explicit integration points.
- Added automated syntax, manifest and regression tests.
