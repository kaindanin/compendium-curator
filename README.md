# Compendium Curator

**English** | [Español](README.es.md)

## What is Compendium Curator?

Compendium Curator enhances the D&D5e Compendium Browser by allowing Game Masters to hide individual entries from installed compendiums without modifying or duplicating their original content.

Create independent profiles for different campaigns, worlds, or settings, and control which items, spells, features, and other entries players can find in the Compendium Browser.

Forget about spending hours creating and organizing custom compendiums just to combine selected content from different sourcebooks. Select what you do not want to display, hide it, and keep the Compendium Browser clean and adapted to each campaign.

## Features

* Hide individual entries from the Compendium Browser.
* Restore hidden entries.
* Select multiple entries using checkboxes.
* Select all visible entries with a master checkbox.
* Filter hidden entries with the Compendium Browser's native three-state control.
* Visually identify hidden entries.
* Create and delete configuration profiles.
* Maintain independent hidden-entry lists for each profile.
* Choose a fixed public profile for players.
* Allow the GM to change editing profiles without altering what players see.
* Automatically synchronize changes between connected clients.
* Restrict administration controls to users who can modify world settings.
* Preserve configuration data between sessions.
* Restrict entry previews to their names so they do not interfere with module controls.
* Interface available in English and Spanish.
* Rename and duplicate profiles.
* Export and import profiles.
* Detect and group duplicate entries within the current browser results.
* Define a global source priority to decide which duplicate copy to keep.
* Automatically select lower-priority copies for hiding.
* Detect duplicate entries with inconsistent translations.
* Display loading indicators during long operations.
* Create content and composite tables directly from the Compendium Browser.
* Visually organize tables into folders and reproduce that structure on first generation.
* Select, generate, move, or delete several table profiles at once, including folder-level generation.
* Browse reusable categories as compact expandable cards and organize them in independent visual folders.
* Apply table-wide filters across every category and inspect them in the table preview.
* Configure categories, weights, object rules, exclusions, and linked tables from one view.
* Export one table or create a complete Manager backup with folders and defaults.

## Requirements

* Foundry Virtual Tabletop 14 or later.
* D&D5e system 5.3.0 or later.

## Manual Installation

1. Download or copy the module folder.

2. Place it inside the Foundry modules directory:

   ```text
   Data/modules/compendium-curator
   ```

3. Restart Foundry Virtual Tabletop.

4. Enable **Compendium Curator** from the world's module settings.

## Usage

Open the D&D5e Compendium Browser.

Compendium Curator controls will appear at the top for users who have permission to modify world settings.

### Curator Mode

Click **Curator** to display selection checkboxes beside the entries.

After selecting entries, use:

* **Hide** to remove them from the browser.
* **Restore** to make them visible again.

The checkbox in the column header selects or deselects all entries matching the browser's current filters, automatically loading additional results when necessary.

### Hidden Entries

Use **Hidden** inside the regular Compendium Browser filters. It uses the same three-state control as D&D5e: green shows only hidden entries, neutral shows both, and red excludes hidden entries. Hidden entries remain faded whenever they are visible.

### Duplicates

Click **Duplicates** to display only entries whose original name matches another entry within the current Compendium Browser results.

The analysis runs only when requested. While it is running, the button becomes **Cancel** and the rest of the browser is temporarily locked. Changing a browser tab, search, type, or filter turns duplicate mode off instead of recalculating it automatically.

The filter respects the current category, search, sources, and other active browser filters.

Duplicate copies are grouped together to make comparison easier. When translations are available, translated copies are shown first within the group.

The three-state **Hidden** filter also controls which hidden entries participate in duplicate detection.

#### Source Priority

Click **Priority** to order sources from the one you prefer to keep to the lowest priority.

The priority is stored globally for the world and is independent of the current browser category or filters.

Click **Apply priority** to automatically select every duplicate copy except the one belonging to the highest-priority source.

This action only changes the selection. Entries are not hidden until you click **Hide**, allowing you to review and manually adjust the selection first.

#### Different Translations

Click **Translations** to display only duplicate groups containing two or more different translations for the same original name.

Untranslated copies may still appear within these groups for comparison, but one translated copy and one untranslated original do not count as a translation conflict by themselves.

### Table Manager

Click **Manage tables** in the Compendium Browser to open the Manager. Creating a table only asks for a name; reusable categories and linked tables can then be added from its actions menu.

The **Content** block presents every category and linked table as an expandable branch. Categories expose their grouping, weights, and object rules. Linked tables reproduce the original structure as a read-only view, while only the relationship weight remains editable from the parent table.

The **Categories** tab uses the same compact expandable layout, with saved filters, matching objects, and table usage inline. Its folders are independent and visual only; they never create or move generated RollTables.

Each content table can also save **Global filters** from the Compendium Browser. They are intersected with every linked category before weights are calculated or RollTables are generated. The expanded preview shows the stored browser tab, mode, filter states, and how many category objects were excluded.

Manager folders are a visual organization. When a table is generated for the first time, that structure is reproduced in the default world or compendium destination. Later updates keep the document in its current location; if the user manually moves it elsewhere, the Manager does not force it back. Technical subtables are stored below the root **Subtables** folder and mirror the Manager organization.

The configuration menu can export or restore a complete backup containing profiles, categories, folders, and defaults. Exporting a single table retains its dependencies, but imports it at the root without carrying over its visual source folder. Table defaults are edited from **Game Settings → Configure Settings → Compendium Curator**.

### Profiles

Each profile maintains its own list of hidden entries.

The profile selector changes the profile currently being edited by the GM.

The settings menu beside the selector allows the GM to:

* Create a profile.
* Rename a profile.
* Duplicate a profile.
* Export a profile to a file.
* Import a profile from a file.
* Mark the active profile as public.
* Delete a profile.

The public profile is identified in the selector by the **Public** label.

### Public Profile

Players always use the profile marked as public.

The GM can switch to another profile to prepare content, perform tests, or configure a different campaign without changing what players can see.

When another profile is marked as public, open player browsers are updated automatically.

The public profile cannot be deleted until another profile has been marked as public.

## Permissions

Users with permission to modify world settings can:

* Enable Curator Mode.
* Display hidden entries.
* Hide and restore entries.
* Create, switch, and delete profiles.
* Choose the public profile.

Other players do not see the module controls and always use the rules from the public profile.

## Storage

Configuration is stored as a Foundry world setting.

Each world independently maintains:

* Its profiles.
* The GM's active profile.
* The public profile.
* The hidden entries belonging to each profile.

## Compatibility

Compendium Curator modifies the D&D5e Compendium Browser interface.

Future changes to the browser's internal structure may require an update to the module.

## Version

**0.4.0**

## Author

**Argulf**

## Support the Project

Compendium Curator is free and open-source.

If you find the module useful and would like to support its development and maintenance, you can buy me a coffee:

[Support the project on Ko-fi](https://ko-fi.com/argulf)
